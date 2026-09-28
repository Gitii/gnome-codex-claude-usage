// The panel button: one segment per enabled provider plus the dropdown menu.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {boxLayout} from '../compat.js';
import {ProviderSection} from './section.js';
import {
    COUNTDOWN_THRESHOLD_SEC, STATE_OK,
    displayPercent, panelWindow, secondsUntil, severityClass,
} from '../usage.js';

const PANEL_BAR_WIDTH = 40;
const SEVERITIES = ['usage-low', 'usage-medium', 'usage-high', 'usage-critical'];

/** Icon + mini bar + label for one provider in the panel. */
const PanelSegment = GObject.registerClass(
class PanelSegment extends St.BoxLayout {
    _init(iconFile) {
        super._init({style_class: 'ccu-segment', y_align: Clutter.ActorAlign.CENTER});

        this._icon = new St.Icon({
            gicon: new Gio.FileIcon({file: iconFile}),
            style_class: 'system-status-icon ccu-segment-icon',
        });
        this.add_child(this._icon);

        this._track = new St.Widget({
            style_class: 'ccu-panel-track',
            width: PANEL_BAR_WIDTH,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({style_class: 'ccu-panel-fill usage-low', width: 0});
        this._track.add_child(this._fill);
        this.add_child(this._track);

        this._label = new St.Label({
            text: '…',
            style_class: 'ccu-segment-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
    }

    applyDisplay({displayMode, showIcon}) {
        this._icon.visible = showIcon;
        this._track.visible = displayMode !== 'text';
        this._label.visible = displayMode !== 'bar';
    }

    setUsage(usage, {percentMode, panelWindowMode}) {
        for (const cls of SEVERITIES) {
            this._fill.remove_style_class_name(cls);
            this._label.remove_style_class_name(cls);
        }
        this._icon.remove_style_class_name('ccu-limit-reached');

        if (!usage) {
            this._label.text = '…';
            this._fill.width = 0;
            return;
        }
        if (usage.state !== STATE_OK) {
            this._label.text = usage.state === 'error' ? '!' : '?';
            this._fill.width = 0;
            return;
        }

        const window = panelWindow(usage, panelWindowMode);
        const used = window?.usedPercent ?? 0;
        const shown = Math.round(displayPercent(used, percentMode));
        this._label.text = `${shown}%`;
        this._fill.width = Math.round(PANEL_BAR_WIDTH * used / 100);
        this._fill.add_style_class_name(severityClass(used));
        if (used >= 90)
            this._label.add_style_class_name(severityClass(used));
        if (usage.limitReached)
            this._icon.add_style_class_name('ccu-limit-reached');
    }
});

export const UsageIndicator = GObject.registerClass({
    Signals: {'reset-passed': {}},
}, class UsageIndicator extends PanelMenu.Button {
    /**
     * @param {object} params
     * @param {Gio.Settings} params.settings
     * @param {Gio.File} params.iconDir
     * @param {Array} params.providers - provider modules
     * @param {() => void} params.onRefresh - manual refresh requested
     * @param {() => void} params.onSettings - open preferences
     */
    _init({settings, iconDir, providers, onRefresh, onSettings}) {
        super._init(0.0, 'Codex & Claude Usage');
        this._settings = settings;
        this._usage = new Map();
        this._segments = new Map();
        this._sections = new Map();
        this._separators = new Map();
        this._countdownId = 0;

        this._box = boxLayout({style_class: 'panel-status-menu-box ccu-box'});
        this.add_child(this._box);

        for (const provider of providers) {
            const iconFile = iconDir.get_child(provider.ICON);
            const segment = new PanelSegment(iconFile);
            this._segments.set(provider.ID, segment);
            this._box.add_child(segment);

            const section = new ProviderSection(provider, iconFile);
            this._sections.set(provider.ID, section);
            this.menu.addMenuItem(section);
            const separator = new PopupMenu.PopupSeparatorMenuItem();
            this._separators.set(provider.ID, separator);
            this.menu.addMenuItem(separator);
        }

        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        this._refreshItem.connect('activate', () => onRefresh());
        this.menu.addMenuItem(this._refreshItem);

        const settingsItem = new PopupMenu.PopupMenuItem('Settings…');
        settingsItem.connect('activate', () => onSettings());
        this.menu.addMenuItem(settingsItem);

        this._settingsIds = ['show-codex', 'show-claude', 'display-mode', 'show-icon',
            'percent-mode', 'panel-window'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._applySettings()));
        this._applySettings();
    }

    _displayOptions() {
        return {
            displayMode: this._settings.get_string('display-mode'),
            showIcon: this._settings.get_boolean('show-icon'),
            percentMode: this._settings.get_string('percent-mode'),
            panelWindowMode: this._settings.get_string('panel-window'),
        };
    }

    isProviderEnabled(id) {
        return this._settings.get_boolean(`show-${id}`);
    }

    _applySettings() {
        const options = this._displayOptions();
        for (const [id, segment] of this._segments) {
            const enabled = this.isProviderEnabled(id);
            segment.visible = enabled;
            segment.applyDisplay(options);
            segment.setUsage(this._usage.get(id) ?? null, options);
            const section = this._sections.get(id);
            section.visible = enabled;
            this._separators.get(id).visible = enabled;
            const usage = this._usage.get(id);
            if (usage)
                section.setUsage(usage, options.percentMode);
        }
    }

    setLoading(id) {
        this._sections.get(id)?.setLoading();
    }

    setRefreshing(refreshing) {
        this._refreshItem.setSensitive(!refreshing);
        this._refreshItem.label.text = refreshing ? 'Refreshing…' : 'Refresh now';
    }

    /**
     * @param {string} id - provider ID
     * @param {import('../usage.js').ProviderUsage} usage
     */
    setUsage(id, usage) {
        this._usage.set(id, usage);
        const options = this._displayOptions();
        this._segments.get(id)?.setUsage(usage, options);
        this._sections.get(id)?.setUsage(usage, options.percentMode);
        this._syncCountdown();
    }

    // A one-second tick while any reset is less than five minutes away, so
    // the "Resets in 42s" labels stay live.
    _needsCountdown() {
        for (const usage of this._usage.values()) {
            for (const window of usage.windows ?? []) {
                const remaining = secondsUntil(window.resetsAt);
                if (remaining !== null && remaining < COUNTDOWN_THRESHOLD_SEC)
                    return true;
            }
        }
        return false;
    }

    _syncCountdown() {
        if (!this._needsCountdown()) {
            this._stopCountdown();
            return;
        }
        if (this._countdownId)
            return;
        this._countdownId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            for (const section of this._sections.values())
                section.refreshCountdown();
            if (this._needsCountdown())
                return GLib.SOURCE_CONTINUE;
            this._countdownId = 0;
            this.emit('reset-passed');
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopCountdown() {
        if (this._countdownId) {
            GLib.source_remove(this._countdownId);
            this._countdownId = 0;
        }
    }

    destroy() {
        this._stopCountdown();
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._settings = null;
        super.destroy();
    }
});

export function addToPanel(uuid, indicator) {
    Main.panel.addToStatusArea(uuid, indicator);
}
