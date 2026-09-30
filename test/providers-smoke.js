// Integration smoke test for the provider modules, run under gjs against the
// mock API (scripts/test-providers.sh drives it). Exercises real GLib, Gio and
// Soup code paths without a GNOME Shell.
//
//   gjs -m test/providers-smoke.js <mock-base-url> <expected-scenario>

import GLib from 'gi://GLib';
import System from 'system';

// Static imports: dynamic import() in GJS needs a running main loop.
import {HttpClient} from '../codex-claude-usage@gitii.github.io/lib/http.js';
import * as Codex from '../codex-claude-usage@gitii.github.io/lib/providers/codex.js';
import * as Claude from '../codex-claude-usage@gitii.github.io/lib/providers/claude.js';

const [base, scenario] = ARGV;

const settings = {
    _values: {
        'codex-usage-url': `${base}/backend-api/wham/usage`,
        'codex-token-url': `${base}/oauth/token`,
        'claude-usage-url': `${base}/api/oauth/usage`,
    },
    get_string(key) {
        return this._values[key];
    },
};

function expect(cond, message) {
    if (!cond)
        throw new Error(`FAIL: ${message}`);
    print(`  ok: ${message}`);
}

const loop = new GLib.MainLoop(null, false);
let failed = false;

(async () => {
    const http = new HttpClient('');
    try {
        print(`Scenario: ${scenario}`);
        const codex = await Codex.fetchUsage(http, settings);
        const claude = await Claude.fetchUsage(http, settings);
        print(`codex:  ${JSON.stringify(codex)}`);
        print(`claude: ${JSON.stringify(claude)}`);

        switch (scenario) {
            case 'normal':
            case 'codex-expired':
            // codex-expired starts with a stale token; the in-memory refresh
            // must recover transparently.
                expect(codex.state === 'ok', 'codex fetch succeeds');
                expect(codex.windows.length === 2, 'codex has two windows');
                expect(codex.windows[0].usedPercent === 37, 'codex primary used 37%');
                expect(codex.plan === 'plus', 'codex plan parsed');
                expect(codex.account === 'tester@example.com', 'codex email parsed');
                expect(codex.windows[1].resetsAt > Date.now() / 1000, 'codex reset time in the future');
                expect(codex.windows[0].title === '5-hour window' && codex.windows[1].title === 'Weekly window',
                    'codex window titles derived from limit_window_seconds');
                expect(codex.extras.length === 1 && codex.extras[0].label === 'Banked resets' &&
                    codex.extras[0].value === '2 (0 usable now)', 'codex banked resets parsed');
                expect(claude.state === 'ok', 'claude fetch succeeds');
                expect(claude.windows[0].usedPercent === 81.5, 'claude primary keeps decimal utilization');
                expect(claude.windows[1].id === 'secondary', 'claude secondary window present');
                expect(claude.windows[0].resetsAt !== null, 'claude reset time parsed from ISO 8601');
                expect(claude.plan === 'max', 'claude subscription type parsed');
                expect(claude.windows.length === 3, 'claude has 5h, weekly and the Fable window only');
                expect(claude.windows[2].usedPercent === 64, 'claude Fable window parsed from limits');
                expect(claude.windows[2].title === 'Weekly · Fable', 'Fable window titled from scope');
                expect(claude.windows[2].standard === false, 'Fable window marked non-standard');
                expect(!claude.windows.some(w => /iguana|nimbus/.test(w.id)),
                    'internal code-name keys are not shown');
                break;
            case 'claude-expired':
                expect(claude.state === 'expired', 'claude reports expired token without a request');
                expect(codex.state === 'ok', 'codex unaffected');
                break;
            case 'limit':
                expect(codex.limitReached === true, 'codex limit reached');
                expect(claude.limitReached === true, 'claude limit reached at 100%');
                break;
            case 'offline':
                expect(codex.state === 'error', 'codex reports a network error');
                expect(claude.state === 'error', 'claude reports a network error');
                break;
            case 'no-credentials':
                expect(codex.state === 'no-credentials', 'codex reports missing credentials');
                expect(claude.state === 'no-credentials', 'claude reports missing credentials');
                break;
            default:
                throw new Error(`unknown scenario ${scenario}`);
        }
    } catch (e) {
        failed = true;
        printerr(String(e.stack ?? e));
    } finally {
        http.destroy();
        loop.quit();
    }
})();

loop.run();
if (failed)
    System.exit(1);
