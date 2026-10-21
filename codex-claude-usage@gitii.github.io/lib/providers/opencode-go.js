import GLib from 'gi://GLib';

import {HttpError} from '../http.js';
import {GoSecretStore, SecretStoreError} from '../secret-store.js';
import {errorUsage, makeWindow, STATE_ERROR, STATE_EXPIRED, STATE_NO_CREDENTIALS, STATE_OK} from '../usage.js';

export const ID = 'opencode-go';
export const NAME = 'OpenCode Go';
export const ICON = 'opencode-logo-dark-square.svg';
export const LIGHT_ICON = 'opencode-logo-light-square.svg';
export const LOGIN_HINT = 'Save an OpenCode Go API key in extension Settings.';
export function credentialPaths() {
    return [];
}

export function parseWindows(payload) {
    const usage = payload?.usage;
    return [['rolling', 'primary'], ['weekly', 'secondary'], ['monthly', 'monthly']]
        .flatMap(([key, id]) => {
            if (key !== 'rolling' && usage && !Object.hasOwn(usage, key))
                return [];
            const quota = usage?.[key];
            if (!quota || typeof quota.percent !== 'number' || !Number.isFinite(quota.percent))
                throw new Error(`Unexpected Go usage response: invalid ${key} quota.`);
            const reset = typeof quota.resetsAt === 'string'
                ? GLib.DateTime.new_from_iso8601(quota.resetsAt, GLib.TimeZone.new_utc()) : null;
            return [makeWindow(id, quota.percent, reset ? reset.to_unix() : null)];
        });
}

// The injectable store is a test boundary, never an environment-key fallback.
export async function fetchUsage(http, settings, store = new GoSecretStore(), cancellable = null) {
    try {
        const key = await store.readKey(cancellable);
        if (!key)
            return errorUsage(STATE_NO_CREDENTIALS, LOGIN_HINT);
        const payload = await http.requestJson('GET', settings.get_string('opencode-go-usage-url'), {
            headers: {Authorization: `Bearer ${key}`},
        });
        const windows = parseWindows(payload);
        return {state: STATE_OK, windows, limitReached: windows.some(w => w.usedPercent >= 100)};
    } catch (error) {
        if (error instanceof SecretStoreError)
            return errorUsage(STATE_ERROR, error.message);
        if (error instanceof HttpError) {
            if (error.status === 401)
                return errorUsage(STATE_EXPIRED, 'Go key rejected or expired. Replace it in Settings.');
            if (error.status === 403)
                return errorUsage(STATE_ERROR, 'Go access denied. Check the key’s workspace permissions and Go access in OpenCode Console.');
            return errorUsage(STATE_ERROR, `Go usage service returned HTTP ${error.status}. Try refreshing later.`);
        }
        if (error instanceof SyntaxError)
            return errorUsage(STATE_ERROR, 'Unexpected Go usage response: expected JSON. Try refreshing later.');
        // Never display a server body, bearer key, or transport exception text.
        return errorUsage(STATE_ERROR, error.message?.startsWith('Unexpected Go usage response:')
            ? error.message : 'Could not read Go usage. Check your connection, proxy and usage service, then refresh.');
    }
}
