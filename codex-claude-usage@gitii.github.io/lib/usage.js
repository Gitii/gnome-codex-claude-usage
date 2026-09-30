// Provider-neutral usage model shared by the Codex and Claude providers and
// by the UI.

/**
 * @typedef {object} UsageWindow
 * @property {'primary'|'secondary'} id
 * @property {string} title - human label, e.g. "5-hour window"
 * @property {number} usedPercent - 0..100
 * @property {number|null} resetsAt - unix epoch seconds or null if unknown
 */

/**
 * @typedef {object} ProviderUsage
 * @property {'ok'|'no-credentials'|'expired'|'error'} state
 * @property {UsageWindow[]} windows - ordered primary, secondary
 * @property {string} [plan]
 * @property {string} [account]
 * @property {boolean} [limitReached]
 * @property {{label: string, value: string}[]} [extras] - extra info rows
 *   shown under the windows, e.g. banked resets
 * @property {string} [message] - error/hint text when state !== 'ok'
 */

export const STATE_OK = 'ok';
export const STATE_NO_CREDENTIALS = 'no-credentials';
export const STATE_EXPIRED = 'expired';
export const STATE_ERROR = 'error';

export const WINDOW_TITLES = {
    primary: '5-hour window',
    secondary: 'Weekly window',
};

/**
 * Title for a rate-limit window of a given length in seconds.
 * Tolerates the slightly off values providers report.
 */
export function titleForWindowSeconds(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    const hours = n / 3600;
    if (Math.abs(hours - 5) < 1)
        return '5-hour window';
    if (Math.abs(hours - 24) < 2)
        return 'Daily window';
    if (Math.abs(hours - 24 * 7) < 12)
        return 'Weekly window';
    if (Math.abs(hours - 24 * 30) < 48)
        return 'Monthly window';
    if (hours < 48)
        return `${Math.round(hours)}-hour window`;
    return `${Math.round(hours / 24)}-day window`;
}

/**
 * Turn an API key such as "seven_day_fable" into a readable title.
 * Known model names are capitalised; anything else is humanised.
 */
export function titleForKey(key) {
    const models = {opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', mythos: 'Mythos'};
    let k = String(key);
    let period = null;
    if (k.startsWith('seven_day')) {
        period = 'Weekly';
        k = k.slice('seven_day'.length);
    } else if (k.startsWith('five_hour')) {
        period = '5-hour';
        k = k.slice('five_hour'.length);
    }
    const rest = k.replace(/^_+/, '').split('_').filter(Boolean)
        .map(w => models[w] ?? w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (period && rest)
        return `${period} · ${rest}`;
    if (period)
        return `${period} window`;
    return rest || String(key);
}

export function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(100, n));
}

export function makeWindow(id, usedPercent, resetsAt, title = null) {
    return {
        id,
        title: title ?? WINDOW_TITLES[id] ?? titleForKey(id),
        /** true for the two standard windows, false for per-model extras */
        standard: id === 'primary' || id === 'secondary',
        usedPercent: clampPercent(usedPercent),
        resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? Math.floor(resetsAt) : null,
    };
}

export function errorUsage(state, message) {
    return {state, windows: [], message};
}

/**
 * Pick the window that drives the panel value.
 *
 * @param {ProviderUsage} usage
 * @param {'primary'|'secondary'|'max'} mode
 * @returns {UsageWindow|null}
 */
export function panelWindow(usage, mode) {
    if (!usage || usage.windows.length === 0)
        return null;
    if (mode === 'max') {
        const candidates = usage.windows.filter(w => w.standard);
        return (candidates.length ? candidates : usage.windows)
            .reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
    }
    return usage.windows.find(w => w.id === mode) ?? usage.windows[0];
}

/**
 * Convert a used percentage into the value shown to the user.
 *
 * @param {number} usedPercent
 * @param {'used'|'remaining'} percentMode
 */
export function displayPercent(usedPercent, percentMode) {
    return percentMode === 'remaining' ? 100 - usedPercent : usedPercent;
}

/** Severity class for colouring, always judged on the used share. */
export function severityClass(usedPercent) {
    if (usedPercent >= 90)
        return 'usage-critical';
    if (usedPercent >= 75)
        return 'usage-high';
    if (usedPercent >= 50)
        return 'usage-medium';
    return 'usage-low';
}

export function secondsUntil(epochSeconds) {
    if (epochSeconds === null || epochSeconds === undefined)
        return null;
    return Math.max(0, epochSeconds - Math.floor(Date.now() / 1000));
}

/**
 * Format the time until a reset. Under five minutes it includes seconds so a
 * one-second countdown tick makes sense.
 */
export function formatReset(epochSeconds) {
    const remaining = secondsUntil(epochSeconds);
    if (remaining === null)
        return '—';
    if (remaining <= 0)
        return 'now';

    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;

    if (days > 0)
        return `in ${days}d ${hours}h`;
    if (hours > 0)
        return `in ${hours}h ${minutes}m`;
    if (remaining < 300)
        return minutes > 0 ? `in ${minutes}m ${seconds}s` : `in ${seconds}s`;
    return `in ${minutes}m`;
}

export const COUNTDOWN_THRESHOLD_SEC = 300;
