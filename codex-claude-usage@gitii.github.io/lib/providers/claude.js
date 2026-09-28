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
    errorUsage, makeWindow, titleForKey,
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

// Preferred source: the `limits` array. Each entry has a kind ("session",
// "weekly_all", "weekly_scoped", ...), an integer percent, resets_at and an
// optional scope naming a model or surface. The scoped weekly entries are the
// per-model quotas (e.g. Fable on Max plans).
//
// Fallback for older responses: the five_hour / seven_day objects. The other
// top-level keys are internal code names and are never shown.
const LIMIT_KINDS = {session: 'primary', weekly_all: 'secondary'};

function scopeName(scope) {
    return scope?.model?.display_name ?? scope?.surface?.display_name ??
        scope?.model?.id ?? scope?.surface?.id ?? null;
}

function limitTitle(limit) {
    const name = scopeName(limit.scope);
    const group = limit.group === 'weekly' || String(limit.kind).startsWith('weekly') ? 'Weekly'
        : limit.group === 'session' || limit.kind === 'session' ? '5-hour'
            : titleForKey(String(limit.group ?? limit.kind));
    return name ? `${group} · ${name}` : `${group} window`;
}

function isWindow(value) {
    return value && typeof value === 'object' && typeof value.utilization === 'number';
}

export function parseWindows(payload) {
    const windows = [];
    if (Array.isArray(payload.limits) && payload.limits.length > 0) {
        const standard = [];
        const scoped = [];
        for (const limit of payload.limits) {
            if (!limit || typeof limit.percent !== 'number')
                continue;
            const resetsAt = isoToEpoch(limit.resets_at);
            const id = LIMIT_KINDS[limit.kind];
            if (id)
                standard.push(makeWindow(id, limit.percent, resetsAt));
            else
                scoped.push(makeWindow(`${limit.kind}:${scopeName(limit.scope) ?? ''}`, limit.percent, resetsAt, limitTitle(limit)));
        }
        standard.sort((a, b) => (a.id === 'primary' ? -1 : 1) - (b.id === 'primary' ? -1 : 1));
        // The limits array rounds to whole percent; the legacy objects carry
        // decimals, so prefer those for the two standard windows when present.
        for (const window of standard) {
            const legacy = window.id === 'primary' ? payload.five_hour : payload.seven_day;
            if (isWindow(legacy))
                window.usedPercent = makeWindow(window.id, legacy.utilization, null).usedPercent;
        }
        windows.push(...standard, ...scoped);
        if (windows.length > 0)
            return windows;
    }
    if (isWindow(payload.five_hour))
        windows.push(makeWindow('primary', payload.five_hour.utilization, isoToEpoch(payload.five_hour.resets_at)));
    if (isWindow(payload.seven_day))
        windows.push(makeWindow('secondary', payload.seven_day.utilization, isoToEpoch(payload.seven_day.resets_at)));
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
