# Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
{
    "name": "AXSync List View Manager",
    "summary": "Personalize every Odoo list: show, hide, reorder, rename and resize columns, add any field, "
               "column filters, serial numbers, read/edit mode, export current view, copy cells and rows, "
               "team default layouts.",
    "description": """
AXSync List View Manager
========================
Per-user list layouts (show/hide, drag & drop reorder, rename, persistent widths, extra fields),
team default layouts, column filters that work with Group By, serial numbers, row hover highlight,
read/edit mode toggle, reload and auto refresh, export of the current view to Excel, copy cell and
copy rows, row density and text wrapping, model exclusion list and color settings.
""",
    "version": "16.0.1.0.0",
    "category": "Productivity",
    "author": "AXSync",
    "maintainer": "AXSync",
    "website": "https://axsync.com",
    "support": "hunain@axsync.com",
    "license": "OPL-1",
    "price": 87.99,
    "currency": "USD",
    "depends": ["web", "base_setup"],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
        "views/lvm_layout_views.xml",
        "views/res_config_settings_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "axs_list_view_manager/static/src/scss/lvm.scss",
            "axs_list_view_manager/static/src/js/lvm_compat.js",
            "axs_list_view_manager/static/src/js/lvm_core.js",
            "axs_list_view_manager/static/src/js/lvm_toolbar.js",
            "axs_list_view_manager/static/src/js/list_renderer_patch.js",
            "axs_list_view_manager/static/src/js/list_controller_patch.js",
            # Loaded right after the standard list templates so that the extensions also
            # reach list renderers of other apps that derive their own template from it.
            (
                "after",
                "web/static/src/views/list/list_renderer.xml",
                "axs_list_view_manager/static/src/xml/lvm_templates.xml",
            ),
        ],
    },
    "images": ["static/description/banner.png"],
    "uninstall_hook": "uninstall_hook",
    "installable": True,
    "application": False,
    "auto_install": False,
}
