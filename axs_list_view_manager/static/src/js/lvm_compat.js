/** @odoo-module **/
// Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
// Version specific helpers (Odoo 20.0).

import { rpcBus } from "@web/core/network/rpc";

/** Drop the cached list arches so that added/removed columns are fetched again. */
export function clearViewCaches(env) {
    rpcBus.trigger("CLEAR-CACHES", "get_views");
}
