import test from 'node:test';
import assert from 'node:assert/strict';
import {GoSecretStore, SecretStoreError} from '../codex-claude-usage@gitii.github.io/lib/secret-store.js';
import {GoKeySettings} from '../codex-claude-usage@gitii.github.io/lib/go-key-settings.js';

test('missing bindings are lazy and actionable without leaking loader errors', async () => {
    let loaded = false;
    const store = new GoSecretStore(async () => {
        loaded = true;
        throw new Error('sensitive service detail');
    });
    assert.equal(loaded, false);
    await assert.rejects(store.readKey(), error => error.code === 'missing-bindings' && !error.message.includes('sensitive'));
});

for (const code of ['locked', 'unavailable', 'storage-failure']) {
    test(`${code} preserves key, visibility and revision on failed replacement/removal`, async () => {
        const values = {'show-opencode-go': true, 'opencode-go-key-revision': 7};
        const settings = {
            get_uint: key => values[key],
            set_uint: (key, value) => { values[key] = value; },
            set_boolean: (key, value) => { values[key] = value; },
        };
        const store = {
            key: 'previous-dummy-key',
            async saveKey() { throw new SecretStoreError(code, 'Safe guidance'); },
            async removeKey() { throw new SecretStoreError(code, 'Safe guidance'); },
        };
        const keys = new GoKeySettings(settings, store);
        await assert.rejects(keys.save('new-dummy-key'));
        await assert.rejects(keys.remove());
        assert.equal(store.key, 'previous-dummy-key');
        assert.deepEqual(values, {'show-opencode-go': true, 'opencode-go-key-revision': 7});
    });
}

function fakeBinding() {
    const state = {key: 'old-dummy', locked: false, fail: false, flags: []};
    const result = (callback, value) => callback(null, value);
    const finish = value => {
        if (state.fail)
            throw new Error('do not expose dummy-secret or service details');
        return value;
    };
    const item = {
        get_locked: () => state.locked,
        load_secret: (_cancel, callback) => result(callback, true),
        load_secret_finish: finish,
        get_secret: () => ({get_text: () => state.key}),
        delete: (_cancel, callback) => {
            if (!state.fail) state.key = null;
            result(callback, !state.fail);
        },
        delete_finish: finish,
    };
    const service = {
        search: (_schema, _attributes, flags, _cancel, callback) => {
            state.flags.push(flags);
            result(callback, state.key === null ? [] : [item]);
        },
        search_finish: value => value,
    };
    const Secret = {
        Schema: class {}, SchemaFlags: {NONE: 0}, SchemaAttributeType: {STRING: 0},
        SearchFlags: {ALL: 1, UNLOCK: 2}, ServiceFlags: {OPEN_SESSION: 1}, COLLECTION_DEFAULT: 'default',
        Service: {get: (_flags, _cancel, callback) => result(callback, service), get_finish: value => value},
        password_store: (_schema, _attributes, _collection, _label, key, _cancel, callback) => {
            if (!state.fail) state.key = key;
            result(callback, !state.fail);
        },
        password_store_finish: finish,
    };
    return {state, store: new GoSecretStore(async () => ({default: Secret}))};
}

test('background lookup never requests unlock; locked storage fails safely', async () => {
    const {state, store} = fakeBinding();
    assert.equal(await store.readKey(), 'old-dummy');
    assert.equal(await store.hasKey(), true);
    state.locked = true;
    await assert.rejects(store.readKey(), error => error.code === 'locked');
    await assert.rejects(store.hasKey(), error => error.code === 'locked');
    assert.deepEqual(state.flags, [1, 1, 1, 1]);
});

test('libsecret failure is redacted and failed writes preserve previous value', async () => {
    const {state, store} = fakeBinding();
    state.fail = true;
    for (const operation of [() => store.saveKey('new-dummy'), () => store.removeKey(), () => store.readKey()]) {
        await assert.rejects(operation(), error => error.code === 'unavailable' && !error.message.includes('dummy-secret'));
        assert.equal(state.key, 'old-dummy');
    }
});
