from . import models


def uninstall_hook(env):
    """Remove the List View Manager settings when the module is uninstalled."""
    env["ir.config_parameter"].sudo().search([("key", "=like", "axs_lvm.%")]).unlink()
