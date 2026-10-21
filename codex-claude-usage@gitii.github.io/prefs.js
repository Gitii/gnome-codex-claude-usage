import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {GoKeySettings} from './lib/go-key-settings.js';

/** Bind an enum-typed string key to a combo row. */
function addComboRow(group, settings, key, title, subtitle, choices) {
    const row = new Adw.ComboRow({title, subtitle});
    const model = new Gtk.StringList();
    for (const {label} of choices)
        model.append(label);
    row.model = model;

    const sync = () => {
        const current = settings.get_string(key);
        const idx = choices.findIndex(c => c.value === current);
        if (idx >= 0 && row.selected !== idx)
            row.selected = idx;
    };
    sync();
    row.connect('notify::selected', () => {
        const choice = choices[row.selected];
        if (choice && settings.get_string(key) !== choice.value)
            settings.set_string(key, choice.value);
    });
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(id));
    group.add(row);
    return row;
}

function addSwitchRow(group, settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return row;
}

function addGoPreferences(page, settings) {
    const group = new Adw.PreferencesGroup({
        title: 'OpenCode Go',
        description: 'Store one API key in your desktop keyring. Hiding Go does not remove the saved key.',
    });
    page.add(group);
    addSwitchRow(group, settings, 'show-opencode-go', 'Show OpenCode Go', 'Show Go usage in the panel');
    // Gtk.Entry has no reveal button, unlike Adw.PasswordEntryRow.
    const entry = new Gtk.Entry({visibility: false, hexpand: true, placeholder_text: 'API key'});
    const entryRow = new Adw.ActionRow({title: 'New API key'});
    entryRow.add_suffix(entry);
    group.add(entryRow);
    const status = new Adw.ActionRow({title: 'Checking secure storage…'});
    group.add(status);
    const save = new Gtk.Button({label: 'Save key', valign: Gtk.Align.CENTER});
    const remove = new Gtk.Button({label: 'Remove saved key', valign: Gtk.Align.CENTER});
    status.add_suffix(save);
    status.add_suffix(remove);
    const keys = new GoKeySettings(settings);
    const cancellable = new Gio.Cancellable();
    let closed = false;
    group.connect('destroy', () => {
        closed = true;
        entry.text = '';
        cancellable.cancel();
    });
    const busy = value => {
        entry.sensitive = !value;
        save.sensitive = !value;
        remove.sensitive = !value;
    };
    const run = async action => {
        busy(true);
        try {
            if (action === 'save') {
                // Once submitted, finish the mutation and publish its result even
                // if preferences closes; cancellation can hide a committed write.
                await keys.save(entry.text);
                if (closed)
                    return;
                entry.text = '';
                status.title = 'Key saved';
            } else if (action === 'remove') {
                await keys.remove();
                if (closed)
                    return;
                status.title = 'No key saved';
            } else {
                const saved = await keys.store.hasKey(cancellable);
                if (closed)
                    return;
                status.title = saved ? 'Key saved' : 'No key saved';
            }
            status.subtitle = '';
        } catch (error) {
            if (!closed) {
                status.title = 'Secure storage error';
                status.subtitle = error.message;
            }
        } finally {
            if (!closed)
                busy(false);
        }
    };
    save.connect('clicked', () => run('save'));
    remove.connect('clicked', () => run('remove'));
    run('status');
}

export default class CodexClaudeUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const providers = new Adw.PreferencesGroup({
            title: 'Providers',
            description: 'Codex and Claude use tokens stored by their command-line tools. Log in with "codex login" or by running "claude".',
        });
        page.add(providers);
        addSwitchRow(providers, settings, 'show-codex', 'Codex', 'Show ChatGPT / Codex plan usage');
        addSwitchRow(providers, settings, 'show-claude', 'Claude Code', 'Show Claude Code plan usage');
        addGoPreferences(page, settings);

        const panel = new Adw.PreferencesGroup({title: 'Panel'});
        page.add(panel);
        addComboRow(panel, settings, 'display-mode', 'Display mode',
            'How each provider is shown in the top bar', [
                {value: 'text', label: 'Percentage'},
                {value: 'bar', label: 'Progress bar'},
                {value: 'both', label: 'Bar and percentage'},
            ]);
        addComboRow(panel, settings, 'percent-mode', 'Percentages show',
            'Quota already used (Claude style) or quota still available (Codex style)', [
                {value: 'used', label: 'Used'},
                {value: 'remaining', label: 'Remaining'},
            ]);
        addComboRow(panel, settings, 'panel-window', 'Panel value',
            'Which rate-limit window the top-bar number follows', [
                {value: 'both', label: '5-hour and weekly, stacked'},
                {value: 'primary', label: '5-hour window'},
                {value: 'secondary', label: 'Weekly window'},
                {value: 'max', label: 'Whichever is more used'},
            ]);
        addSwitchRow(panel, settings, 'show-icon', 'Show icons', 'Show the provider icons in the top bar');

        const menu = new Adw.PreferencesGroup({title: 'Menu'});
        page.add(menu);
        addSwitchRow(menu, settings, 'show-model-windows', 'Per-model windows',
            'Also list model-specific quotas the provider reports, such as the weekly Fable or Opus limit');

        const refresh = new Adw.PreferencesGroup({title: 'Refresh'});
        page.add(refresh);
        const spin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower: 30, upper: 3600, step_increment: 30, page_increment: 300}),
            valign: Gtk.Align.CENTER,
            numeric: true,
        });
        settings.bind('refresh-interval', spin, 'value', Gio.SettingsBindFlags.DEFAULT);
        const spinRow = new Adw.ActionRow({
            title: 'Refresh interval',
            subtitle: 'Seconds between usage requests',
            activatable_widget: spin,
        });
        spinRow.add_suffix(spin);
        refresh.add(spinRow);

        const network = new Adw.PreferencesGroup({title: 'Network'});
        page.add(network);
        const proxy = new Adw.EntryRow({title: 'Proxy URL', show_apply_button: true});
        proxy.text = settings.get_string('proxy-url');
        proxy.connect('apply', () => settings.set_string('proxy-url', proxy.text));
        network.add(proxy);
        network.add(new Gtk.Label({
            label: 'Example: http://localhost:3128. Leave empty to use the system proxy settings.',
            xalign: 0,
            css_classes: ['dim-label', 'caption'],
            margin_start: 12,
            margin_top: 4,
        }));
    }
}
