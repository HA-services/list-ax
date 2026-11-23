/** @odoo-module **/
// Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.

import { proxy } from "@odoo/owl";
import { browser } from "@web/core/browser/browser";
import { Domain } from "@web/core/domain";
import { _t } from "@web/core/l10n/translation";
import { serializeDate, serializeDateTime } from "@web/core/l10n/dates";
import { session } from "@web/session";

export const SERIAL_COLUMN_ID = "axs_lvm_serial";
export const DENSITIES = ["compact", "comfortable", "spacious"];
export const AUTO_REFRESH_CHOICES = [0, 30, 60, 300, 900];

export function getLvmSettings() {
    return session.axs_lvm || null;
}

export function isLvmEnabledFor(resModel) {
    const settings = getLvmSettings();
    return Boolean(settings && resModel && !(settings.excluded_models || []).includes(resModel));
}

// -----------------------------------------------------------------------------
// Theme: settings colors exposed as CSS variables
// -----------------------------------------------------------------------------
let themeApplied = false;
export function applyLvmTheme() {
    const settings = getLvmSettings();
    if (themeApplied || !settings) {
        return;
    }
    themeApplied = true;
    const root = document.documentElement;
    const vars = {
        "--axs-lvm-hover-bg": settings.hover_color,
        "--axs-lvm-header-bg": settings.header_bg,
        "--axs-lvm-header-color": settings.header_color,
        "--axs-lvm-accent": settings.accent_color,
    };
    for (const [name, value] of Object.entries(vars)) {
        if (value && /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d\s.,%]+\)$/.test(value)) {
            root.style.setProperty(name, value);
        }
    }
    document.body.classList.toggle("axs_lvm_custom_header", Boolean(settings.header_bg || settings.header_color));
}

// -----------------------------------------------------------------------------
// Clipboard (works on plain http deployments as well)
// -----------------------------------------------------------------------------
export async function copyText(text) {
    const clipboard = browser.navigator && browser.navigator.clipboard;
    if (clipboard && window.isSecureContext) {
        try {
            await clipboard.writeText(text);
            return true;
        } catch {
            // fall back below
        }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch {
        ok = false;
    }
    textarea.remove();
    return ok;
}

// -----------------------------------------------------------------------------
// Columns
// -----------------------------------------------------------------------------

/**
 * Stable key identifying a column of a list arch, independent from the generated ids.
 */
export function computeColumnKeys(columns) {
    const counters = {};
    const keys = new Map();
    for (const column of columns) {
        let base;
        if (column.type === "field") {
            base = `f:${column.name}`;
        } else if (column.type === "button_group") {
            base = "b:buttons";
        } else if (column.type === "widget") {
            base = `w:${column.widget && column.widget.name ? column.widget.name : column.name || "widget"}`;
        } else {
            base = `o:${column.type}`;
        }
        counters[base] = (counters[base] || 0) + 1;
        keys.set(column, counters[base] > 1 ? `${base}#${counters[base]}` : base);
    }
    return keys;
}

export function getColumnDefaultLabel(column, fields) {
    if (column.type === "button_group") {
        return _t("Buttons");
    }
    if (column.type === "widget") {
        return column.label || (column.widget && column.widget.name) || _t("Widget");
    }
    const label = column.label || column.string;
    if (label) {
        return String(label);
    }
    const field = fields && fields[column.name];
    return (field && field.string) || column.name;
}

const overrideCache = new WeakMap();

/**
 * Returns a copy of the column with the given label/width overrides. Copies are cached so
 * that OWL props comparisons stay cheap across renderings.
 */
export function overrideColumn(column, { label, width }) {
    if (!label && !width) {
        return column;
    }
    const cacheKey = `${label || ""}|${width || ""}`;
    let byColumn = overrideCache.get(column);
    if (!byColumn) {
        byColumn = new Map();
        overrideCache.set(column, byColumn);
    }
    if (!byColumn.has(cacheKey)) {
        const copy = Object.assign(Object.create(Object.getPrototypeOf(column)), column);
        if (label) {
            copy.label = label;
            copy.string = label;
            copy.axsCustomLabel = true;
        }
        if (width) {
            copy.attrs = Object.assign({}, column.attrs || {}, { width: `${width}px` });
            copy.options = copy.options || {};
            copy.axsWidth = width;
        }
        byColumn.set(cacheKey, copy);
    }
    return byColumn.get(cacheKey);
}

export function makeSerialColumn() {
    return {
        id: SERIAL_COLUMN_ID,
        type: "axs_serial",
        name: "__axs_serial",
        hasLabel: false,
        optional: false,
        attrs: { width: "38px" },
        options: {},
    };
}

/**
 * Apply a saved layout to the columns of a list.
 *
 * @param {Object[]} available   columns that may be displayed (column_invisible excluded)
 * @param {Set} defaultVisible   columns Odoo would display without any layout
 * @param {Object|null} layout   effective layout ({columns: [...]})
 * @param {Object} [options]
 * @param {boolean} [options.applyWidth=true] put saved widths in column attrs
 * @returns {{ordered: Object[], visible: Object[], keys: Map, entries: Map}}
 *   ordered: every available column in layout order, visible: displayed columns
 */
export function resolveLayout(available, defaultVisible, layout, options = {}) {
    const applyWidth = options.applyWidth !== false;
    const keys = computeColumnKeys(available);
    const layoutColumns = (layout && layout.columns) || [];
    const entries = new Map(layoutColumns.map((entry) => [entry.key, entry]));
    if (!layoutColumns.length) {
        return {
            ordered: available.slice(),
            visible: available.filter((col) => defaultVisible.has(col)),
            keys,
            entries,
        };
    }
    const byKey = new Map();
    for (const col of available) {
        byKey.set(keys.get(col), col);
    }
    // 1. columns known by the layout, in the layout order
    const ordered = [];
    for (const entry of layoutColumns) {
        const col = byKey.get(entry.key);
        if (col) {
            ordered.push(col);
        }
    }
    // 2. columns unknown by the layout (e.g. added to the view later) keep their natural
    //    position: right after their natural predecessor
    available.forEach((col, index) => {
        if (entries.has(keys.get(col))) {
            return;
        }
        let insertAt = 0;
        for (let i = index - 1; i >= 0; i--) {
            const pos = ordered.indexOf(available[i]);
            if (pos !== -1) {
                insertAt = pos + 1;
                break;
            }
        }
        ordered.splice(insertAt, 0, col);
    });
    const visible = [];
    for (const col of ordered) {
        const entry = entries.get(keys.get(col));
        const isVisible = entry ? entry.visible !== false : defaultVisible.has(col);
        if (!isVisible) {
            continue;
        }
        visible.push(
            entry
                ? overrideColumn(col, {
                      label: col.type === "field" ? entry.label : undefined,
                      width: applyWidth ? entry.width : undefined,
                  })
                : col
        );
    }
    return { ordered, visible, keys, entries };
}

// -----------------------------------------------------------------------------
// Column filters
// -----------------------------------------------------------------------------
const TEXT_TYPES = ["char", "text", "html", "many2one", "many2many", "one2many", "reference", "many2one_reference"];
const NUMBER_TYPES = ["integer", "float", "monetary"];

export function getFilterKind(field) {
    if (!field || field.searchable === false || field.type === "properties" || field.type === "binary") {
        return null;
    }
    if (field.store === false && !field.searchable) {
        return null;
    }
    if (TEXT_TYPES.includes(field.type)) {
        return "text";
    }
    if (NUMBER_TYPES.includes(field.type)) {
        return "number";
    }
    if (field.type === "date" || field.type === "datetime") {
        return "date";
    }
    if (field.type === "selection") {
        return "selection";
    }
    if (field.type === "boolean") {
        return "boolean";
    }
    return null;
}

/**
 * Parse a number filter: "100", "=100", ">100", ">=100", "<5", "<=5", "!=3", "10..20" or "10-20".
 * @returns {{domain: Array, text: string}|null}
 */
export function parseNumberFilter(fieldName, raw) {
    const value = String(raw || "").trim().replace(/\s+/g, "");
    if (!value) {
        return null;
    }
    const num = (s) => {
        const n = Number(s.replace(",", "."));
        return Number.isFinite(n) ? n : null;
    };
    const range = value.match(/^(-?[\d.,]+)(?:\.\.|-|:)(-?[\d.,]+)$/);
    if (range && !value.startsWith("-")) {
        const [a, b] = [num(range[1]), num(range[2])];
        if (a !== null && b !== null) {
            const [lo, hi] = a <= b ? [a, b] : [b, a];
            return { domain: [[fieldName, ">=", lo], [fieldName, "<=", hi]], text: `${lo} – ${hi}` };
        }
    }
    const match = value.match(/^(>=|<=|!=|<>|=|>|<)?(-?[\d.,]+)$/);
    if (!match) {
        return null;
    }
    const operator = match[1] === "<>" ? "!=" : match[1] || "=";
    const n = num(match[2]);
    if (n === null) {
        return null;
    }
    return { domain: [[fieldName, operator, n]], text: `${operator === "=" ? "" : operator + " "}${n}` };
}

function dateBound(field, isoDate, endOfDay) {
    const dt = luxon.DateTime.fromISO(isoDate);
    if (!dt.isValid) {
        return null;
    }
    if (field.type === "date") {
        return serializeDate(dt);
    }
    return serializeDateTime(endOfDay ? dt.endOf("day") : dt.startOf("day"));
}

/**
 * Build the domain and facet text of a column filter.
 * @returns {{domain: Array, text: string}|null}
 */
export function buildFilter(field, kind, value) {
    const name = field.name;
    if (kind === "text") {
        const text = String(value || "").trim();
        return text ? { domain: [[name, "ilike", text]], text } : null;
    }
    if (kind === "number") {
        return parseNumberFilter(name, value);
    }
    if (kind === "date") {
        const { from, to } = value || {};
        const domain = [];
        const lo = from && dateBound(field, from, false);
        const hi = to && dateBound(field, to, true);
        if (lo) {
            domain.push([name, ">=", lo]);
        }
        if (hi) {
            domain.push([name, "<=", hi]);
        }
        if (!domain.length) {
            return null;
        }
        const fmt = (d) => luxon.DateTime.fromISO(d).toLocaleString(luxon.DateTime.DATE_MED);
        const text = lo && hi ? `${fmt(from)} → ${fmt(to)}` : lo ? `≥ ${fmt(from)}` : `≤ ${fmt(to)}`;
        return { domain, text };
    }
    if (kind === "selection") {
        if (value === "" || value === undefined || value === null) {
            return null;
        }
        if (value === "__unset__") {
            return { domain: [[name, "=", false]], text: _t("Not set") };
        }
        const option = (field.selection || []).find((opt) => String(opt[0]) === String(value));
        const raw = option ? option[0] : value;
        return { domain: [[name, "=", raw]], text: option ? option[1] : String(value) };
    }
    if (kind === "boolean") {
        if (value === "true") {
            return { domain: [[name, "=", true]], text: _t("Yes") };
        }
        if (value === "false") {
            return { domain: [[name, "=", false]], text: _t("No") };
        }
        return null;
    }
    return null;
}

// -----------------------------------------------------------------------------
// Per view state, shared by the controller, the toolbar and the renderer
// -----------------------------------------------------------------------------
export class LvmViewState {
    constructor({ resModel, viewId, orm, notification, searchModel }) {
        this.settings = getLvmSettings();
        this.resModel = resModel;
        this.viewId = viewId || false;
        this.orm = orm;
        this.notification = notification;
        this.searchModel = searchModel;
        this.listeners = new Set();
        this.state = proxy({
            loaded: false,
            userLayout: null,
            teamLayout: null,
            filterRow: false,
            filters: {}, // key -> {value, groupId, text}
            editMode: null, // null = native behaviour
            autoRefresh: 0,
            panelOpen: false,
            revision: 0,
        });
        try {
            this.state.filterRow = browser.localStorage.getItem(this.storageKey("filters")) === "1";
            this.state.autoRefresh = parseInt(browser.localStorage.getItem(this.storageKey("refresh")) || "0") || 0;
        } catch {
            // storage may be unavailable (private mode)
        }
    }

    storageKey(name) {
        return `axs_lvm.${name}.${this.resModel}.${this.viewId || 0}`;
    }

    remember(name, value) {
        try {
            browser.localStorage.setItem(this.storageKey(name), value);
        } catch {
            // ignore
        }
    }

    onChange(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyChange() {
        this.state.revision++;
        for (const cb of this.listeners) {
            cb();
        }
    }

    get layout() {
        return this.state.userLayout || this.state.teamLayout || null;
    }

    get density() {
        return (this.layout && this.layout.density) || "comfortable";
    }

    get wrapText() {
        return Boolean(this.layout && this.layout.wrap_text);
    }

    get isManager() {
        return Boolean(this.settings && this.settings.is_manager);
    }

    /**
     * Columns of the list as the column manager shows them, computed from the last
     * rendering of the list.
     */
    getManagerColumns() {
        const info = this.renderInfo;
        if (!info) {
            return [];
        }
        const visibleOriginals = new Set(info.visibleOriginals);
        return info.ordered.map((col) => {
            const key = info.keys.get(col);
            const entry = info.entries.get(key) || {};
            return {
                key,
                type: col.type,
                name: col.name,
                defaultLabel: getColumnDefaultLabel(col, info.fields),
                label: entry.label || "",
                visible: visibleOriginals.has(col),
                width: entry.width || null,
                extra: Boolean(entry.extra),
                fieldType: col.type === "field" && info.fields[col.name] ? info.fields[col.name].type : null,
            };
        });
    }

    entriesFromManagerColumns(columns) {
        return columns.map((c) => {
            const entry = { key: c.key, visible: Boolean(c.visible) };
            if (c.label && c.label !== c.defaultLabel) {
                entry.label = c.label;
            }
            if (c.width) {
                entry.width = c.width;
            }
            if (c.extra) {
                entry.extra = true;
            }
            return entry;
        });
    }

    async saveColumnWidth(key, width) {
        const columns = this.getManagerColumns();
        const target = columns.find((c) => c.key === key);
        if (!target) {
            return;
        }
        target.width = Math.round(width);
        await this.save(this.entriesFromManagerColumns(columns));
    }

    async resetWidths() {
        const columns = this.getManagerColumns();
        for (const c of columns) {
            c.width = null;
        }
        await this.save(this.entriesFromManagerColumns(columns));
    }

    feature(name) {
        return Boolean(this.settings && this.settings[name]);
    }

    async load() {
        try {
            const result = await this.orm.call("axs.lvm.layout", "axs_get_layout", [this.resModel, this.viewId]);
            this.state.userLayout = result.user || null;
            this.state.teamLayout = result.team || null;
        } catch (error) {
            // Never block the list because of the layout
            console.warn("AXSync List View Manager: could not load layout", error);
        }
        this.state.loaded = true;
    }

    _payload(columns, extra = {}) {
        const current = this.layout || {};
        return {
            columns: columns || current.columns || [],
            density: extra.density || current.density || "comfortable",
            wrap_text: "wrap_text" in extra ? extra.wrap_text : Boolean(current.wrap_text),
        };
    }

    async save(columns, extra = {}) {
        const payload = this._payload(columns, extra);
        // optimistic update for a snappy UI
        this.state.userLayout = Object.assign({}, this.state.userLayout || {}, payload, { is_team_default: false });
        this.notifyChange();
        // Saves are serialized and coalesced: quick successive changes (toggles, drag & drop)
        // never race on the server, and only the latest layout is sent.
        this._pendingPayload = payload;
        if (!this._saving) {
            this._saving = this._flushSaves().finally(() => {
                this._saving = null;
            });
        }
        return this._saving;
    }

    async _flushSaves() {
        let saved = null;
        while (this._pendingPayload) {
            const payload = this._pendingPayload;
            this._pendingPayload = null;
            try {
                saved = await this.orm.call("axs.lvm.layout", "axs_save_layout", [
                    this.resModel,
                    this.viewId,
                    payload,
                ]);
            } catch (error) {
                this.notification.add(_t("Your list layout could not be saved."), { type: "danger" });
                throw error;
            }
        }
        if (saved && this.state.userLayout) {
            this.state.userLayout = Object.assign({}, this.state.userLayout, { id: saved.id });
        }
        return saved;
    }

    async _waitSaves() {
        if (this._saving) {
            try {
                await this._saving;
            } catch {
                // the error has already been notified
            }
        }
    }

    async reset() {
        await this._waitSaves();
        const result = await this.orm.call("axs.lvm.layout", "axs_reset_layout", [this.resModel, this.viewId]);
        this.state.userLayout = result.user || null;
        this.state.teamLayout = result.team || null;
        this.notifyChange();
    }

    async publishTeam() {
        await this._waitSaves();
        const payload = this._payload();
        const saved = await this.orm.call("axs.lvm.layout", "axs_publish_team_layout", [
            this.resModel,
            this.viewId,
            payload,
        ]);
        this.state.teamLayout = saved;
        this.notifyChange();
        this.notification.add(_t("This layout is now the team default for this list."), { type: "success" });
    }

    async removeTeam() {
        await this._waitSaves();
        const result = await this.orm.call("axs.lvm.layout", "axs_remove_team_layout", [this.resModel, this.viewId]);
        this.state.teamLayout = result.team || null;
        this.notifyChange();
        this.notification.add(_t("Team default layout removed."), { type: "info" });
    }

    // ------------------------------------------------------------------
    // Column filters, materialised as search facets so they combine with
    // the search bar, filters, favorites and Group By.
    // ------------------------------------------------------------------
    activeGroupIds() {
        const sm = this.searchModel;
        if (!sm) {
            return new Set();
        }
        return new Set(sm.query.map((q) => sm.searchItems[q.searchItemId] && sm.searchItems[q.searchItemId].groupId));
    }

    /** Forget the filters whose facet has been removed from the search bar. */
    syncFilters() {
        const active = this.activeGroupIds();
        for (const [key, filter] of Object.entries(this.state.filters)) {
            if (!active.has(filter.groupId)) {
                delete this.state.filters[key];
            }
        }
    }

    getFilterValue(key) {
        const filter = this.state.filters[key];
        return filter ? filter.value : undefined;
    }

    async setFilter(key, label, field, kind, value) {
        const sm = this.searchModel;
        if (!sm) {
            return;
        }
        const built = buildFilter(field, kind, value);
        const previous = this.state.filters[key];
        if (!built && !previous) {
            return;
        }
        if (previous && built && JSON.stringify(previous.value) === JSON.stringify(value)) {
            return;
        }
        if (previous) {
            delete this.state.filters[key];
            if (built) {
                sm.blockNotification = true;
                try {
                    sm.deactivateGroup(previous.groupId);
                } finally {
                    sm.blockNotification = false;
                }
            } else {
                sm.deactivateGroup(previous.groupId);
            }
        }
        if (!built) {
            return;
        }
        const prefilter = {
            description: `${label}: ${built.text}`,
            domain: new Domain(built.domain).toString(),
        };
        sm.createNewFilters([prefilter]);
        this.state.filters[key] = { value, groupId: prefilter.groupId, text: built.text };
    }

    clearFilters() {
        const sm = this.searchModel;
        const groupIds = Object.values(this.state.filters).map((f) => f.groupId);
        this.state.filters = {};
        if (!sm || !groupIds.length) {
            return;
        }
        sm.blockNotification = true;
        try {
            for (const groupId of groupIds.slice(0, -1)) {
                sm.deactivateGroup(groupId);
            }
        } finally {
            sm.blockNotification = false;
        }
        sm.deactivateGroup(groupIds[groupIds.length - 1]);
    }

    get activeFilterCount() {
        return Object.keys(this.state.filters).length;
    }

    toggleFilterRow() {
        this.state.filterRow = !this.state.filterRow;
        this.remember("filters", this.state.filterRow ? "1" : "0");
    }

    setAutoRefresh(seconds) {
        this.state.autoRefresh = seconds;
        this.remember("refresh", String(seconds));
    }
}
