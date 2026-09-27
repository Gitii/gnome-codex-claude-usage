// Compatibility helpers for GNOME Shell 46 through 51.
//
// The only St API that changed shape in this range is the layout direction of
// St.BoxLayout: `vertical` (46, 47) was deprecated in 48 in favour of
// `orientation` and removed in 51. Everything else the extension uses has been
// stable since 45 (ESM extension modules, Soup 3, Gio.DBus, PanelMenu).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

const HAS_ORIENTATION = (() => {
    try {
        return GObject.Object.find_property.call(St.BoxLayout, 'orientation') !== null;
    } catch {
        return false;
    }
})();

/**
 * Construct properties that set the layout direction of an St.BoxLayout on
 * the running shell version. Spread them into the constructor arguments of a
 * St.BoxLayout or one of its subclasses.
 *
 * @param {boolean} vertical
 * @returns {object}
 */
export function layoutParams(vertical) {
    if (HAS_ORIENTATION)
        return {orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL};
    return {vertical};
}

/**
 * Create an St.BoxLayout with a portable `vertical` option.
 *
 * @param {object} params - St.BoxLayout construct properties plus `vertical`
 * @returns {St.BoxLayout}
 */
export function boxLayout(params = {}) {
    const {vertical = false, ...rest} = params;
    return new St.BoxLayout({...rest, ...layoutParams(vertical)});
}
