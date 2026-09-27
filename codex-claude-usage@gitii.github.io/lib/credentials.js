// Reading and watching the JSON credential files written by the codex and
// claude CLIs. The extension never writes to these files.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

/**
 * Read and parse a JSON file. Resolves to null when the file does not exist.
 *
 * @param {string} path
 * @returns {Promise<{data: object, mtime: number}|null>}
 */
export async function readJsonFile(path) {
    const file = Gio.File.new_for_path(path);
    let contents;
    try {
        [contents] = await file.load_contents_async(null);
    } catch (e) {
        if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null;
        throw e;
    }
    const data = JSON.parse(new TextDecoder('utf-8').decode(contents));
    let mtime = 0;
    try {
        const info = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        mtime = info.get_modification_date_time()?.to_unix() ?? 0;
    } catch {
        // mtime is only used to invalidate in-memory tokens; ignore failures
    }
    return {data, mtime};
}

/**
 * Return the first candidate path whose file parses and passes `accept`.
 *
 * @param {string[]} paths
 * @param {(data: object) => boolean} accept
 */
export async function readFirstJson(paths, accept = () => true) {
    for (const path of paths) {
        try {
            const result = await readJsonFile(path);
            if (result && accept(result.data))
                return {...result, path};
        } catch (e) {
            console.warn(`codex-claude-usage: could not read ${path}: ${e.message}`);
        }
    }
    return null;
}

/**
 * Watch a set of files (which may not exist yet) and call back, debounced,
 * whenever any of them changes.
 */
export class FileWatcher {
    /**
     * @param {string[]} paths
     * @param {() => void} onChange
     */
    constructor(paths, onChange) {
        this._onChange = onChange;
        this._monitors = [];
        this._debounceId = 0;

        for (const path of paths) {
            try {
                const monitor = Gio.File.new_for_path(path).monitor_file(
                    Gio.FileMonitorFlags.NONE, null);
                monitor.connect('changed', () => this._schedule());
                this._monitors.push(monitor);
            } catch (e) {
                console.warn(`codex-claude-usage: cannot watch ${path}: ${e.message}`);
            }
        }
    }

    _schedule() {
        if (this._debounceId)
            GLib.source_remove(this._debounceId);
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._debounceId = 0;
            this._onChange();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];
    }
}

/** Decode the payload of a JWT without verifying it. */
export function decodeJwtPayload(token) {
    if (typeof token !== 'string')
        return {};
    const parts = token.split('.');
    if (parts.length < 2)
        return {};
    try {
        let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        payload += '='.repeat((4 - (payload.length % 4)) % 4);
        const bytes = GLib.base64_decode(payload);
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch {
        return {};
    }
}
