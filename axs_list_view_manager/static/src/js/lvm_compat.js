/** @odoo-module **/
// Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
// Version specific helpers (Odoo 18.0).

/** Drop the cached list arches so that added/removed columns are fetched again. */
export function clearViewCaches(env) {
    env.bus.trigger("CLEAR-CACHES");
}
