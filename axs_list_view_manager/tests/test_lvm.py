# Part of AXSync List View Manager. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged("post_install", "-at_install", "axs_lvm")
class TestListViewManager(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Layout = cls.env["axs.lvm.layout"]
        cls.user = new_test_user(cls.env, login="lvm_user", groups="base.group_user")
        cls.other = new_test_user(cls.env, login="lvm_other", groups="base.group_user")
        cls.manager = new_test_user(cls.env, login="lvm_manager", groups="base.group_user,base.group_system")
        cls.view = cls.env.ref("base.view_partner_tree")
        cls.list_type = "list" if "list" in dict(cls.env["ir.ui.view"]._fields["type"].selection) else "tree"

    def _layout(self, user):
        return self.Layout.with_user(user)

    def test_save_and_get_layout(self):
        payload = {
            "columns": [
                {"key": "f:name", "visible": True, "label": "  Customer  ", "width": 180},
                {"key": "f:email", "visible": False},
                {"key": "f:name", "visible": False},  # duplicate key ignored
                {"key": 12},  # invalid entry ignored
                {"key": "f:phone", "visible": True, "width": 5},  # width out of range dropped
            ],
            "density": "compact",
            "wrap_text": True,
        }
        saved = self._layout(self.user).axs_save_layout("res.partner", self.view.id, payload)
        self.assertEqual(saved["columns"], [
            {"key": "f:name", "visible": True, "label": "Customer", "width": 180},
            {"key": "f:email", "visible": False},
            {"key": "f:phone", "visible": True},
        ])
        self.assertEqual(saved["density"], "compact")
        self.assertTrue(saved["wrap_text"])
        data = self._layout(self.user).axs_get_layout("res.partner", self.view.id)
        self.assertEqual(data["user"]["id"], saved["id"])
        self.assertFalse(data["team"])
        # saving again updates the same record
        saved2 = self._layout(self.user).axs_save_layout("res.partner", self.view.id, {"columns": []})
        self.assertEqual(saved2["id"], saved["id"])

    def test_layouts_are_personal(self):
        self._layout(self.user).axs_save_layout("res.partner", self.view.id, {"columns": [{"key": "f:name"}]})
        data = self._layout(self.other).axs_get_layout("res.partner", self.view.id)
        self.assertFalse(data["user"])
        layouts = self._layout(self.other).search([])
        self.assertFalse(layouts.filtered(lambda l: l.user_id == self.user))
        mine = self.Layout.search([("user_id", "=", self.user.id)])
        with self.assertRaises(AccessError):
            mine.with_user(self.other).write({"density": "spacious"})

    def test_team_layout(self):
        with self.assertRaises(AccessError):
            self._layout(self.user).axs_publish_team_layout("res.partner", self.view.id, {"columns": []})
        self._layout(self.manager).axs_publish_team_layout(
            "res.partner", self.view.id, {"columns": [{"key": "f:name", "label": "Team name"}]}
        )
        data = self._layout(self.user).axs_get_layout("res.partner", self.view.id)
        self.assertEqual(data["team"]["columns"][0]["label"], "Team name")
        team = self.Layout.search([("user_id", "=", False)])
        with self.assertRaises(AccessError):
            team.with_user(self.user).write({"density": "compact"})
        # personal layout wins, reset falls back to team
        self._layout(self.user).axs_save_layout("res.partner", self.view.id, {"columns": [{"key": "f:email"}]})
        data = self._layout(self.user).axs_reset_layout("res.partner", self.view.id)
        self.assertFalse(data["user"])
        self.assertTrue(data["team"])
        self._layout(self.manager).axs_remove_team_layout("res.partner", self.view.id)
        self.assertFalse(self._layout(self.user).axs_get_layout("res.partner", self.view.id)["team"])

    def test_invalid_model(self):
        with self.assertRaises(UserError):
            self._layout(self.user).axs_get_layout("not.a.model", False)

    def test_extra_fields_injected_in_arch(self):
        Partner = self.env["res.partner"].with_user(self.user)
        arch_before = Partner.get_views([(self.view.id, self.list_type)])["views"][self.list_type]["arch"]
        self.assertNotIn('name="ref"', arch_before)
        self._layout(self.user).axs_save_layout("res.partner", self.view.id, {
            "columns": [
                {"key": "f:name", "visible": True},
                {"key": "f:ref", "visible": True, "extra": True},
                {"key": "f:image_1920", "visible": True, "extra": True},  # binary: refused
                {"key": "f:does_not_exist", "visible": True, "extra": True},  # unknown: refused
            ],
        })
        layout = self.Layout.search([("user_id", "=", self.user.id)])
        self.assertEqual(layout.extra_field_names, "ref")
        arch_after = Partner.get_views([(self.view.id, self.list_type)])["views"][self.list_type]["arch"]
        self.assertIn('name="ref"', arch_after)
        # other users are not affected
        arch_other = self.env["res.partner"].with_user(self.other).get_views(
            [(self.view.id, self.list_type)])["views"][self.list_type]["arch"]
        self.assertNotIn('name="ref"', arch_other)
        # removing the field removes the column
        self._layout(self.user).axs_reset_layout("res.partner", self.view.id)
        arch_reset = Partner.get_views([(self.view.id, self.list_type)])["views"][self.list_type]["arch"]
        self.assertNotIn('name="ref"', arch_reset)

    def test_extra_fields_setting(self):
        self.env["ir.config_parameter"].sudo().set_param("axs_lvm.extra_fields", "False")
        self._layout(self.user).axs_save_layout("res.partner", self.view.id, {
            "columns": [{"key": "f:ref", "visible": True, "extra": True}],
        })
        arch = self.env["res.partner"].with_user(self.user).get_views(
            [(self.view.id, self.list_type)])["views"][self.list_type]["arch"]
        self.assertNotIn('name="ref"', arch)

    def test_addable_fields(self):
        fields = self._layout(self.user).axs_get_addable_fields("res.partner")
        names = {f["name"] for f in fields}
        self.assertIn("ref", names)
        self.assertNotIn("image_1920", names)
        self.assertNotIn("child_ids", names)

    def test_duplicate_records(self):
        partners = self.env["res.partner"].create([{"name": "LVM A"}, {"name": "LVM B"}])
        new_ids = self.Layout.axs_duplicate_records("res.partner", partners.ids)
        self.assertEqual(len(new_ids), 2)
        self.assertEqual(len(self.env["res.partner"].browse(new_ids).exists()), 2)
        with self.assertRaises(UserError):
            self.Layout.axs_duplicate_records("res.partner", ["x"])

    def test_session_info_and_settings(self):
        settings = self.env["res.config.settings"]._axs_lvm_get_settings()
        self.assertTrue(settings["serial_number"])
        self.assertEqual(settings["excluded_models"], [])
        config = self.env["res.config.settings"].create({
            "axs_lvm_serial_number": False,
            "axs_lvm_excluded_model_ids": [(6, 0, self.env["ir.model"]._get("res.partner").ids)],
        })
        config.execute()
        settings = self.env["res.config.settings"]._axs_lvm_get_settings()
        self.assertFalse(settings["serial_number"])
        self.assertEqual(settings["excluded_models"], ["res.partner"])
