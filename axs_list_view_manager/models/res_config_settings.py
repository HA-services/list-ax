# Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

PARAM_PREFIX = "axs_lvm."

# key: (type, default)
LVM_SETTINGS = {
    "serial_number": ("bool", True),
    "hover_highlight": ("bool", True),
    "column_filters": ("bool", True),
    "copy_cell": ("bool", True),
    "edit_toggle": ("bool", True),
    "refresh_button": ("bool", True),
    "export_view": ("bool", True),
    "copy_rows": ("bool", True),
    "extra_fields": ("bool", True),
    "auto_refresh": ("bool", True),
    "hover_color": ("color", "#E8F1FB"),
    "header_bg": ("color", ""),
    "header_color": ("color", ""),
    "accent_color": ("color", "#714B67"),
    "excluded_models": ("char", ""),
}


def _read_param(icp, key):
    kind, default = LVM_SETTINGS[key]
    if kind == "bool":
        return icp.get_bool(PARAM_PREFIX + key, default)
    return icp.get_str(PARAM_PREFIX + key, default) or default


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    axs_lvm_serial_number = fields.Boolean("Serial Number Column", default=True)
    axs_lvm_hover_highlight = fields.Boolean("Highlight Row on Hover", default=True)
    axs_lvm_column_filters = fields.Boolean("Column Filters (Advanced Search)", default=True)
    axs_lvm_copy_cell = fields.Boolean("Copy Cell Value", default=True)
    axs_lvm_edit_toggle = fields.Boolean("Read / Edit Mode Toggle", default=True)
    axs_lvm_refresh_button = fields.Boolean("Reload Button", default=True)
    axs_lvm_export_view = fields.Boolean("Export Current View", default=True)
    axs_lvm_copy_rows = fields.Boolean("Copy Rows to Clipboard", default=True)
    axs_lvm_extra_fields = fields.Boolean("Add Any Field as Column", default=True)
    axs_lvm_auto_refresh = fields.Boolean("Auto Refresh", default=True)
    axs_lvm_hover_color = fields.Char("Hover Color", default="#E8F1FB")
    axs_lvm_header_bg = fields.Char("Header Background")
    axs_lvm_header_color = fields.Char("Header Text Color")
    axs_lvm_accent_color = fields.Char("Toggle & Accent Color", default="#714B67")
    axs_lvm_excluded_model_ids = fields.Many2many(
        "ir.model", string="Disabled on Models",
        compute="_compute_axs_lvm_excluded_model_ids", inverse="_inverse_axs_lvm_excluded_model_ids",
        readonly=False,
        help="List View Manager features are switched off on these models.",
    )

    @api.depends("company_id")
    def _compute_axs_lvm_excluded_model_ids(self):
        names = [n for n in (_read_param(self.env["ir.config_parameter"].sudo(), "excluded_models") or "").split(",") if n]
        models_ = self.env["ir.model"].sudo().search([("model", "in", names)]) if names else self.env["ir.model"]
        for settings in self:
            settings.axs_lvm_excluded_model_ids = models_

    def _inverse_axs_lvm_excluded_model_ids(self):
        for settings in self:
            self.env["ir.config_parameter"].sudo().set_str(
                PARAM_PREFIX + "excluded_models", ",".join(settings.axs_lvm_excluded_model_ids.mapped("model")) or None
            )

    @api.model
    def get_values(self):
        res = super().get_values()
        icp = self.env["ir.config_parameter"].sudo()
        for key, (kind, _default) in LVM_SETTINGS.items():
            if key == "excluded_models":
                continue
            res["axs_lvm_" + key] = _read_param(icp, key)
        return res

    def set_values(self):
        super().set_values()
        icp = self.env["ir.config_parameter"].sudo()
        for key, (kind, _default) in LVM_SETTINGS.items():
            if key == "excluded_models":
                continue
            value = self["axs_lvm_" + key]
            if kind == "bool":
                # stored explicitly: a missing parameter means "default"
                icp.set_bool(PARAM_PREFIX + key, bool(value))
            else:
                icp.set_str(PARAM_PREFIX + key, value or None)

    def action_axs_lvm_open_layouts(self):
        return self.env["ir.actions.actions"]._for_xml_id("axs_list_view_manager.action_axs_lvm_layout")

    @api.model
    def _axs_lvm_get_settings(self):
        icp = self.env["ir.config_parameter"].sudo()
        settings = {key: _read_param(icp, key) for key in LVM_SETTINGS}
        settings["excluded_models"] = [n for n in (settings["excluded_models"] or "").split(",") if n]
        return settings
