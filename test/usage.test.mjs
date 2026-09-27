// Unit tests for the provider-neutral usage model (no GNOME imports needed).
// Run with: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clampPercent, displayPercent, formatReset, makeWindow, panelWindow, severityClass,
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
