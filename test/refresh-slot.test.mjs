import test from 'node:test';
import assert from 'node:assert/strict';
import {RefreshSlot} from '../codex-claude-usage@gitii.github.io/lib/refresh-slot.js';

function fixture() {
    const reads = [];
    const values = [];
    const slot = new RefreshSlot(() => new Promise(resolve => reads.push(resolve)), value => values.push(value));
    return {slot, reads, values};
}

test('ordinary concurrent refreshes are suppressed, not queued', async () => {
    const {slot, reads, values} = fixture();
    const pending = slot.refresh();
    await slot.refresh();
    await slot.refresh();
    reads[0]('current');
    await pending;
    assert.equal(reads.length, 1);
    assert.deepEqual(values, ['current']);
});

test('replacement in flight suppresses old account and queues only one new read', async () => {
    const {slot, reads, values} = fixture();
    const pending = slot.refresh();
    slot.invalidate();
    await slot.refresh(true);
    await slot.refresh(true);
    assert.equal(reads.length, 1);
    reads[0]('old account');
    await Promise.resolve();
    assert.equal(reads.length, 2);
    assert.deepEqual(values, []);
    reads[1]('new account');
    await pending;
    assert.deepEqual(values, ['new account']);
});

test('removal or hiding clears queued refresh and invalidates late values', async () => {
    const {slot, reads, values} = fixture();
    const pending = slot.refresh();
    await slot.refresh(true);
    slot.invalidate();
    reads[0]('removed account');
    await pending;
    assert.deepEqual(values, []);
    assert.equal(reads.length, 1);
    const enabled = slot.refresh();
    reads[1]('re-enabled account');
    await enabled;
    assert.deepEqual(values, ['re-enabled account']);
});

test('destroy releases callbacks and ignores late results, even with replacement queued', async () => {
    const {slot, reads, values} = fixture();
    const pending = slot.refresh();
    await slot.refresh(true);
    slot.destroy();
    reads[0]('late');
    await pending;
    await slot.refresh();
    assert.deepEqual(values, []);
    assert.equal(slot._publish, null);
    assert.equal(reads.length, 1);
});
