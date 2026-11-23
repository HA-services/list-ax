/** @odoo-module **/
// Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
// Version specific helpers (Odoo 16.0).

import { _t as coreT } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { sprintf } from "@web/core/utils/strings";

/** Translate a term and substitute %s placeholders (Odoo 17+ behaviour of _t). */
export function _t(term, ...values) {
    const translated = coreT(term);
    return values.length ? sprintf(String(translated), ...values) : translated;
}

/** Drop the cached list arches so that added/removed columns are fetched again. */
export function clearViewCaches(env) {
    env.bus.trigger("CLEAR-CACHES");
}

/**
 * Odoo 16 patch() keeps the descriptors of the patch object, which are enumerable for
 * object literals. OWL copies enumerable keys of components when it captures slot
 * contexts, which fails on getters: make the patched keys non-enumerable, like native
 * class members.
 */
export function patchClass(proto, name, extension) {
    patch(proto, name, extension);
    for (const key of Object.keys(extension)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        if (descriptor && descriptor.enumerable) {
            Object.defineProperty(proto, key, Object.assign({}, descriptor, { enumerable: false }));
        }
    }
}
