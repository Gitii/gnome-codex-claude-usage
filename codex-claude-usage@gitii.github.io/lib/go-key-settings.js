import {GoSecretStore} from './secret-store.js';

// Only nonsecret state crosses the preferences/Shell process boundary.
export class GoKeySettings {
    constructor(settings, store = new GoSecretStore()) {
        this._settings = settings;
        this.store = store;
    }

    _publish(visible) {
        this._settings.set_boolean('show-opencode-go', visible);
        const revision = this._settings.get_uint('opencode-go-key-revision');
        this._settings.set_uint('opencode-go-key-revision', (revision + 1) >>> 0);
    }

    async save(key, cancellable = null) {
        await this.store.saveKey(key, cancellable);
        this._publish(true);
    }

    async remove(cancellable = null) {
        await this.store.removeKey(cancellable);
        this._publish(false);
    }
}
