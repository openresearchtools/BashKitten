# SPDX-License-Identifier: AGPL-3.0-only
from .common import *
from . import scaling

class Preferences(Gtk.ApplicationWindow):
    def __init__(self, application):
        super().__init__(application=application, title='BashKitten OS')
        self.set_default_size(480, 360)
        self.set_icon_name('bashkitten-os')
        style(self)
        self.prefs = settings()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18, margin=24)
        self.add(box)
        self.manage = self.toggle(box, 'Manage window size', 'manage-window-size')
        self.split = self.toggle(box, 'Two app mode', 'two-app-mode')
        def sensitivity(*_):
            self.split.set_sensitive(self.prefs.get_boolean('manage-window-size'))
        self.prefs.connect('changed::manage-window-size', sensitivity)
        sensitivity()
        row = Gtk.Box(spacing=12)
        row.pack_start(Gtk.Label(label='Application appearance', xalign=0), True, True, 0)
        choice = Gtk.ComboBoxText()
        for key, title in [('dark', 'Dark'), ('light', 'Light')]: choice.append(key, title)
        choice.set_active_id(self.prefs.get_string('color-scheme'))
        choice.connect('changed', lambda c: self.prefs.set_string('color-scheme', c.get_active_id()))
        row.pack_end(choice, False, False, 0); box.pack_start(row, False, False, 0)
        row = Gtk.Box(spacing=12)
        row.pack_start(Gtk.Label(label='Desktop scaling', xalign=0), True, True, 0)
        scale = Gtk.ComboBoxText()
        for value in scaling.SUPPORTED_SCALES: scale.append(value, f'{float(value)*100:g}%')
        scale.set_active_id(self.prefs.get_string('scale'))
        scale.connect('changed', self.apply_scale)
        row.pack_end(scale, False, False, 0); box.pack_start(row, False, False, 0)
        note = Gtk.Label(label='Applications that cache scaling may need to be reopened.', wrap=True, xalign=0)
        note.get_style_context().add_class('dim-label'); box.pack_start(note, False, False, 0)
        self.show_all()

    def toggle(self, box, label, key):
        row = Gtk.Box(spacing=12)
        row.pack_start(Gtk.Label(label=label, xalign=0), True, True, 0)
        switch = Gtk.Switch()
        self.prefs.bind(key, switch, 'active', Gio.SettingsBindFlags.DEFAULT)
        row.pack_end(switch, False, False, 0); box.pack_start(row, False, False, 0)
        return switch

    def apply_scale(self, combo):
        value = combo.get_active_id()
        combo.set_sensitive(False)
        def done(_, error):
            combo.set_sensitive(True)
            if error:
                error_dialog(self, error)
                combo.handler_block_by_func(self.apply_scale)
                combo.set_active_id(self.prefs.get_string('scale'))
                combo.handler_unblock_by_func(self.apply_scale)
        async_work(lambda: scaling.apply_scale(value), done)
