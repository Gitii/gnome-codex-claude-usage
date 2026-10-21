// Only invoked by the isolated nested harness, never installed with the extension.
import Gio from 'gi://Gio';
import {GoKeySettings} from '../codex-claude-usage@gitii.github.io/lib/go-key-settings.js';

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.codex-claude-usage'});
const keys = new GoKeySettings(settings);
if (ARGV[0] === 'remove')
    await keys.remove();
else
    await keys.save(ARGV[0] === 'rejected' ? 'rejected-dummy-key' : 'go-dummy-key');
Gio.Settings.sync();
print('Isolated mock Go key action completed');
