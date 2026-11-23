# Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
from odoo import models


class IrHttp(models.AbstractModel):
    _inherit = "ir.http"

    def session_info(self):
        info = super().session_info()
        user = self.env.user
        if info.get("uid") and user._is_internal():
            settings = self.env["res.config.settings"]._axs_lvm_get_settings()
            settings["is_manager"] = user.has_group("axs_list_view_manager.group_lvm_manager")
            info["axs_lvm"] = settings
        return info
