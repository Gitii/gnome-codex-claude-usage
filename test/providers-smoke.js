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
import * as Go from '../codex-claude-usage@gitii.github.io/lib/providers/opencode-go.js';
import {SecretStoreError} from '../codex-claude-usage@gitii.github.io/lib/secret-store.js';
import {panelWindows, menuWindows} from '../codex-claude-usage@gitii.github.io/lib/usage.js';
import {testGoLifecycle} from './go-lifecycle.js';

const [base, scenario] = ARGV;

const settings = {
    _values: {
        'codex-usage-url': `${base}/backend-api/wham/usage`,
        'codex-token-url': `${base}/oauth/token`,
        'claude-usage-url': `${base}/api/oauth/usage`,
        'opencode-go-usage-url': `${base}/zen/go/v1/usage`,
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
        if (scenario === 'normal') {
            await testGoLifecycle(expect);
            for (const payload of [null, {}, {usage: {}}, {usage: {rolling: {percent: NaN}}},
                {usage: {rolling: {percent: 1}, weekly: {percent: 'bad'}}}]) {
                let rejected = false;
                try { Go.parseWindows(payload); } catch { rejected = true; }
                expect(rejected, 'malformed required or present optional quota rejected');
            }
            expect(Go.parseWindows({usage: {rolling: {percent: -3}, monthly: {percent: 110}}})
                .map(w => w.usedPercent).join(',') === '0,100', 'finite percentages obey display clamping');
        }
        const codex = await Codex.fetchUsage(http, settings);
        const claude = await Claude.fetchUsage(http, settings);
        const go = await Go.fetchUsage(http, settings, {
            async readKey() {
                return scenario === 'no-credentials' ? null : 'go-dummy-key';
            },
        });
        print(`go: ${JSON.stringify(go)}`);
        if (['offline', 'go-malformed', 'go-malformed-monthly', 'go-403', 'go-500', 'go-non-json'].includes(scenario)) {
            expect(go.state === 'error' && go.windows.length === 0, 'Go error contains no fake quotas');
            if (scenario === 'go-403')
                expect(go.message.includes('permissions') && !go.message.includes('expired'), '403 permission guidance');
        } else if (scenario === 'go-401') {
            expect(go.state === 'expired' && go.message.includes('Replace'), '401 key replacement guidance');
        } else if (scenario === 'no-credentials') {
            expect(go.state === 'no-credentials' && go.message.includes('Settings'), 'missing key points to settings');
        } else {
            expect(go.state === 'ok', 'Go fetch succeeds');
            expect(go.windows[0].usedPercent === (scenario === 'limit' ? 100 : 0.5), 'Go percentages are not fractions');
            expect(go.windows[0].resetsAt === 1792627948, 'Go ISO reset normalized to epoch seconds');
            if (scenario === 'go-optional') {
                expect(go.windows.length === 1, 'absent optional quotas omitted');
            } else {
                expect(go.windows[1].usedPercent === 1, '1 means one percent');
                expect(go.windows[1].resetsAt === null && go.windows[2].resetsAt === null, 'unknown resets stay null');
                expect(panelWindows(go, 'both').length === 2, 'Go panel has two rows');
                expect(menuWindows(go, false).length === 3, 'monthly survives model toggle');
                if (scenario !== 'limit')
                    expect(panelWindows(go, 'max')[0].id === 'monthly', 'monthly drives highest usage');
            }
        }
        for (const code of ['locked', 'unavailable', 'missing-bindings']) {
            const result = await Go.fetchUsage(http, settings, {
                async readKey() {
                    throw new SecretStoreError(code, `Safe ${code} guidance`);
                },
            });
            expect(result.state === 'error' && result.message.includes(code), `${code} Go-local guidance`);
        }
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
                    codex.extras[0].value === '2', 'codex banked resets parsed (count only)');
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
                expect(scenario.startsWith('go-') && codex.state === 'ok' && claude.state === 'ok',
                    'other providers unaffected by Go scenario');
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
