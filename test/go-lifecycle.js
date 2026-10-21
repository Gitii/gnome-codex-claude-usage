import {RefreshSlot} from '../codex-claude-usage@gitii.github.io/lib/refresh-slot.js';
import * as Go from '../codex-claude-usage@gitii.github.io/lib/providers/opencode-go.js';

// Controlled delayed HTTP responses exercise the real provider, without a
// keyring or live API. Each request captures the credential used at dispatch.
export async function testGoLifecycle(expect) {
    let key = 'old-dummy';
    const requests = [];
    const results = [];
    const store = {async readKey() { return key; }};
    const http = {requestJson(method, url, options) {
        return new Promise(resolve => requests.push({method, url, options, resolve}));
    }};
    const settings = {get_string() { return 'http://test.invalid/zen/go/v1/usage'; }};
    const slot = new RefreshSlot(() => Go.fetchUsage(http, settings, store), usage => results.push(usage));
    const tick = async () => {
        for (let i = 0; i < 10; i++)
            await Promise.resolve();
    };
    const first = slot.refresh();
    await tick();
    key = 'replacement-dummy';
    slot.invalidate();
    await slot.refresh(true);
    expect(requests.length === 1, 'replacement waits for old request');
    requests[0].resolve({usage: {rolling: {percent: 91}}});
    await tick();
    expect(results.length === 0, 'old account is never published');
    expect(requests[1].options.headers.Authorization === 'Bearer replacement-dummy', 'queued fetch reads replacement key');
    requests[1].resolve({usage: {rolling: {percent: 12}}});
    await first;
    expect(results.length === 1 && results[0].windows[0].usedPercent === 12, 'only new account published');

    const pending = slot.refresh();
    await tick();
    key = null;
    slot.invalidate();
    requests[2].resolve({usage: {rolling: {percent: 99}}});
    await pending;
    expect(results.length === 1, 'removal ignores delayed response');
    await slot.refresh();
    expect(results[1].state === 'no-credentials', 'removed key reports settings guidance');
    key = 'new-dummy';
    const late = slot.refresh();
    await tick();
    slot.destroy();
    requests[3].resolve({usage: {rolling: {percent: 80}}});
    await late;
    expect(results.length === 2, 'disable ignores delayed provider response');
}
