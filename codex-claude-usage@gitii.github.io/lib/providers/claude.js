// Claude Code provider.
//
// Credentials: the file written by `claude login`, by default
// ~/.claude/.credentials.json (or $CLAUDE_CONFIG_DIR/.credentials.json).
// Claude Code refreshes its own tokens whenever it runs, so this provider is
// strictly read-only and reports an expired token instead of refreshing it.

import GLib from 'gi://GLib';

import {HttpError} from '../http.js';
import {readFirstJson} from '../credentials.js';
import {
    STATE_ERROR, STATE_EXPIRED, STATE_NO_CREDENTIALS, STATE_OK,
    errorUsage, makeWindow,
} from '../usage.js';

export const ID = 'claude';
export const NAME = 'Claude Code';
export const ICON = 'claude-symbolic.svg';
export const LOGIN_HINT = 'Run "claude" and log in, then refresh';

export function credentialPaths() {
    const configDir = GLib.getenv('CLAUDE_CONFIG_DIR') ||
        GLib.build_filenamev([GLib.get_home_dir(), '.claude']);
    return [GLib.build_filenamev([configDir, '.credentials.json'])];
}

function isoToEpoch(value) {
    if (typeof value !== 'string')
        return null;
    const dt = GLib.DateTime.new_from_iso8601(value, GLib.TimeZone.new_utc());
    return dt ? dt.to_unix() : null;
}

// The two standard windows come first; any other object with a numeric
// utilization (seven_day_opus, seven_day_fable, ...) is a per-model window and
// is shown after them under a title derived from its key.
const STANDARD_KEYS = {five_hour: 'primary', seven_day: 'secondary'};

function isWindow(value) {
    return value && typeof value === 'object' && typeof value.utilization === 'number';
}

export function parseWindows(payload) {
    const windows = [];
    for (const [key, id] of Object.entries(STANDARD_KEYS)) {
        if (isWindow(payload[key]))
            windows.push(makeWindow(id, payload[key].utilization, isoToEpoch(payload[key].resets_at)));
    }
    for (const [key, value] of Object.entries(payload)) {
        if (key in STANDARD_KEYS || !isWindow(value))
            continue;
        windows.push(makeWindow(key, value.utilization, isoToEpoch(value.resets_at)));
    }
    return windows;
}

/**
 * @param {import('../http.js').HttpClient} http
 * @param {Gio.Settings} settings
 * @returns {Promise<import('../usage.js').ProviderUsage>}
 */
export async function fetchUsage(http, settings) {
    const creds = await readFirstJson(credentialPaths(),
        data => typeof data?.claudeAiOauth?.accessToken === 'string');
    if (!creds)
        return errorUsage(STATE_NO_CREDENTIALS, LOGIN_HINT);

    const oauth = creds.data.claudeAiOauth;
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt < Date.now())
        return errorUsage(STATE_EXPIRED, 'Token expired. ' + LOGIN_HINT);

    let payload;
    try {
        payload = await http.requestJson('GET', settings.get_string('claude-usage-url'), {
            headers: {
                'Authorization': `Bearer ${oauth.accessToken}`,
                'anthropic-beta': 'oauth-2025-04-20',
            },
        });
    } catch (e) {
        if (e instanceof HttpError && (e.status === 401 || e.status === 403))
            return errorUsage(STATE_EXPIRED, 'Token rejected. ' + LOGIN_HINT);
        return errorUsage(STATE_ERROR, e.message);
    }

    const windows = parseWindows(payload);

    if (windows.length === 0)
        return errorUsage(STATE_ERROR, 'Unexpected response from the usage API');

    return {
        state: STATE_OK,
        windows,
        plan: oauth.subscriptionType ? String(oauth.subscriptionType) : undefined,
        limitReached: windows.some(w => w.usedPercent >= 100),
    };
}
