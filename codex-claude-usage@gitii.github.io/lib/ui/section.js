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

const SEVERITIES = ['usage-low', 'usage-medium', 'usage-high', 'usage-critical'];

/**
 * A track that allocates its single child (the fill) to a fraction of its
 * own content width, so the bar is correct however wide the menu gets.
 */
export const UsageTrack = GObject.registerClass(
class UsageTrack extends St.Widget {
    _init(params) {
        super._init(params);
        this._fraction = 0;
    }

    set fraction(value) {
        this._fraction = Math.max(0, Math.min(1, Number(value) || 0));
        this.queue_relayout();
    }

    get fraction() {
        return this._fraction;
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const content = this.get_theme_node().get_content_box(box);
        const fill = this.get_first_child();
        if (!fill)
            return;
        const width = Math.round((content.x2 - content.x1) * this._fraction);
        const childBox = new Clutter.ActorBox();
        childBox.x1 = content.x1;
        childBox.y1 = content.y1;
        childBox.x2 = content.x1 + width;
        childBox.y2 = content.y2;
        fill.allocate(childBox);
    }
});

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

        this._track = new UsageTrack({style_class: 'ccu-track', x_expand: true});
        this._fill = new St.Widget({style_class: 'ccu-fill usage-low'});
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
        this._track.fraction = window.usedPercent / 100;
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

        this._extras = new St.Label({text: '', style_class: 'ccu-info'});
        this._extras.hide();
        box.add_child(this._extras);

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
     * @param {boolean} [showModelWindows] - include per-model extra windows
     */
    setUsage(usage, percentMode, showModelWindows = true) {
        this._usage = usage;
        this._percentMode = percentMode;

        if (usage.state !== STATE_OK) {
            this._status.text = usage.state === 'no-credentials' ? 'Not logged in'
                : usage.state === 'expired' ? 'Login expired' : 'Error';
            this._barsBox.hide();
            this._info.hide();
            this._extras.hide();
            this._message.text = usage.message ?? '';
            this._message.show();
            return;
        }

        this._status.text = usage.limitReached ? 'Limit reached' : '';
        this._message.hide();
        this._barsBox.show();

        const seen = new Set();
        for (const window of usage.windows) {
            if (!showModelWindows && !window.standard)
                continue;
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

        const extras = (usage.extras ?? []).map(e => `${e.label}: ${e.value}`);
        this._extras.text = extras.join(' · ');
        this._extras.visible = extras.length > 0;

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
