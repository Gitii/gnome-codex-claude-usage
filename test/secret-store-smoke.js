import Gio from 'gi://Gio';
import Secret from 'gi://Secret?version=1';
import {GoSecretStore} from '../codex-claude-usage@gitii.github.io/lib/secret-store.js';
import {GoKeySettings} from '../codex-claude-usage@gitii.github.io/lib/go-key-settings.js';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.codex-claude-usage'});
const observer = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.codex-claude-usage'});
let changes = 0;
observer.connect('changed::opencode-go-key-revision', () => changes++);
// Subscribe before changes (GSettings requires the key to have been read).
observer.get_uint('opencode-go-key-revision');
const keys = new GoKeySettings(settings);
const store = new GoSecretStore();
assert(!settings.get_boolean('show-opencode-go'), 'Go must start hidden');
assert(!await store.hasKey(), 'isolated keyring must start empty');
assert(await store.readKey() === null, 'missing key must be null');
try {
    await keys.save('dummy-go-key-one');
    assert(await store.hasKey(), 'saved metadata');
    assert(await store.readKey() === 'dummy-go-key-one', 'read saved key');
    assert(settings.get_boolean('show-opencode-go'), 'save enables Go');
    await keys.save('dummy-go-key-two');
    assert(await store.readKey() === 'dummy-go-key-two', 'replacement');
    assert(settings.get_uint('opencode-go-key-revision') === 2, 'replacement notification');
    await keys.remove();
    assert(await store.readKey() === null, 'removed');
    assert(!settings.get_boolean('show-opencode-go'), 'remove disables Go');
    assert(changes === 3, 'observer receives every mutation');
    await keys.remove();
    assert(changes === 4, 'successful removal of an absent key also notifies');

    // Real locked collection: reads must return an error without unlocking it.
    await keys.save('dummy-locked-key');
    const service = await new Promise((resolve, reject) => Secret.Service.get(
        Secret.ServiceFlags.LOAD_COLLECTIONS, null, (_source, result) => {
            try { resolve(Secret.Service.get_finish(result)); } catch (error) { reject(error); }
        }));
    const collections = service.get_collections();
    await new Promise((resolve, reject) => service.lock(collections, null, (_source, result) => {
        try { resolve(service.lock_finish(result)); } catch (error) { reject(error); }
    }));
    for (let i = 0; i < 2; i++) {
        let locked = false;
        try { await store.readKey(); } catch (error) { locked = error.code === 'locked'; }
        assert(locked, 'locked read must fail without prompting');
    }
    assert(collections.some(collection => collection.get_locked()), 'reads leave persistent collection locked');
    print('Secret Service save/read/replace/remove, settings notifications, and locked reads passed');
} finally {
    // The whole temporary keyring and its private bus are discarded by the runner.
}
