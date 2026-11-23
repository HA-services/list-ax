from . import models

from odoo import SUPERUSER_ID, api


def uninstall_hook(cr, registry):
    """Remove the List View Manager settings when the module is uninstalled."""
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["ir.config_parameter"].sudo().search([("key", "=like", "axs_lvm.%")]).unlink()
