// Codex & Claude Usage — GNOME Shell extension entry point.
//
// Orchestrates periodic fetching for each enabled provider and feeds the
// results to the panel indicator. All network and file access lives in lib/.

import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {HttpClient} from './lib/http.js';
import {FileWatcher} from './lib/credentials.js';
import {UsageIndicator, addToPanel} from './lib/ui/indicator.js';
import * as Codex from './lib/providers/codex.js';
import * as Claude from './lib/providers/claude.js';
import {STATE_ERROR, errorUsage} from './lib/usage.js';

const PROVIDERS = [Codex, Claude];

export default class CodexClaudeUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._http = new HttpClient(this._settings.get_string('proxy-url'));
        this._timerId = 0;
        this._inFlight = new Set();
        this._generation = 0;

        this._indicator = new UsageIndicator({
            settings: this._settings,
            iconDir: this.dir.get_child('icons'),
            providers: PROVIDERS,
            onRefresh: () => this._refreshAll(),
            onSettings: () => this.openPreferences(),
        });
        this._indicator.connect('reset-passed', () => this._refreshAll());
        addToPanel(this.uuid, this._indicator);

        this._settingsIds = [
            this._settings.connect('changed::refresh-interval', () => this._startTimer()),
            this._settings.connect('changed::proxy-url', () => this._recreateHttp()),
            this._settings.connect('changed::show-codex', () => this._refreshAll()),
            this._settings.connect('changed::show-claude', () => this._refreshAll()),
        ];

        this._watcher = new FileWatcher(
            PROVIDERS.flatMap(p => p.credentialPaths()),
            () => this._refreshAll());

        this._startTimer();
        this._refreshAll();
    }

    disable() {
        this._generation++;
        this._stopTimer();
        this._watcher?.destroy();
        this._watcher = null;
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._indicator?.destroy();
        this._indicator = null;
        this._http?.destroy();
        this._http = null;
        this._settings = null;
        this._inFlight = null;
        Codex.reset();
    }

    _recreateHttp() {
        this._http?.destroy();
        this._http = new HttpClient(this._settings.get_string('proxy-url'));
        this._refreshAll();
    }

    _startTimer() {
        this._stopTimer();
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refreshAll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _refreshAll() {
        for (const provider of PROVIDERS) {
            if (this._indicator?.isProviderEnabled(provider.ID))
                this._refreshProvider(provider).catch(e => console.error(e));
        }
    }

    async _refreshProvider(provider) {
        if (this._inFlight.has(provider.ID))
            return;
        this._inFlight.add(provider.ID);
        const generation = this._generation;
        this._indicator.setLoading(provider.ID);
        this._indicator.setRefreshing(true);

        let usage;
        try {
            usage = await provider.fetchUsage(this._http, this._settings);
        } catch (e) {
            usage = errorUsage(STATE_ERROR, e.message);
            console.warn(`codex-claude-usage: ${provider.ID}: ${e.message}`);
        }

        // The extension may have been disabled while the request was pending.
        if (generation !== this._generation || !this._indicator)
            return;

        this._inFlight.delete(provider.ID);
        this._indicator.setUsage(provider.ID, usage);
        this._indicator.setRefreshing(this._inFlight.size > 0);
    }
}
