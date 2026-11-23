/** @odoo-module **/
// Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { ListRenderer } from "@web/views/list/list_renderer";
import { AxsColumnFilter } from "./lvm_toolbar";
import { copyText, getFilterKind, makeSerialColumn, resolveLayout } from "./lvm_core";


patch(ListRenderer.prototype, {
    setup() {
        super.setup(...arguments);
        const lvm = this.env.axsLvm;
        // Only the main list of a list view is managed, never x2many lists inside forms
        this.axsLvm = lvm && this.props.list === this.props.list.model.root ? lvm : null;
        if (!this.axsLvm) {
            return;
        }
        this.axsLvmState = useState(this.axsLvm.state);
        this.axsFilterComponent = AxsColumnFilter;
        const originalStartResize = this.columnWidths && this.columnWidths.onStartResize;
        if (originalStartResize) {
            this.columnWidths.onStartResize = (ev) => {
                this.axsTrackResize(ev);
                return originalStartResize(ev);
            };
        }
        useEffect(() => {
            const root = this.rootRef.el;
            if (!root) {
                return;
            }
            const lvmLocal = this.axsLvm;
            root.classList.add("axs_lvm");
            for (const density of ["compact", "comfortable", "spacious"]) {
                root.classList.toggle(`axs_lvm_density_${density}`, lvmLocal.density === density);
            }
            root.classList.toggle("axs_lvm_wrap", lvmLocal.wrapText);
            root.classList.toggle("axs_lvm_hover", lvmLocal.feature("hover_highlight"));
        });
    },

    // ------------------------------------------------------------------
    // Columns
    // ------------------------------------------------------------------
    getActiveColumns() {
        const nativeColumns = super.getActiveColumns(...arguments);
        const lvm = this.axsLvm;
        if (!lvm) {
            return nativeColumns;
        }
        // read reactive keys so that layout changes re-render the list
        const layout = this.axsLvmState.userLayout || this.axsLvmState.teamLayout;
        const nativeSet = new Set(nativeColumns);
        const available = this.allColumns.filter(
            (col) => nativeSet.has(col) || (col.optional && !this.evalColumnInvisible(col.column_invisible))
        );
        const resolved = resolveLayout(available, nativeSet, layout);
        const visibleOriginals = [];
        const visibleSet = new Set();
        for (const col of resolved.ordered) {
            const entry = resolved.entries.get(resolved.keys.get(col));
            const isVisible = entry ? entry.visible !== false : nativeSet.has(col);
            if (isVisible) {
                visibleOriginals.push(col);
                visibleSet.add(col);
            }
        }
        // keep Odoo's optional field state consistent (aggregates, native export)
        for (const col of available) {
            if (col.optional && col.type === "field") {
                this.optionalActiveFields[col.name] = visibleSet.has(col);
            }
        }
        lvm.renderInfo = {
            ordered: resolved.ordered,
            entries: resolved.entries,
            keys: resolved.keys,
            visibleOriginals,
            visibleColumns: resolved.visible,
            fields: this.props.list.fields,
        };
        const columns = resolved.visible;
        if (lvm.feature("serial_number")) {
            return [makeSerialColumn(), ...columns];
        }
        return columns;
    },

    get displayOptionalFields() {
        if (this.axsLvm) {
            // optional columns are managed by the AXSync column manager
            return false;
        }
        return super.displayOptionalFields;
    },

    // ------------------------------------------------------------------
    // Serial number
    // ------------------------------------------------------------------
    axsSerialNumber(list, recordIndex) {
        const offset = (list && list.offset) || 0;
        return offset + recordIndex + 1;
    },

    // ------------------------------------------------------------------
    // Column filters
    // ------------------------------------------------------------------
    get axsShowFilterRow() {
        return Boolean(
            this.axsLvm && this.axsLvm.feature("column_filters") && this.axsLvmState.filterRow
        );
    },

    axsFilterProps(column) {
        const field = column.type === "field" ? this.props.list.fields[column.name] : null;
        const kind = getFilterKind(field);
        if (!kind || column.type !== "field") {
            return null;
        }
        const key = this.axsLvm.renderInfo && this.axsLvm.renderInfo.keys
            ? this.axsKeyOf(column)
            : `f:${column.name}`;
        return {
            lvm: this.axsLvm,
            filterKey: key,
            field: Object.assign({ name: column.name }, field),
            kind,
            label: column.label || field.string,
        };
    },

    axsKeyOf(column) {
        const info = this.axsLvm.renderInfo;
        for (const [col, key] of info.keys.entries()) {
            if (col === column || (col.id === column.id && col.name === column.name)) {
                return key;
            }
        }
        return `f:${column.name}`;
    },

    // ------------------------------------------------------------------
    // Copy a cell
    // ------------------------------------------------------------------
    get axsCopyEnabled() {
        return Boolean(this.axsLvm && this.axsLvm.feature("copy_cell"));
    },

    async axsCopyCell(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        const cell = ev.currentTarget.closest("td");
        if (!cell) {
            return;
        }
        const clone = cell.cloneNode(true);
        clone.querySelectorAll(".axs_lvm_copy").forEach((el) => el.remove());
        const text = (clone.innerText || clone.textContent || "").trim();
        const ok = await copyText(text);
        this.notificationService.add(
            ok ? _t("Copied: %s", text.length > 60 ? text.slice(0, 57) + "…" : text || _t("(empty)"))
                : _t("Your browser blocked the clipboard."),
            { type: ok ? "success" : "warning" }
        );
    },

    // ------------------------------------------------------------------
    // Persistent column widths
    // ------------------------------------------------------------------
    axsTrackResize(ev) {
        const th = ev.target.closest("th");
        if (!th || !this.axsLvm) {
            return;
        }
        const headers = [...th.parentElement.children];
        const offset = this.hasSelectors ? 1 : 0;
        const column = this.columns[headers.indexOf(th) - offset];
        if (!column || column.type !== "field") {
            return;
        }
        const key = this.axsKeyOf(column);
        const onUp = () => {
            window.removeEventListener("pointerup", onUp, true);
            // let Odoo finish its own resize bookkeeping first
            setTimeout(() => {
                if (!th.isConnected) {
                    return;
                }
                const width = th.getBoundingClientRect().width;
                const style = getComputedStyle(th);
                const inner = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
                this.axsLvm.saveColumnWidth(key, Math.max(20, inner));
            }, 0);
        };
        window.addEventListener("pointerup", onUp, true);
    },
});
