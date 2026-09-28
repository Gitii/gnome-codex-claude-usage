// Thin promise wrapper around Soup 3 for JSON APIs.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const USER_AGENT = 'gnome-codex-claude-usage/1.0';

function hostOf(url) {
    try {
        return GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host();
    } catch {
        return url;
    }
}

export class HttpError extends Error {
    constructor(status, body, url) {
        super(`HTTP ${status} from ${hostOf(url)}`);
        this.name = 'HttpError';
        this.status = status;
        this.body = body;
    }
}

export class HttpClient {
    /**
     * @param {string} proxyUrl - proxy URL or empty for the system default
     */
    constructor(proxyUrl = '') {
        this._session = new Soup.Session({
            user_agent: USER_AGENT,
            timeout: 30,
        });
        const proxy = proxyUrl.trim();
        if (proxy !== '')
            this._session.set_proxy_resolver(Gio.SimpleProxyResolver.new(proxy, null));
        this._cancellable = new Gio.Cancellable();
    }

    /**
     * Perform a request and parse the response body as JSON.
     *
     * @param {string} method
     * @param {string} url
     * @param {object} [options]
     * @param {Object<string,string>} [options.headers]
     * @param {object} [options.json] - body to send as JSON
     * @returns {Promise<object>} parsed JSON body
     * @throws {HttpError} on a non-2xx status
     */
    async requestJson(method, url, {headers = {}, json = null} = {}) {
        const message = Soup.Message.new(method, url);
        if (!message)
            throw new Error(`Invalid URL: ${url}`);

        message.request_headers.append('Accept', 'application/json');
        for (const [name, value] of Object.entries(headers))
            message.request_headers.append(name, value);

        if (json !== null) {
            const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(json)));
            message.set_request_body_from_bytes('application/json', bytes);
        }

        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable);
        const text = new TextDecoder('utf-8').decode(bytes.get_data() ?? new Uint8Array());

        const status = message.get_status();
        if (status < 200 || status >= 300)
            throw new HttpError(status, text, url);

        return text.trim() === '' ? {} : JSON.parse(text);
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._session = null;
    }
}
