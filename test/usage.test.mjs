// Unit tests for the provider-neutral usage model (no GNOME imports needed).
// Run with: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clampPercent, displayPercent, formatReset, makeWindow, panelWindow, panelWindows, severityClass, titleForKey, titleForWindowSeconds,
} from '../codex-claude-usage@gitii.github.io/lib/usage.js';

test('clampPercent bounds and coerces', () => {
    assert.equal(clampPercent(-5), 0);
    assert.equal(clampPercent(150), 100);
    assert.equal(clampPercent('42.5'), 42.5);
    assert.equal(clampPercent(undefined), 0);
    assert.equal(clampPercent(NaN), 0);
});

test('makeWindow normalises reset times', () => {
    assert.equal(makeWindow('primary', 10, 0).resetsAt, null);
    assert.equal(makeWindow('primary', 10, null).resetsAt, null);
    assert.equal(makeWindow('primary', 10, 1700000000.7).resetsAt, 1700000000);
    assert.equal(makeWindow('secondary', 10, 1).title, 'Weekly window');
});

test('displayPercent switches semantics', () => {
    assert.equal(displayPercent(30, 'used'), 30);
    assert.equal(displayPercent(30, 'remaining'), 70);
});

test('severityClass thresholds on used share', () => {
    assert.equal(severityClass(0), 'usage-low');
    assert.equal(severityClass(49.9), 'usage-low');
    assert.equal(severityClass(50), 'usage-medium');
    assert.equal(severityClass(75), 'usage-high');
    assert.equal(severityClass(90), 'usage-critical');
});

test('panelWindow picks by mode', () => {
    const usage = {
        state: 'ok',
        windows: [makeWindow('primary', 20, null), makeWindow('secondary', 80, null)],
    };
    assert.equal(panelWindow(usage, 'primary').id, 'primary');
    assert.equal(panelWindow(usage, 'secondary').id, 'secondary');
    assert.equal(panelWindow(usage, 'max').id, 'secondary');
    assert.equal(panelWindow({state: 'error', windows: []}, 'primary'), null);
    // missing window falls back to the first one
    assert.equal(panelWindow({state: 'ok', windows: [usage.windows[0]]}, 'secondary').id, 'primary');
});

test('formatReset granularity', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(formatReset(null), '—');
    assert.equal(formatReset(now - 10), 'now');
    assert.equal(formatReset(now + 45), 'in 45s');
    assert.equal(formatReset(now + 125), 'in 2m 5s');
    assert.equal(formatReset(now + 20 * 60), 'in 20m');
    assert.equal(formatReset(now + 2 * 3600 + 15 * 60), 'in 2h 15m');
    assert.equal(formatReset(now + 3 * 86400 + 4 * 3600), 'in 3d 4h');
});

test('titleForKey humanises per-model keys', () => {
    assert.equal(titleForKey('seven_day_fable'), 'Weekly · Fable');
    assert.equal(titleForKey('seven_day_opus'), 'Weekly · Opus');
    assert.equal(titleForKey('five_hour_sonnet'), '5-hour · Sonnet');
    assert.equal(titleForKey('seven_day'), 'Weekly window');
    assert.equal(titleForKey('some_other_thing'), 'Some Other Thing');
    assert.equal(makeWindow('seven_day_fable', 5, null).standard, false);
    assert.equal(makeWindow('primary', 5, null).standard, true);
});

test('panelWindow max ignores per-model windows', () => {
    const usage = {
        state: 'ok',
        windows: [
            makeWindow('primary', 20, null),
            makeWindow('secondary', 30, null),
            makeWindow('seven_day_fable', 99, null),
        ],
    };
    assert.equal(panelWindow(usage, 'max').id, 'secondary');
});

test('titleForWindowSeconds recognises common window lengths', () => {
    assert.equal(titleForWindowSeconds(18000), '5-hour window');
    assert.equal(titleForWindowSeconds(86400), 'Daily window');
    assert.equal(titleForWindowSeconds(604800), 'Weekly window');
    assert.equal(titleForWindowSeconds(30 * 86400), 'Monthly window');
    assert.equal(titleForWindowSeconds(3 * 3600), '3-hour window');
    assert.equal(titleForWindowSeconds(3 * 86400), '3-day window');
    assert.equal(titleForWindowSeconds(0), null);
    assert.equal(titleForWindowSeconds(undefined), null);
});

test('panelWindows stacks the standard windows', () => {
    const usage = {
        state: 'ok',
        windows: [
            makeWindow('primary', 20, null),
            makeWindow('secondary', 30, null),
            makeWindow('weekly_scoped:Fable', 99, null, 'Weekly · Fable'),
        ],
    };
    assert.deepEqual(panelWindows(usage, 'both').map(w => w.id), ['primary', 'secondary']);
    assert.deepEqual(panelWindows(usage, 'secondary').map(w => w.id), ['secondary']);
    // single-window providers (e.g. a weekly-only Codex plan) stay one row
    assert.deepEqual(panelWindows({state: 'ok', windows: [usage.windows[0]]}, 'both').map(w => w.id), ['primary']);
    assert.deepEqual(panelWindows({state: 'ok', windows: []}, 'both'), []);
});
