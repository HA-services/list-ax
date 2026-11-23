# Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
from lxml import etree

from odoo import api, models

LIST_VIEW_TYPES = ("list", "tree")


class Base(models.AbstractModel):
    _inherit = "base"

    @api.model
    def _axs_lvm_extra_columns(self):
        """Extra columns configured with AXSync List View Manager for the current user."""
        if self._name == "axs.lvm.layout" or "axs.lvm.layout" not in self.env:
            return ()
        Layout = self.env["axs.lvm.layout"]
        if not Layout._axs_extra_fields_enabled():
            return ()
        return Layout.sudo()._axs_effective_extra_fields(self.env.uid, self._name)

    @api.model
    def _get_view_cache_key(self, view_id=None, view_type="form", **options):
        key = super()._get_view_cache_key(view_id, view_type, **options)
        if view_type in LIST_VIEW_TYPES:
            extra = self._axs_lvm_extra_columns()
            if extra:
                key = key + (("axs_lvm", extra),)
        return key

    @api.model
    def _get_view(self, view_id=None, view_type="form", **options):
        arch, view = super()._get_view(view_id, view_type, **options)
        if view_type in LIST_VIEW_TYPES:
            extra = dict(self._axs_lvm_extra_columns())
            names = extra.get(view.id if view else 0)
            if names:
                self._axs_lvm_inject_fields(arch, names)
        return arch, view

    @api.model
    def _axs_lvm_inject_fields(self, arch, names):
        present = {node.get("name") for node in arch.xpath("./field")}
        for name in names:
            field = self._fields.get(name)
            if not field or name in present:
                continue
            node = etree.SubElement(arch, "field", {"name": name, "optional": "show"})
            if field.type == "many2many":
                node.set("widget", "many2many_tags")
            node.set("readonly", "1")
