// Codex (ChatGPT) provider.
//
// Credentials: the auth.json written by `codex login`, looked up in
// $CODEX_HOME, ~/.codex and ~/.config/codex. When the access token has
// expired the provider refreshes it *in memory only*; the CLI's file is never
// modified. Refreshed tokens are dropped as soon as the file changes on disk.

import GLib from 'gi://GLib';

import {HttpError} from '../http.js';
import {decodeJwtPayload, readFirstJson} from '../credentials.js';
import {
    STATE_ERROR, STATE_EXPIRED, STATE_NO_CREDENTIALS, STATE_OK,
    errorUsage, makeWindow, titleForWindowSeconds,
} from '../usage.js';

export const ID = 'codex';
export const NAME = 'Codex';
export const ICON = 'codex-symbolic.svg';
export const LOGIN_HINT = 'Run "codex login", then refresh';

const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_SCOPE = 'openid profile email offline_access';

export function credentialPaths() {
    const paths = [];
    const codexHome = GLib.getenv('CODEX_HOME');
    if (codexHome)
        paths.push(GLib.build_filenamev([codexHome, 'auth.json']));
    paths.push(GLib.build_filenamev([GLib.get_home_dir(), '.codex', 'auth.json']));
    paths.push(GLib.build_filenamev([GLib.get_user_config_dir(), 'codex', 'auth.json']));
    return paths;
}

function hasOauthTokens(data) {
    if (data?.OPENAI_API_KEY)
        return false; // API-key mode: no plan usage to show
    return typeof data?.tokens?.access_token === 'string';
}

function extractAccountId(tokens) {
    if (tokens.account_id)
        return tokens.account_id;
    for (const token of [tokens.id_token, tokens.access_token]) {
        const claims = decodeJwtPayload(token);
        for (const key of ['chatgpt_account_id', 'account_id', 'https://api.openai.com/auth']) {
            let value = claims[key];
            if (value && typeof value === 'object')
                value = value.chatgpt_account_id ?? value.account_id;
            if (typeof value === 'string' && value)
                return value;
        }
    }
    return null;
}

function extractEmail(tokens) {
    for (const token of [tokens.id_token, tokens.access_token]) {
        const email = decodeJwtPayload(token).email;
        if (typeof email === 'string' && email)
            return email;
    }
    return null;
}

/** In-memory tokens obtained by refreshing, keyed by the source file state. */
let refreshed = null;

function currentTokens(creds) {
    if (refreshed && refreshed.path === creds.path && refreshed.mtime === creds.mtime)
        return refreshed.tokens;
    refreshed = null;
    return creds.data.tokens;
}

async function refreshTokens(http, settings, creds, tokens) {
    if (!tokens.refresh_token)
        throw new Error('no refresh token');
    const data = await http.requestJson('POST', settings.get_string('codex-token-url'), {
        json: {
            client_id: OAUTH_CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            scope: OAUTH_SCOPE,
        },
    });
    const next = {
        access_token: data.access_token ?? tokens.access_token,
        refresh_token: data.refresh_token ?? tokens.refresh_token,
        id_token: data.id_token ?? tokens.id_token,
        account_id: tokens.account_id,
    };
    refreshed = {path: creds.path, mtime: creds.mtime, tokens: next};
    return next;
}

async function requestUsage(http, settings, tokens) {
    const headers = {Authorization: `Bearer ${tokens.access_token}`};
    const accountId = extractAccountId(tokens);
    if (accountId)
        headers['ChatGPT-Account-Id'] = accountId;
    return http.requestJson('GET', settings.get_string('codex-usage-url'), {headers});
}

/** Banked rate-limit resets: how many are stored and how many apply now. */
export function parseExtras(payload) {
    const extras = [];
    const credits = payload.rate_limit_reset_credits;
    if (credits && typeof credits.available_count === 'number') {
        const available = credits.available_count;
        const applicable = credits.applicable_available_count;
        let value = String(available);
        if (typeof applicable === 'number' && applicable !== available)
            value += ` (${applicable} usable now)`;
        extras.push({label: 'Banked resets', value});
    }
    return extras;
}

function isUnauthorized(e) {
    return e instanceof HttpError && (e.status === 401 || e.status === 403);
}

/**
 * @param {import('../http.js').HttpClient} http
 * @param {Gio.Settings} settings
 * @returns {Promise<import('../usage.js').ProviderUsage>}
 */
export async function fetchUsage(http, settings) {
    const creds = await readFirstJson(credentialPaths(), hasOauthTokens);
    if (!creds)
        return errorUsage(STATE_NO_CREDENTIALS, LOGIN_HINT);

    let tokens = currentTokens(creds);
    let payload;
    try {
        payload = await requestUsage(http, settings, tokens);
    } catch (e) {
        if (!isUnauthorized(e))
            return errorUsage(STATE_ERROR, e.message);
        try {
            tokens = await refreshTokens(http, settings, creds, tokens);
            payload = await requestUsage(http, settings, tokens);
        } catch (e2) {
            refreshed = null;
            if (isUnauthorized(e2) || e2 instanceof HttpError)
                return errorUsage(STATE_EXPIRED, 'Session expired. ' + LOGIN_HINT);
            return errorUsage(STATE_ERROR, e2.message);
        }
    }

    const rateLimit = payload.rate_limit ?? {};
    const windows = [];
    // The window length varies by plan (a Pro Lite account gets a single
    // weekly window as its primary), so title from limit_window_seconds.
    const toWindow = (id, w) => makeWindow(id, w.used_percent, w.reset_at,
        titleForWindowSeconds(w.limit_window_seconds));
    if (rateLimit.primary_window)
        windows.push(toWindow('primary', rateLimit.primary_window));
    if (rateLimit.secondary_window)
        windows.push(toWindow('secondary', rateLimit.secondary_window));

    if (windows.length === 0)
        return errorUsage(STATE_ERROR, 'Unexpected response from the usage API');

    return {
        state: STATE_OK,
        windows,
        plan: payload.plan_type ? String(payload.plan_type) : undefined,
        account: payload.email ?? extractEmail(tokens) ?? undefined,
        limitReached: Boolean(rateLimit.limit_reached),
        extras: parseExtras(payload),
    };
}

/** Forget any in-memory refreshed tokens (used on disable). */
export function reset() {
    refreshed = null;
}
