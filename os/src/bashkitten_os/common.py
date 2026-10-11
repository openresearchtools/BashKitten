# SPDX-License-Identifier: AGPL-3.0-only
import concurrent.futures
import os
from pathlib import Path
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gio, GLib, Gtk, Gdk

PREFIX = Path(__file__).resolve().parents[3]
SHARE = PREFIX / 'share/bashkitten-os'
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix='bashkitten-os')
SCHEMA = 'org.bashkitten.OS'

def settings():
    return Gio.Settings.new(SCHEMA)

def async_work(work, done=None):
    future = POOL.submit(work)
    def finished(result):
        try:
            value, error = result.result(), None
        except Exception as exc:
            value, error = None, exc
        if done:
            GLib.idle_add(lambda: (done(value, error), False)[1])
    future.add_done_callback(finished)
    return future

def error_dialog(parent, message):
    dialog = Gtk.MessageDialog(transient_for=parent, modal=False, message_type=Gtk.MessageType.ERROR,
                               buttons=Gtk.ButtonsType.CLOSE, text=str(message))
    dialog.connect('response', lambda view, _: view.destroy())
    dialog.show()

def style(widget):
    provider = Gtk.CssProvider()
    provider.load_from_path(str(SHARE / 'style.css'))
    Gtk.StyleContext.add_provider_for_screen(widget.get_screen(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    widget.get_style_context().add_class('bashkitten-os')

def linux_guest():
    return os.environ.get('BASHKITTEN_EXECUTION_ROLE') == 'container'

def owned_session():
    if os.environ.get('BASHKITTEN_EXECUTION_ROLE') not in {'container', 'termux'}:
        raise RuntimeError('BashKitten OS requires its owning container or Termux desktop session')
    if not os.environ.get('DISPLAY') or not os.environ.get('DBUS_SESSION_BUS_ADDRESS'):
        raise RuntimeError('The owning X11 desktop and session bus are unavailable')
