// One provider's block in the dropdown: header, two usage bars, info line.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {boxLayout, layoutParams} from '../compat.js';
import {
    STATE_OK, displayPercent, formatReset, severityClass,
} from '../usage.js';

const BAR_WIDTH = 220;
const SEVERITIES = ['usage-low', 'usage-medium', 'usage-high', 'usage-critical'];

export const UsageBar = GObject.registerClass(
class UsageBar extends St.BoxLayout {
    _init(title) {
        super._init({
            style_class: 'ccu-window',
            x_expand: true,
            ...layoutParams(true),
        });

        const header = boxLayout({x_expand: true});
        this._title = new St.Label({text: title, style_class: 'ccu-window-title'});
        header.add_child(this._title);
        this._percent = new St.Label({
            text: '—',
            style_class: 'ccu-window-percent',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        header.add_child(this._percent);
        this.add_child(header);

        this._track = new St.Widget({style_class: 'ccu-track', width: BAR_WIDTH});
        this._fill = new St.Widget({style_class: 'ccu-fill usage-low', width: 0});
        this._track.add_child(this._fill);
        this.add_child(this._track);

        this._reset = new St.Label({text: '', style_class: 'ccu-reset'});
        this.add_child(this._reset);
    }

    setWindow(window, percentMode) {
        this._window = window;
        const shown = displayPercent(window.usedPercent, percentMode);
        const suffix = percentMode === 'remaining' ? 'left' : 'used';
        this._percent.text = `${formatPercent(shown)}% ${suffix}`;
        this._fill.width = Math.round(BAR_WIDTH * window.usedPercent / 100);
        for (const cls of SEVERITIES)
            this._fill.remove_style_class_name(cls);
        this._fill.add_style_class_name(severityClass(window.usedPercent));
        this.refreshCountdown();
    }

    refreshCountdown() {
        if (!this._window)
            return;
        this._reset.text = `Resets ${formatReset(this._window.resetsAt)}`;
    }
});

function formatPercent(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export const ProviderSection = GObject.registerClass(
class ProviderSection extends PopupMenu.PopupBaseMenuItem {
    _init(provider, iconFile) {
        super._init({reactive: false, can_focus: false});
        this._provider = provider;

        const box = boxLayout({vertical: true, x_expand: true, style_class: 'ccu-section'});

        const header = boxLayout({x_expand: true, style_class: 'ccu-section-header'});
        header.add_child(new St.Icon({
            gicon: new Gio.FileIcon({file: iconFile}),
            style_class: 'popup-menu-icon',
            icon_size: 16,
        }));
        header.add_child(new St.Label({
            text: provider.NAME,
            style_class: 'ccu-section-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._status = new St.Label({
            text: '',
            style_class: 'ccu-section-status',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._status);
        box.add_child(header);

        this._bars = new Map();
        this._barsBox = boxLayout({vertical: true, x_expand: true});
        box.add_child(this._barsBox);

        this._info = new St.Label({text: '', style_class: 'ccu-info'});
        this._info.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._info.hide();
        box.add_child(this._info);

        this._message = new St.Label({text: '', style_class: 'ccu-message'});
        this._message.clutter_text.line_wrap = true;
        this._message.hide();
        box.add_child(this._message);

        this.add_child(box);
    }

    get provider() {
        return this._provider;
    }

    setLoading() {
        this._status.text = 'Loading…';
    }

    /**
     * @param {import('../usage.js').ProviderUsage} usage
     * @param {'used'|'remaining'} percentMode
     */
    setUsage(usage, percentMode) {
        this._usage = usage;
        this._percentMode = percentMode;

        if (usage.state !== STATE_OK) {
            this._status.text = usage.state === 'no-credentials' ? 'Not logged in'
                : usage.state === 'expired' ? 'Login expired' : 'Error';
            this._barsBox.hide();
            this._info.hide();
            this._message.text = usage.message ?? '';
            this._message.show();
            return;
        }

        this._status.text = usage.limitReached ? 'Limit reached' : '';
        this._message.hide();
        this._barsBox.show();

        const seen = new Set();
        for (const window of usage.windows) {
            let bar = this._bars.get(window.id);
            if (!bar) {
                bar = new UsageBar(window.title);
                this._bars.set(window.id, bar);
                this._barsBox.add_child(bar);
            }
            bar.setWindow(window, percentMode);
            seen.add(window.id);
        }
        for (const [id, bar] of this._bars) {
            if (!seen.has(id)) {
                bar.destroy();
                this._bars.delete(id);
            }
        }

        const parts = [];
        if (usage.plan)
            parts.push(`Plan: ${usage.plan.toUpperCase()}`);
        if (usage.account)
            parts.push(usage.account);
        this._info.text = parts.join(' · ');
        this._info.visible = parts.length > 0;
    }

    refreshCountdown() {
        for (const bar of this._bars.values())
            bar.refreshCountdown();
    }
});
