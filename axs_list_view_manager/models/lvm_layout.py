# Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
import json
import logging

import psycopg2

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError

_logger = logging.getLogger(__name__)

DENSITIES = ("compact", "comfortable", "spacious")
# Field types a user may add to a list as an extra column.
ADDABLE_FIELD_TYPES = (
    "char", "text", "html", "integer", "float", "monetary", "boolean", "date", "datetime",
    "selection", "many2one", "many2many",
)
MAX_COLUMNS = 300
MAX_LABEL_LENGTH = 128


class AxsLvmLayout(models.Model):
    _name = "axs.lvm.layout"
    _description = "List View Layout (AXSync List View Manager)"
    _order = "model, view_id, user_id"
    _rec_name = "display_name"

    user_id = fields.Many2one(
        "res.users", string="User", index=True, ondelete="cascade",
        help="Owner of this layout. Empty means it is the team default layout for this list view.",
    )
    model = fields.Char(string="Model", required=True, index=True)
    model_id = fields.Many2one(
        "ir.model", string="Model Record", compute="_compute_model_id", store=True, ondelete="cascade",
    )
    view_id = fields.Many2one("ir.ui.view", string="List View", index=True, ondelete="cascade")
    is_team_default = fields.Boolean(compute="_compute_is_team_default", store=True)
    columns = fields.Json(string="Columns", default=list)
    extra_field_names = fields.Char(
        string="Added Fields", help="Comma separated technical names of fields added to the list by the user.",
    )
    density = fields.Selection(
        [("compact", "Compact"), ("comfortable", "Comfortable"), ("spacious", "Spacious")],
        default="comfortable", required=True,
    )
    wrap_text = fields.Boolean(string="Wrap Long Text")
    column_count = fields.Integer(compute="_compute_column_count")
    columns_summary = fields.Text(compute="_compute_column_count")

    def init(self):
        # One layout per (user or team, model, view). NULLs are normalised so that the
        # team default (user_id NULL) and generated default views (view_id NULL) are unique too.
        self.env.cr.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS axs_lvm_layout_unique_scope
            ON axs_lvm_layout (COALESCE(user_id, 0), model, COALESCE(view_id, 0))
        """)

    @api.depends("model")
    def _compute_model_id(self):
        ir_model = self.env["ir.model"].sudo()
        for layout in self:
            layout.model_id = ir_model._get(layout.model) if layout.model else False

    @api.depends("user_id")
    def _compute_is_team_default(self):
        for layout in self:
            layout.is_team_default = not layout.user_id

    @api.depends("columns")
    def _compute_column_count(self):
        for layout in self:
            cols = layout.columns or []
            layout.column_count = len([c for c in cols if c.get("visible", True)])
            lines = []
            for index, col in enumerate(cols, 1):
                details = [_("visible") if col.get("visible", True) else _("hidden")]
                if col.get("label"):
                    details.append(_("label: %s", col["label"]))
                if col.get("width"):
                    details.append("%spx" % col["width"])
                if col.get("extra"):
                    details.append(_("added field"))
                lines.append("%s. %s (%s)" % (index, col.get("key"), ", ".join(details)))
            layout.columns_summary = "\n".join(lines)

    @api.depends("user_id", "model", "view_id")
    def _compute_display_name(self):
        for layout in self:
            owner = layout.user_id.name if layout.user_id else _("Team default")
            view = layout.view_id.name or _("Default list")
            layout.display_name = f"{layout.model} / {view} ({owner})"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @api.model
    def _axs_is_manager(self):
        return self.env.user.has_group("axs_list_view_manager.group_lvm_manager")

    @api.model
    def _axs_check_model(self, model):
        if not isinstance(model, str) or model not in self.env:
            raise UserError(_("Unknown model: %s", model))
        if not self.env.user._is_internal():
            raise AccessError(_("Only internal users can personalize list views."))
        return self.env[model]

    @api.model
    def _axs_view_id(self, view_id):
        try:
            view_id = int(view_id or 0)
        except (TypeError, ValueError):
            view_id = 0
        if view_id and not self.env["ir.ui.view"].sudo().browse(view_id).exists():
            view_id = 0
        return view_id or False

    @api.model
    def _axs_domain(self, model, view_id, user_id):
        return [("model", "=", model), ("view_id", "=", view_id or False), ("user_id", "=", user_id or False)]

    @api.model
    def _axs_addable_field_defs(self, model):
        Model = self.env[model]
        result = {}
        for name, desc in Model.fields_get(attributes=["string", "type", "store", "searchable", "relation"]).items():
            if desc.get("type") not in ADDABLE_FIELD_TYPES:
                continue
            if name in ("id", "display_name", "__last_update"):
                continue
            result[name] = desc
        return result

    @api.model
    def _axs_sanitize(self, model, vals):
        """Validate and normalise a layout payload coming from the web client."""
        vals = dict(vals or {})
        columns = vals.get("columns") or []
        if isinstance(columns, str):
            columns = json.loads(columns)
        if not isinstance(columns, list):
            raise UserError(_("Invalid column layout."))
        addable = None
        clean, extra, seen = [], [], set()
        for col in columns[:MAX_COLUMNS]:
            if not isinstance(col, dict) or not isinstance(col.get("key"), str):
                continue
            key = col["key"][:200]
            if key in seen:
                continue
            seen.add(key)
            item = {"key": key, "visible": bool(col.get("visible", True))}
            label = col.get("label")
            if isinstance(label, str) and label.strip():
                item["label"] = label.strip()[:MAX_LABEL_LENGTH]
            width = col.get("width")
            if isinstance(width, (int, float)) and 20 <= width <= 2000:
                item["width"] = int(width)
            if col.get("extra"):
                field_name = key[2:] if key.startswith("f:") else key
                if addable is None:
                    addable = self._axs_addable_field_defs(model)
                if field_name not in addable:
                    continue
                item["extra"] = True
                extra.append(field_name)
            clean.append(item)
        res = {"columns": clean, "extra_field_names": ",".join(extra) or False}
        if vals.get("density") in DENSITIES:
            res["density"] = vals["density"]
        if "wrap_text" in vals:
            res["wrap_text"] = bool(vals["wrap_text"])
        return res

    def _axs_export(self):
        self.ensure_one()
        return {
            "id": self.id,
            "columns": self.columns or [],
            "density": self.density,
            "wrap_text": self.wrap_text,
            "is_team_default": self.is_team_default,
        }

    @api.model
    def _axs_upsert(self, model, view_id, user_id, vals):
        vals = self._axs_sanitize(model, vals)
        domain = self._axs_domain(model, view_id, user_id)
        layout = self.search(domain, limit=1)
        if not layout:
            try:
                # a concurrent request (other tab, double click) may create it first
                with self.env.cr.savepoint():
                    return self.create(dict(vals, model=model, view_id=view_id, user_id=user_id))
            except psycopg2.IntegrityError:
                layout = self.search(domain, limit=1)
                if not layout:
                    raise
        layout.write(vals)
        return layout

    # ------------------------------------------------------------------
    # Web client API
    # ------------------------------------------------------------------
    @api.model
    def axs_get_layout(self, model, view_id=False):
        self._axs_check_model(model)
        view_id = self._axs_view_id(view_id)
        user_layout = self.search(self._axs_domain(model, view_id, self.env.uid), limit=1)
        team_layout = self.search(self._axs_domain(model, view_id, False), limit=1)
        return {
            "user": user_layout._axs_export() if user_layout else False,
            "team": team_layout._axs_export() if team_layout else False,
        }

    @api.model
    def axs_save_layout(self, model, view_id, vals):
        self._axs_check_model(model)
        view_id = self._axs_view_id(view_id)
        return self._axs_upsert(model, view_id, self.env.uid, vals)._axs_export()

    @api.model
    def axs_reset_layout(self, model, view_id=False):
        self._axs_check_model(model)
        view_id = self._axs_view_id(view_id)
        self.search(self._axs_domain(model, view_id, self.env.uid)).unlink()
        return self.axs_get_layout(model, view_id)

    @api.model
    def axs_publish_team_layout(self, model, view_id, vals):
        self._axs_check_model(model)
        if not self._axs_is_manager():
            raise AccessError(_("Only List View Manager administrators can publish team layouts."))
        view_id = self._axs_view_id(view_id)
        return self._axs_upsert(model, view_id, False, vals)._axs_export()

    @api.model
    def axs_remove_team_layout(self, model, view_id=False):
        self._axs_check_model(model)
        if not self._axs_is_manager():
            raise AccessError(_("Only List View Manager administrators can remove team layouts."))
        view_id = self._axs_view_id(view_id)
        self.search(self._axs_domain(model, view_id, False)).unlink()
        return self.axs_get_layout(model, view_id)

    @api.model
    def axs_get_addable_fields(self, model):
        self._axs_check_model(model)
        defs = self._axs_addable_field_defs(model)
        return sorted(
            (
                {"name": name, "string": d.get("string") or name, "type": d["type"]}
                for name, d in defs.items()
            ),
            key=lambda f: (f["string"] or "").lower(),
        )

    @api.model
    def axs_duplicate_records(self, model, record_ids):
        """Duplicate several records at once. Runs with the user's rights: the ORM enforces
        access rights and record rules on read and create."""
        Model = self._axs_check_model(model)
        if not isinstance(record_ids, list) or not all(isinstance(i, int) for i in record_ids):
            raise UserError(_("Invalid selection."))
        if len(record_ids) > 500:
            raise UserError(_("You can duplicate at most 500 records at once."))
        new_ids = []
        for record in Model.browse(record_ids).exists():
            new_ids.append(record.copy().id)
        return new_ids

    # ------------------------------------------------------------------
    # Extra field injection support
    # ------------------------------------------------------------------
    @api.model
    @api.ormcache("uid", "model")
    def _axs_effective_extra_fields(self, uid, model):
        """Return {view_id: (field names...)} of the effective layout (personal, else team)
        for ``uid`` on ``model``. Cached; the cache is cleared whenever a layout changes."""
        self.env.cr.execute("""
            SELECT COALESCE(view_id, 0), user_id, extra_field_names
              FROM axs_lvm_layout
             WHERE model = %s AND (user_id = %s OR user_id IS NULL)
        """, (model, uid))
        personal, team = {}, {}
        for view_id, user_id, names in self.env.cr.fetchall():
            target = personal if user_id else team
            target[view_id] = tuple(n for n in (names or "").split(",") if n)
        effective = dict(team)
        effective.update(personal)
        return tuple(sorted((k, v) for k, v in effective.items() if v))

    @api.model
    def _axs_extra_fields_enabled(self):
        return self.env["ir.config_parameter"].sudo().get_bool("axs_lvm.extra_fields", True)

    # The extra fields of a layout are injected in the list arch, which is cached by the
    # registry: invalidate the cache only when they actually change.
    @api.model
    def _axs_invalidate_arch_cache(self):
        self.env.transaction.invalidate_ormcache()

    @api.model_create_multi
    def create(self, vals_list):
        layouts = super().create(vals_list)
        if any(layouts.mapped("extra_field_names")):
            self._axs_invalidate_arch_cache()
        return layouts

    def write(self, vals):
        before = {layout.id: (layout.extra_field_names, layout.user_id.id, layout.view_id.id, layout.model)
                  for layout in self}
        res = super().write(vals)
        after = {layout.id: (layout.extra_field_names, layout.user_id.id, layout.view_id.id, layout.model)
                 for layout in self}
        if before != after and any(v[0] for v in list(before.values()) + list(after.values())):
            self._axs_invalidate_arch_cache()
        return res

    def unlink(self):
        had_extra = any(self.mapped("extra_field_names"))
        res = super().unlink()
        if had_extra:
            self._axs_invalidate_arch_cache()
        return res
