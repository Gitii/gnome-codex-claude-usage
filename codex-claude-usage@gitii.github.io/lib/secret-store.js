const APPLICATION = 'codex-claude-usage@gitii.github.io';
const ATTRIBUTES = {application: APPLICATION, provider: 'opencode-go'};

export class SecretStoreError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function lockedError() {
    return new SecretStoreError('locked', 'Unlock your desktop keyring, then save the OpenCode Go key in preferences.');
}

// Service errors may contain sensitive data; never forward their text.
function safeError(error) {
    return error instanceof SecretStoreError ? error : new SecretStoreError('unavailable',
        'Secure storage is unavailable. Start your desktop Secret Service/keyring and try again.');
}

function call(object, method, args) {
    return new Promise((resolve, reject) => {
        object[method](...args, (_source, result) => {
            try {
                resolve(object[`${method}_finish`](result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export class GoSecretStore {
    constructor(loadSecret = () => import('gi://Secret?version=1')) {
        this._loadSecret = loadSecret;
    }

    async _binding() {
        try {
            const {default: Secret} = await this._loadSecret();
            const schema = new Secret.Schema(`${APPLICATION}.OpenCodeGo`, Secret.SchemaFlags.NONE, {
                application: Secret.SchemaAttributeType.STRING,
                provider: Secret.SchemaAttributeType.STRING,
            });
            return {Secret, schema};
        } catch {
            throw new SecretStoreError('missing-bindings',
                'Install libsecret introspection (gir1.2-secret-1 on Debian/Ubuntu), then reopen preferences.');
        }
    }

    async _items(Secret, schema, interactive, cancellable) {
        const service = await call(Secret.Service, 'get', [Secret.ServiceFlags.OPEN_SESSION, cancellable]);
        // No UNLOCK or LOAD_SECRETS in background operations. password_lookup can
        // unlock collections, so it must not be used for periodic Shell reads.
        const flags = Secret.SearchFlags.ALL | (interactive ? Secret.SearchFlags.UNLOCK : 0);
        const items = await call(service, 'search', [schema, ATTRIBUTES, flags, cancellable]);
        if (items.some(item => item.get_locked()))
            throw lockedError();
        if (items.length > 1)
            throw new SecretStoreError('duplicates', 'Multiple Go keys found. Remove duplicate extension-owned items with your keyring manager.');
        return items;
    }

    async hasKey(cancellable = null) {
        try {
            const {Secret, schema} = await this._binding();
            return (await this._items(Secret, schema, false, cancellable)).length === 1;
        } catch (error) {
            throw safeError(error);
        }
    }

    async readKey(cancellable = null) {
        try {
            const {Secret, schema} = await this._binding();
            const [item] = await this._items(Secret, schema, false, cancellable);
            if (!item)
                return null;
            await call(item, 'load_secret', [cancellable]);
            const value = item.get_secret();
            if (!value)
                throw lockedError();
            return value.get_text();
        } catch (error) {
            throw safeError(error);
        }
    }

    // Mutations are explicit preferences actions: libsecret may prompt to unlock.
    async saveKey(key, cancellable = null) {
        if (!key.trim())
            throw new SecretStoreError('empty', 'Enter an OpenCode Go API key first.');
        try {
            const {Secret, schema} = await this._binding();
            await this._items(Secret, schema, true, cancellable);
            const saved = await call(Secret, 'password_store', [schema, ATTRIBUTES, Secret.COLLECTION_DEFAULT,
                'OpenCode Go API key — Codex Claude Usage', key.trim(), cancellable]);
            if (!saved)
                throw new Error();
        } catch (error) {
            throw safeError(error);
        }
    }

    async removeKey(cancellable = null) {
        try {
            const {Secret, schema} = await this._binding();
            const [item] = await this._items(Secret, schema, true, cancellable);
            if (item && !await call(item, 'delete', [cancellable]))
                throw new Error();
        } catch (error) {
            throw safeError(error);
        }
    }
}
