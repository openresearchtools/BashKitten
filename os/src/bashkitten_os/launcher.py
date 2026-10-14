# SPDX-License-Identifier: AGPL-3.0-only
# Search/pin/entry actions adapted from Gnozzard 59ca6d56 (GPL-3.0-or-later).
import subprocess
from .common import *
from gi.repository import Pango

class Launcher(Gtk.ApplicationWindow):
    def __init__(self, application):
        super().__init__(application=application, title='Applications')
        self.set_role('bashkitten-launcher')
        self.set_type_hint(Gdk.WindowTypeHint.UTILITY)
        self.set_skip_taskbar_hint(True); self.set_skip_pager_hint(True)
        self.set_icon_name('bashkitten-os')
        style(self)
        self.prefs = settings(); self.generation = 0; self.catalogue = []; self.dirty = True
        self.open_generation=0
        self.search_source = 0
        self.previous = None; self.icon_jobs=Gio.Cancellable()
        self.connect('delete-event', lambda *_: (self.close_menu(), True)[1])
        self.connect('key-press-event', self.key)
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin=12)
        self.add(outer)
        self.search = Gtk.SearchEntry(placeholder_text='Search applications')
        self.search.connect('search-changed', self.query_changed)
        scroll = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER)
        outer.pack_start(scroll, True, True, 0)
        self.rest = self.application_list(); scroll.add(self.rest)
        self.pinsection = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        outer.pack_start(self.pinsection, False, False, 0)
        self.divider = Gtk.Separator(); self.pinsection.pack_start(self.divider, False, False, 0)
        self.pinlabel = Gtk.Label(label='Pinned', xalign=0)
        self.pinsection.pack_start(self.pinlabel, False, False, 0)
        self.pinscroll = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER,
                                          propagate_natural_height=True, max_content_height=1)
        self.pinsection.pack_start(self.pinscroll, False, False, 0)
        self.pinned = self.application_list(); self.pinscroll.add(self.pinned)
        outer.pack_start(self.search, False, False, 0)
        outer.connect('size-allocate', self.size_pins)
        self.monitor = Gio.AppInfoMonitor.get()
        self.monitor.connect('changed', lambda *_: setattr(self, 'dirty', True))
        self.prefs.connect('changed::pins', lambda *_: self.render())

    def size_pins(self, outer, allocation):
        # GTK owns both scroll areas. Small pin lists keep their natural height;
        # only a long list reaches 60% of the space left above the fixed search.
        available=max(1,allocation.height-self.search.get_allocated_height()-2*outer.get_spacing())
        caption=self.pinlabel.get_allocated_height()+self.divider.get_allocated_height()+2*self.pinsection.get_spacing()
        limit=max(1,int(available*0.6)-caption)
        if self.pinscroll.get_max_content_height()!=limit:self.pinscroll.set_max_content_height(limit)

    def application_list(self):
        listing = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE, activate_on_single_click=False)
        listing.get_style_context().add_class('application-list')
        listing.connect('row-activated', lambda _, row: row.get_child().clicked())
        return listing

    def toggle(self):
        if self.get_visible(): self.close_menu(); return
        from .layout import Wnck
        self.previous=Wnck.Screen.get_default().get_active_window()
        self.generation += 1;self.open_generation+=1
        self.show_all(); self.maximize(); self.present(); self.search.grab_focus()
        if self.dirty:self.load_catalogue()
        else: self.render()

    def load_catalogue(self):
        generation = self.open_generation
        def load():
            apps = [app for app in Gio.AppInfo.get_all() if app.should_show() and app.get_id()]
            return sorted(apps, key=lambda a: a.get_display_name().casefold())
        def loaded(value, error):
            if generation != self.open_generation or not self.get_visible(): return
            if error: error_dialog(self, error); return
            self.catalogue = value; self.dirty = False; self.render()
        async_work(load, loaded)

    def close_menu(self):
        self.open_generation+=1
        self.generation += 1; self.icon_jobs.cancel(); self.icon_jobs=Gio.Cancellable(); self.hide(); self.search.set_text('')
        if self.search_source: GLib.source_remove(self.search_source); self.search_source = 0
        from .layout import Wnck
        if self.previous in Wnck.Screen.get_default().get_windows():
            self.previous.activate(Gtk.get_current_event_time())
        self.previous=None

    def key(self, _, event):
        if event.keyval == Gdk.KEY_Escape: self.close_menu(); return True
        return False

    def query_changed(self, *_):
        if self.search_source: GLib.source_remove(self.search_source)
        self.search_source = GLib.timeout_add(90, self.search_ready)

    def search_ready(self):
        self.search_source = 0; self.render(); return False

    def render(self):
        if not self.get_visible(): return
        self.generation += 1; self.icon_jobs.cancel(); self.icon_jobs=Gio.Cancellable(); generation = self.generation
        for listing in (self.pinned, self.rest):
            for child in listing.get_children(): child.destroy()
        query = self.search.get_text().casefold()
        pins = self.prefs.get_strv('pins'); by_id = {a.get_id(): a for a in self.catalogue}
        matches = lambda a: query in (a.get_display_name() + ' ' + (a.get_description() or '')).casefold()
        pinned = [by_id[p] for p in pins if p in by_id and matches(by_id[p])]
        rest = [a for a in self.catalogue if a.get_id() not in pins and matches(a)]
        self.pinsection.set_visible(bool(pinned))
        pending = iter([(self.pinned, a) for a in pinned] + [(self.rest, a) for a in rest])
        def batch():
            if generation != self.generation or not self.get_visible(): return False
            for _ in range(8):
                try: listing, app = next(pending)
                except StopIteration: return False
                listing.add(self.application_row(app)); listing.show_all()
            return True
        GLib.idle_add(batch)

    def application_row(self, app):
        button = Gtk.Button(); button.set_size_request(-1, 42)
        button.get_style_context().add_class('application-row')
        button.set_tooltip_text(app.get_display_name())
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        icon = Gtk.Image(); icon.set_size_request(24,24); box.pack_start(icon, False, False, 0)
        scale=self.get_scale_factor()
        info=Gtk.IconTheme.get_default().lookup_by_gicon_for_scale(app.get_icon() or Gio.ThemedIcon.new('application-x-executable'),24,scale,Gtk.IconLookupFlags.FORCE_SIZE)
        generation=self.generation
        if info:
            def loaded(source,result):
                try:
                    pixbuf=source.load_icon_finish(result)
                    if generation==self.generation and self.get_visible():
                        # The loaded pixels already include the requested scale.
                        # Keep their device scale so GTK does not multiply twice.
                        icon.set_from_surface(Gdk.cairo_surface_create_from_pixbuf(pixbuf,scale,None))
                except GLib.Error:pass
            info.load_icon_async(self.icon_jobs,loaded)
        label = Gtk.Label(label=app.get_display_name(), xalign=0, ellipsize=Pango.EllipsizeMode.END)
        box.pack_start(label, True, True, 0); button.add(box)
        button.connect('clicked', lambda *_: self.launch(app))
        button.connect('button-press-event', lambda _, event: self.menu(app, event) if event.button == 3 else False)
        return button

    def launch(self, app):
        self.close_menu()
        async_work(lambda: app.launch([], None), lambda _, e: error_dialog(self, e) if e else None)

    def helper(self, *args):
        def done(_,error):
            if error:error_dialog(self,error);return
            self.dirty=True
            if self.get_visible():self.load_catalogue()
        async_work(lambda: subprocess.run([str(PREFIX / 'bin/bashkitten-app'), *args], check=True),
                   done)

    def menu(self, app, event):
        menu = Gtk.Menu(); identity = app.get_id(); pins = self.prefs.get_strv('pins')
        style(menu)
        def item(title, callback):
            widget = Gtk.MenuItem(label=title); widget.connect('activate', lambda *_: callback())
            menu.append(widget)
        item('Open', lambda: self.launch(app))
        def pin():
            current = list(self.prefs.get_strv('pins'))
            if identity in current: current.remove(identity)
            else: current.append(identity)
            self.prefs.set_strv('pins', current)
        item('Unpin' if identity in pins else 'Pin', pin)
        if linux_guest():
            item('Add to Desktop', lambda: self.helper('app-to-desktop', identity))
            managed = identity.startswith('bashkitten-app-appimage-') or identity.startswith('bashkitten-app-launcher-')
            if managed:
                appimage = identity.startswith('bashkitten-app-appimage-')
                if appimage and isinstance(app, Gio.DesktopAppInfo):
                    path = app.get_string('X-AppImage-Path')
                    if path:
                        item('Extract and Run', lambda: self.helper('extract-and-run', path))
                        item('Extract and Run --no-sandbox', lambda: self.helper('extract-and-run-no-sandbox', path))
                kind = 'appimage' if appimage else 'desktop'
                item('Rename…', lambda: self.rename(app, kind))
                def remove():
                    def done(_, error):
                        if error: error_dialog(self, error); return
                        self.prefs.set_strv('pins', [p for p in self.prefs.get_strv('pins') if p != identity])
                        self.dirty = True
                        if self.get_visible():self.load_catalogue()
                    async_work(lambda: subprocess.run([str(PREFIX / 'bin/bashkitten-app'), 'remove-'+kind, identity], check=True), done)
                item('Delete from Applications', remove)
        menu.show_all(); menu.popup_at_pointer(event); return True

    def rename(self, app, kind):
        dialog = Gtk.Dialog(title='Rename application', transient_for=self, modal=False)
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL); dialog.add_button('Save', Gtk.ResponseType.OK)
        entry = Gtk.Entry(text=app.get_display_name(), margin=12)
        dialog.get_content_area().add(entry)
        def answer(view, response):
            if response == Gtk.ResponseType.OK: self.helper('rename-'+kind, app.get_id(), entry.get_text())
            view.destroy()
        dialog.connect('response', answer); dialog.show_all()
