/** @odoo-module **/
// Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.

import { onWillStart, useEffect, useState, useSubEnv } from "@odoo/owl";
import { _t, patchClass } from "./lvm_compat";
import { download } from "@web/core/network/download";
import { useService } from "@web/core/utils/hooks";

import { ListController } from "@web/views/list/list_controller";
import { AxsLvmToolbar } from "./lvm_toolbar";
import { applyLvmTheme, copyText, getColumnDefaultLabel, isLvmEnabledFor, LvmViewState } from "./lvm_core";


function cleanCellText(text) {
    return (text || "").replace(/[\t\r\n]+/g, " ").trim();
}

patchClass(ListController.prototype, "axs_list_view_manager.ListController", {
    setup() {
        this._super(...arguments);
        this.axsLvm = null;
        const display = this.props.display || {};
        if (!isLvmEnabledFor(this.props.resModel) || this.env.inDialog || !display.controlPanel) {
            return;
        }
        applyLvmTheme();
        this.axsNotification = useService("notification");
        this.axsUi = useService("ui");
        this.axsLvm = new LvmViewState({
            resModel: this.props.resModel,
            viewId: this.env.config.viewId,
            orm: useService("orm"),
            notification: this.axsNotification,
            searchModel: this.env.searchModel,
        });
        this.axsToolbarEnv = { Component: AxsLvmToolbar, props: null };
        useSubEnv({ axsLvm: this.axsLvm, axsLvmToolbar: this.axsToolbarEnv });
        this.axsLvmState = useState(this.axsLvm.state);
        this.axsNativeEditable = this.editable;
        this.axsNativeMultiEdit = null;
        onWillStart(async () => {
            await this.axsLvm.load();
            const remembered = this.axsLvm.state.editModeRemembered;
            if (remembered !== undefined && this.axsCanToggleEdit) {
                this.axsApplyEditMode(remembered, false);
            }
        });
        const stored = this.axsReadEditMode();
        if (stored !== null) {
            this.axsLvm.state.editModeRemembered = stored;
        }
        useEffect(
            (seconds) => {
                if (!seconds) {
                    return;
                }
                const interval = setInterval(() => this.axsAutoReload(), seconds * 1000);
                return () => clearInterval(interval);
            },
            () => [this.axsLvm.feature("auto_refresh") ? this.axsLvmState.autoRefresh : 0]
        );
        // rendered with t-component: list controllers extending ListController keep working
        this.axsToolbarComponent = AxsLvmToolbar;
        this.axsToolbarProps = {
            lvm: this.axsLvm,
            reload: () => this.axsReload(),
            exportView: () => this.axsExportView(),
            canExport: () => this.axsCanExport,
            canToggleEdit: () => this.axsCanToggleEdit,
            toggleEditMode: () => this.axsToggleEditMode(),
            isEditMode: () => Boolean(this.editable),
        };
        this.axsToolbarEnv.props = this.axsToolbarProps;
    },

    // ------------------------------------------------------------------
    // Read / Edit mode
    // ------------------------------------------------------------------
    get axsCanToggleEdit() {
        return Boolean(
            this.axsLvm &&
                this.axsLvm.feature("edit_toggle") &&
                this.props.editable !== false &&
                this.activeActions &&
                this.activeActions.edit !== false
        );
    },

    axsReadEditMode() {
        try {
            const value = window.localStorage.getItem(this.axsLvm.storageKey("edit"));
            return value === null ? null : value === "1";
        } catch {
            return null;
        }
    },

    axsApplyEditMode(enabled, remember = true) {
        if (this.axsNativeMultiEdit === null) {
            this.axsNativeMultiEdit = this.model.multiEdit;
        }
        this.editable = enabled ? this.axsNativeEditable || "bottom" : false;
        this.hasOpenFormViewButton = this.editable ? this.archInfo.openFormView : false;
        this.model.multiEdit = enabled ? this.axsNativeMultiEdit : false;
        this.axsLvm.state.editMode = enabled;
        if (remember) {
            this.axsLvm.remember("edit", enabled ? "1" : "0");
        }
    },

    async axsToggleEditMode() {
        if (!this.axsCanToggleEdit) {
            return;
        }
        const enable = !this.editable;
        if (!enable && this.model.root.editedRecord) {
            const left = await this.model.root.unselectRecord(true);
            if (left === false) {
                return;
            }
        }
        this.axsApplyEditMode(enable);
        this.axsNotification.add(
            enable
                ? _t("Edit mode: click a cell to edit it directly in the list.")
                : _t("Read mode: clicking a row opens the record."),
            { type: "info" }
        );
        this.render(true);
    },

    // ------------------------------------------------------------------
    // Reload
    // ------------------------------------------------------------------
    async axsReload() {
        const root = this.model.root;
        if (root.editedRecord) {
            const saved = await root.editedRecord.save();
            if (!saved) {
                return;
            }
            await root.unselectRecord(true);
        }
        await this.model.load();
    },

    async axsAutoReload() {
        if (document.hidden || this.model.root.editedRecord || this.model.root.selection.length) {
            return;
        }
        await this.model.load();
    },

    // ------------------------------------------------------------------
    // Export current view (visible columns, custom labels, order, filters, grouping)
    // ------------------------------------------------------------------
    get axsCanExport() {
        return Boolean(this.axsLvm && this.axsLvm.feature("export_view") && this.isExportEnable !== false);
    },

    axsVisibleFieldColumns() {
        const info = this.axsLvm && this.axsLvm.renderInfo;
        if (!info) {
            return [];
        }
        return info.visibleColumns.filter((col) => col.type === "field" && info.fields[col.name]);
    },

    async axsExportView() {
        const root = this.model.root;
        const fields = root.fields;
        const columns = this.axsVisibleFieldColumns().filter((col) => {
            const field = fields[col.name];
            return field.exportable !== false && field.type !== "properties" && !col.name.includes(".");
        });
        if (!columns.length) {
            this.axsNotification.add(_t("There is no exportable column in this list."), { type: "warning" });
            return;
        }
        const seen = new Set();
        const exportFields = [];
        for (const col of columns) {
            if (seen.has(col.name)) {
                continue;
            }
            seen.add(col.name);
            exportFields.push({
                name: col.name,
                label: getColumnDefaultLabel(col, fields),
                type: fields[col.name].type,
            });
        }
        const selection = root.selection || [];
        const ids = selection.length && !root.isDomainSelected ? selection.map((r) => r.resId) : false;
        const params = {
            model: root.resModel,
            fields: exportFields,
            ids,
            domain: root.domain,
            groupby: root.groupBy || [],
            context: root.context,
            import_compat: false,
        };
        this.axsUi.block();
        try {
            await download({ url: "/web/export/xlsx", data: { data: JSON.stringify(params) } });
        } finally {
            this.axsUi.unblock();
        }
    },

    // ------------------------------------------------------------------
    // Copy rows as a table (pastes into Excel / Google Sheets)
    // ------------------------------------------------------------------
    async axsCopyRows() {
        const columns = this.axsVisibleFieldColumns();
        const fields = this.model.root.fields;
        const rootEl = this.rootRef.el;
        const selectedIds = new Set((this.model.root.selection || []).map((r) => r.id));
        let rows = [...rootEl.querySelectorAll(".o_list_renderer tbody tr.o_data_row")];
        if (selectedIds.size) {
            rows = rows.filter((tr) => selectedIds.has(tr.dataset.id));
        }
        if (!rows.length) {
            this.axsNotification.add(_t("There are no rows to copy."), { type: "warning" });
            return;
        }
        const lines = [columns.map((col) => cleanCellText(getColumnDefaultLabel(col, fields))).join("\t")];
        for (const tr of rows) {
            const cells = tr.querySelectorAll("td.o_data_cell");
            const byName = {};
            for (const td of cells) {
                const name = td.getAttribute("name");
                if (name && !(name in byName)) {
                    const clone = td.cloneNode(true);
                    clone.querySelectorAll(".axs_lvm_copy").forEach((el) => el.remove());
                    byName[name] = cleanCellText(clone.innerText || clone.textContent);
                }
            }
            lines.push(columns.map((col) => byName[col.name] || "").join("\t"));
        }
        const ok = await copyText(lines.join("\n"));
        const count = rows.length;
        let message = ok
            ? _t("%s rows copied. Paste them into Excel or Google Sheets.", count)
            : _t("Your browser blocked the clipboard.");
        if (ok && this.model.root.isDomainSelected) {
            message = _t("%s rows visible on this page copied (only loaded rows can be copied).", count);
        }
        this.axsNotification.add(message, { type: ok ? "success" : "warning" });
    },

    async axsDuplicateRecords() {
        const root = this.model.root;
        const resIds = await root.getResIds(true);
        if (!resIds.length) {
            return;
        }
        const newIds = await this.orm.call("axs.lvm.layout", "axs_duplicate_records", [root.resModel, resIds]);
        await this.model.load();
        this.axsNotification.add(_t("%s record(s) duplicated.", newIds.length), { type: "success" });
    },

    getActionMenuItems() {
        const items = this._super(...arguments);
        if (!this.axsLvm) {
            return items;
        }
        const other = [...(items.other || [])];
        if (this.axsCanExport) {
            other.unshift({
                key: "axs_export_view",
                description: _t("Export Selection (Current View)"),
                callback: () => this.axsExportView(),
            });
        }
        if (this.axsLvm.feature("copy_rows")) {
            other.push({
                key: "axs_copy_rows",
                description: _t("Copy Rows"),
                callback: () => this.axsCopyRows(),
            });
        }
        if (this.activeActions.create !== false && this.activeActions.duplicate !== false && !this.model.root.isM2MGrouped) {
            other.push({
                key: "axs_duplicate",
                description: _t("Duplicate"),
                callback: () => this.axsDuplicateRecords(),
            });
        }
        return Object.assign({}, items, { other });
    },
});
