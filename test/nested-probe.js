// Optional test-only extension, copied into the disposable nested profile.
// Never included in the distributed extension ZIP.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Secret from 'gi://Secret?version=1';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'codex-claude-usage@gitii.github.io';
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

function check(value, message) {
    if (!value)
        throw new Error(message);
    console.log(`GO UI: ${message}`);
}

async function screenshot(name) {
    const dir = GLib.getenv('CCU_EVIDENCE_DIR');
    if (!dir)
        return;
    GLib.mkdir_with_parents(dir, 0o700);
    const file = Gio.File.new_for_path(`${dir}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
}

async function run() {
    await wait(5000);
    const extension = Main.extensionManager.lookup(UUID).stateObj;
    const settings = extension._settings;
    let indicator = extension._indicator;
    check(indicator._usage.get('opencode-go')?.windows.length === 3, 'three Go quotas loaded from mock using saved key');
    Main.overview.hide();
    indicator.menu.open();
    await wait(500);
    const segment = indicator._segments.get('opencode-go');
    const section = indicator._sections.get('opencode-go');
    check(segment._rows[1].visible, 'stacked panel has weekly second row');
    settings.set_boolean('show-model-windows', false);
    check(section._bars.has('monthly'), 'monthly displayed with per-model windows off');
    for (const mode of ['text', 'bar', 'both']) {
        settings.set_string('display-mode', mode);
        check(segment._rows[0]._label.visible === (mode !== 'bar'), `${mode} label visibility`);
        check(segment._rows[0]._track.visible === (mode !== 'text'), `${mode} bar visibility`);
    }
    settings.set_string('display-mode', 'both');
    settings.set_boolean('show-icon', false);
    check(!segment._icon.visible, 'panel icon hides');
    settings.set_boolean('show-icon', true);
    check(segment._icon.visible, 'panel icon returns');
    settings.set_string('panel-window', 'max');
    check(segment._rows[0]._label.text === '92%', 'Highest usage selects monthly');
    settings.set_string('percent-mode', 'remaining');
    check(segment._rows[0]._label.text === '8%', 'remaining semantics');
    settings.set_string('percent-mode', 'used');
    settings.set_string('panel-window', 'primary');
    check(!segment._rows[1].visible, 'primary mode uses one row');
    settings.set_string('panel-window', 'secondary');
    check(segment._rows[0]._label.text === '1%', 'weekly mode');
    settings.set_string('panel-window', 'both');
    for (const light of [false, true]) {
        const style = light ? 'background-color: #fafafa; color: #111111;' : 'background-color: #202020; color: #eeeeee;';
        segment.set_style(style);
        section.set_style(style);
        await wait(500);
        const expected = light ? 'light' : 'dark';
        check(segment._icon.gicon.get_file().get_basename() === `opencode-logo-${expected}-square.svg`, `${expected} panel official variant`);
        check(section._icon.gicon.get_file().get_basename() === `opencode-logo-${expected}-square.svg`, `${expected} menu official variant`);
        await screenshot(`go-${expected}`);
    }
    segment.set_style(null);
    section.set_style(null);
    const mutate = action => new Promise((resolve, reject) => {
        const process = Gio.Subprocess.new(['gjs', '-m', `${GLib.getenv('CCU_TEST_ROOT')}/test/seed-go-key.js`, action],
            Gio.SubprocessFlags.NONE);
        process.wait_check_async(null, (_source, result) => {
            try { resolve(process.wait_check_finish(result)); } catch (error) { reject(error); }
        });
    });
    const keys = {
        remove: () => mutate('remove'),
        save: key => mutate(key === 'go-dummy-key' ? 'save' : 'rejected'),
    };
    await keys.remove();
    await wait(250);
    check(!segment.visible && !settings.get_boolean('show-opencode-go'), 'remove hides running Go');
    await keys.save('go-dummy-key');
    await wait(1000);
    check(segment.visible && indicator._usage.get('opencode-go')?.state === 'ok', 'save enables running Go without reload');
    await keys.save('rejected-dummy-key');
    await wait(1000);
    check(indicator._usage.get('opencode-go')?.state === 'error', 'replacement clears previous quotas');
    await keys.save('go-dummy-key');
    await wait(1000);
    check(indicator._usage.get('opencode-go')?.state === 'ok', 'replacement recovers without reload');
    extension.disable();
    extension.enable();
    await wait(1000);
    indicator = extension._indicator;
    check(indicator._usage.get('opencode-go')?.state === 'ok', 'disable/re-enable reloads current saved key');
    indicator.menu.open();
    await screenshot('go-reenabled');
    const service = await new Promise((resolve, reject) => Secret.Service.get(
        Secret.ServiceFlags.LOAD_COLLECTIONS, null, (_source, result) => {
            try { resolve(Secret.Service.get_finish(result)); } catch (error) { reject(error); }
        }));
    await new Promise((resolve, reject) => service.lock(service.get_collections(), null, (_source, result) => {
        try { resolve(service.lock_finish(result)); } catch (error) { reject(error); }
    }));
    extension._refreshAll();
    await wait(1000);
    const usage = indicator._usage.get('opencode-go');
    check(usage.state === 'error' && usage.message.includes('Unlock'), 'locked keyring shows actionable Go guidance');
    check(indicator._usage.get('codex')?.state === 'ok' && indicator._usage.get('claude')?.state === 'ok', 'keyring failure leaves other providers working');
    await screenshot('go-locked');
    indicator.menu.close();
    extension.openPreferences();
    await wait(5000);
    const preferences = global.get_window_actors().map(actor => actor.meta_window)
        .find(window => window.get_wm_class()?.includes('org.gnome.Shell.Extensions'));
    check(Boolean(preferences), 'preferences window opened');
    preferences.activate(global.get_current_time());
    await wait(500);
    await screenshot('go-preferences');
    extension.disable();
    console.log('GO UI PROBE PASSED');
    global.context.terminate();
}

export default class Probe extends Extension {
    enable() {
        run().catch(error => {
            console.error(`GO UI PROBE FAILED: ${error.stack}`);
            global.context.terminate();
        });
    }

    disable() {}
}
