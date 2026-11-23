/** @odoo-module **/
// Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.

import { Component, onWillUnmount, proxy, signal, t, useListener, useProps } from "@odoo/owl";
import { browser } from "@web/core/browser/browser";
import { _t } from "@web/core/l10n/translation";
import { useAutofocus, useBus } from "@web/core/utils/hooks";
import { AUTO_REFRESH_CHOICES, DENSITIES } from "./lvm_core";
import { clearViewCaches } from "./lvm_compat";

// -----------------------------------------------------------------------------
// Column filter cell (rendered in the filter row under the list header)
// -----------------------------------------------------------------------------
export class AxsColumnFilter extends Component {
    static template = "axs_list_view_manager.ColumnFilter";
    props = useProps({
        lvm: t.any(),
        filterKey: t.any(),
        field: t.any(),
        kind: t.any(),
        label: t.any(),
    });

    setup() {
        // proxies read during rendering are tracked by Owl
        this.lvmState = this.props.lvm.state;
    }

    get value() {
        // read through the reactive proxy to re-render when filters change
        const filter = this.lvmState.filters[this.props.filterKey];
        return filter ? filter.value : undefined;
    }

    get textValue() {
        const value = this.value;
        return typeof value === "string" ? value : "";
    }

    get dateValue() {
        return this.value && typeof this.value === "object" ? this.value : {};
    }

    get selectionOptions() {
        return this.props.field.selection || [];
    }

    isSelected(optionValue) {
        const value = this.value;
        return value !== undefined && value !== null && String(value) === String(optionValue);
    }

    get placeholder() {
        if (this.props.kind === "number") {
            return _t("e.g. >100, 10..50");
        }
        return _t("Search…");
    }

    apply(value) {
        return this.props.lvm.setFilter(
            this.props.filterKey,
            this.props.label,
            this.props.field,
            this.props.kind,
            value
        );
    }

    onTextKeydown(ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            ev.stopPropagation();
            this.apply(ev.target.value);
        } else if (ev.key === "Escape") {
            ev.target.value = this.textValue;
            ev.target.blur();
        }
    }

    onTextChange(ev) {
        this.apply(ev.target.value);
    }

    onDateChange(bound, ev) {
        const value = Object.assign({}, this.dateValue, { [bound]: ev.target.value || "" });
        if (!value.from && !value.to) {
            return this.apply(null);
        }
        return this.apply(value);
    }

    onSelectChange(ev) {
        this.apply(ev.target.value);
    }

    clear() {
        this.apply(null);
    }
}

// -----------------------------------------------------------------------------
// Column manager: show/hide, reorder, rename, search, add fields, layouts
// -----------------------------------------------------------------------------
export class AxsColumnManager extends Component {
    static template = "axs_list_view_manager.ColumnManager";
    props = useProps({ lvm: t.any(), close: t.any() });
    autofocusRef = signal.ref();

    setup() {
        this.lvm = this.props.lvm;
        this.densities = DENSITIES.map((d) => ({
            value: d,
            label: { compact: _t("Compact"), comfortable: _t("Comfortable"), spacious: _t("Spacious") }[d],
        }));
        this.state = proxy({
            search: "",
            columns: this.lvm.getManagerColumns(),
            editingKey: null,
            dragKey: null,
            overKey: null,
            addOpen: false,
            addSearch: "",
            addable: null,
            busy: false,
        });
        this.lvmState = this.lvm.state;
        useAutofocus({ ref: this.autofocusRef });
        this.labelTimer = null;
        onWillUnmount(() => {
            if (this.labelTimer) {
                browser.clearTimeout(this.labelTimer);
                this.flushSave();
            }
        });
    }

    get filteredColumns() {
        const search = this.state.search.trim().toLowerCase();
        if (!search) {
            return this.state.columns;
        }
        return this.state.columns.filter((c) =>
            `${c.label || c.defaultLabel} ${c.defaultLabel} ${c.name || ""}`.toLowerCase().includes(search)
        );
    }

    get visibleCount() {
        return this.state.columns.filter((c) => c.visible).length;
    }

    get hasPersonalLayout() {
        return Boolean(this.lvmState.userLayout);
    }

    get hasTeamLayout() {
        return Boolean(this.lvmState.teamLayout);
    }

    get canAddFields() {
        return this.lvm.feature("extra_fields");
    }

    get density() {
        return this.lvm.density;
    }

    get wrapText() {
        return this.lvm.wrapText;
    }

    displayLabel(col) {
        return col.label || col.defaultLabel;
    }

    columnIcon(col) {
        if (col.type === "button_group") {
            return "widgets";
        }
        if (col.type === "widget") {
            return "extension";
        }
        const type = col.fieldType;
        return (
            {
                char: "text_fields",
                text: "text_fields",
                html: "text_fields",
                integer: "tag",
                float: "tag",
                monetary: "payments",
                date: "calendar_today",
                datetime: "schedule",
                boolean: "check_box",
                selection: "radio_button_checked",
                many2one: "link",
                many2many: "label",
                one2many: "view_list",
            }[type] || "view_column"
        );
    }

    // -- persistence ------------------------------------------------------
    save(extra) {
        return this.lvm.save(this.lvm.entriesFromManagerColumns(this.state.columns), extra);
    }

    scheduleSave() {
        if (this.labelTimer) {
            browser.clearTimeout(this.labelTimer);
        }
        this.labelTimer = browser.setTimeout(() => this.flushSave(), 500);
    }

    flushSave() {
        this.labelTimer = null;
        this.save();
    }

    // -- visibility -------------------------------------------------------
    toggleVisible(col) {
        if (col.visible && this.visibleCount <= 1) {
            this.env.services.notification.add(_t("At least one column must stay visible."), { type: "warning" });
            return;
        }
        col.visible = !col.visible;
        this.save();
    }

    showAll(visible) {
        const targets = this.filteredColumns;
        for (const col of targets) {
            col.visible = visible;
        }
        if (!this.state.columns.some((c) => c.visible) && this.state.columns.length) {
            this.state.columns[0].visible = true;
        }
        this.save();
    }

    // -- rename -----------------------------------------------------------
    startRename(col) {
        if (col.type !== "field") {
            return;
        }
        this.state.editingKey = col.key;
    }

    onRenameInput(col, ev) {
        col.label = ev.target.value;
        this.scheduleSave();
    }

    onSearchInput(ev) {
        this.state.search = ev.target.value;
    }

    onAddSearchInput(ev) {
        this.state.addSearch = ev.target.value;
    }

    stopRename() {
        this.state.editingKey = null;
    }

    onRenameKeydown(col, ev) {
        if (ev.key === "Enter" || ev.key === "Escape") {
            ev.preventDefault();
            this.state.editingKey = null;
            this.flushSave();
        }
    }

    resetLabel(col) {
        col.label = "";
        this.state.editingKey = null;
        this.save();
    }

    // -- reorder (native drag & drop + keyboard friendly arrows) ------------
    onDragStart(col, ev) {
        this.state.dragKey = col.key;
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", col.key);
    }

    onDragOver(col, ev) {
        if (!this.state.dragKey) {
            return;
        }
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        this.state.overKey = col.key;
    }

    onDrop(col, ev) {
        ev.preventDefault();
        const fromKey = this.state.dragKey;
        this.state.dragKey = null;
        this.state.overKey = null;
        if (!fromKey || fromKey === col.key) {
            return;
        }
        this.move(fromKey, col.key);
    }

    onDragEnd() {
        this.state.dragKey = null;
        this.state.overKey = null;
    }

    move(fromKey, toKey) {
        const columns = this.state.columns;
        const from = columns.findIndex((c) => c.key === fromKey);
        const to = columns.findIndex((c) => c.key === toKey);
        if (from === -1 || to === -1) {
            return;
        }
        const [moved] = columns.splice(from, 1);
        columns.splice(to, 0, moved);
        this.save();
    }

    moveBy(col, delta) {
        // move among the columns currently listed in the panel; a visible column jumps over
        // hidden ones so that the move is always visible in the list
        const listed = this.filteredColumns;
        let index = listed.indexOf(col) + delta;
        while (col.visible && index >= 0 && index < listed.length && !listed[index].visible) {
            index += delta;
        }
        if (index < 0 || index >= listed.length) {
            return;
        }
        this.move(col.key, listed[index].key);
    }

    // -- extra fields -----------------------------------------------------
    async toggleAdd() {
        this.state.addOpen = !this.state.addOpen;
        if (this.state.addOpen && !this.state.addable) {
            const fields = await this.env.services.orm.call("axs.lvm.layout", "axs_get_addable_fields", [
                this.lvm.resModel,
            ]);
            this.state.addable = fields;
        }
    }

    get addableFields() {
        const present = new Set(this.state.columns.filter((c) => c.type === "field").map((c) => c.name));
        const search = this.state.addSearch.trim().toLowerCase();
        return (this.state.addable || [])
            .filter((f) => !present.has(f.name))
            .filter((f) => !search || `${f.string} ${f.name}`.toLowerCase().includes(search))
            .slice(0, 60);
    }

    async addField(field) {
        if (this.state.busy) {
            return;
        }
        this.state.busy = true;
        const entries = this.lvm.entriesFromManagerColumns(this.state.columns);
        entries.push({ key: `f:${field.name}`, visible: true, extra: true });
        try {
            await this.lvm.save(entries);
            this.env.services.notification.add(_t("“%s” added. Reloading the list…", field.string), {
                type: "success",
            });
            clearViewCaches(this.env);
            browser.setTimeout(() => browser.location.reload(), 400);
        } finally {
            this.state.busy = false;
        }
    }

    async removeExtraField(col) {
        const columns = this.state.columns.filter((c) => c !== col);
        this.state.busy = true;
        try {
            await this.lvm.save(this.lvm.entriesFromManagerColumns(columns));
            clearViewCaches(this.env);
            browser.location.reload();
        } finally {
            this.state.busy = false;
        }
    }

    // -- display options --------------------------------------------------
    setDensity(density) {
        this.save({ density });
    }

    toggleWrap() {
        this.save({ wrap_text: !this.wrapText });
    }

    async resetWidths() {
        await this.lvm.resetWidths();
        this.state.columns = this.lvm.getManagerColumns();
    }

    // -- layouts ----------------------------------------------------------
    async restoreDefault() {
        await this.lvm.reset();
        this.state.columns = this.lvm.getManagerColumns();
        this.env.services.notification.add(
            this.hasTeamLayout ? _t("Team default layout restored.") : _t("Default list restored."),
            { type: "info" }
        );
    }

    async publishTeam() {
        await this.lvm.publishTeam();
    }

    async removeTeam() {
        await this.lvm.removeTeam();
        this.state.columns = this.lvm.getManagerColumns();
    }
}

// -----------------------------------------------------------------------------
// Toolbar displayed in the control panel of list views
// -----------------------------------------------------------------------------
export class AxsLvmToolbar extends Component {
    static template = "axs_list_view_manager.Toolbar";
    static components = { AxsColumnManager };
    props = useProps({
        lvm: t.any(),
        reload: t.any(),
        exportView: t.any(),
        canExport: t.any(),
        canToggleEdit: t.any(),
        toggleEditMode: t.any(),
        isEditMode: t.any(),
    });
    rootRef = signal.ref();

    setup() {
        this.lvm = this.props.lvm;
        this.lvmState = this.lvm.state;
        this.state = proxy({ moreMenu: false, reloading: false });
        this.refreshChoices = AUTO_REFRESH_CHOICES.map((s) => ({
            seconds: s,
            label:
                s === 0
                    ? _t("Off")
                    : s < 60
                    ? _t("Every %s seconds", s)
                    : s === 60
                    ? _t("Every minute")
                    : _t("Every %s minutes", s / 60),
        }));
        if (this.env.searchModel) {
            useBus(this.env.searchModel, "update", () => this.lvm.syncFilters());
        }
        useListener(window, "mousedown", (ev) => {
            const root = this.rootRef();
            if (!root || root.contains(ev.target)) {
                return;
            }
            // clicks in dialogs/notifications opened from the panel must not close it
            if (ev.target.closest(".modal, .o_notification_manager, .o-autocomplete--dropdown-menu")) {
                return;
            }
            this.lvmState.panelOpen = false;
            this.state.moreMenu = false;
        });
    }

    feature(name) {
        return this.lvm.feature(name);
    }

    get filterCount() {
        return Object.keys(this.lvmState.filters).length;
    }

    togglePanel() {
        this.lvmState.panelOpen = !this.lvmState.panelOpen;
        this.state.moreMenu = false;
    }

    closePanel() {
        this.lvmState.panelOpen = false;
    }

    toggleFilters() {
        this.lvm.toggleFilterRow();
    }

    clearFilters() {
        this.lvm.clearFilters();
    }

    async reload() {
        if (this.state.reloading) {
            return;
        }
        this.state.reloading = true;
        try {
            await this.props.reload();
        } finally {
            this.state.reloading = false;
        }
    }

    get hasMoreMenu() {
        return this.props.canToggleEdit() || this.props.canExport() || this.feature("auto_refresh");
    }

    get editModeOn() {
        // read the reactive flag so that the toolbar re-renders when the mode changes
        return this.lvmState.editMode !== false && Boolean(this.props.isEditMode());
    }

    toggleMoreMenu() {
        this.state.moreMenu = !this.state.moreMenu;
        this.lvmState.panelOpen = false;
    }

    async toggleEditMode() {
        this.state.moreMenu = false;
        await this.props.toggleEditMode();
    }

    async exportView() {
        this.state.moreMenu = false;
        await this.props.exportView();
    }

    setAutoRefresh(seconds) {
        this.lvm.setAutoRefresh(seconds);
        this.state.moreMenu = false;
    }
}
