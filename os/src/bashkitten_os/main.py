# SPDX-License-Identifier: AGPL-3.0-only
import os, sys, signal
from .common import *

class Desktop(Gtk.Application):
    def __init__(self):
        super().__init__(application_id='org.bashkitten.OS',flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.launcher=None;self.preferences=None;self.session=None;self.layout=None
    def do_startup(self):
        Gtk.Application.do_startup(self)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,signal.SIGTERM,lambda:(self.quit(),False)[1])
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,signal.SIGINT,lambda:(self.quit(),False)[1])
        for name in ('launcher','settings','session'):
            action=Gio.SimpleAction.new(name,None)
            action.connect('activate',lambda _,p,n=name:self.perform(n))
            self.add_action(action)
        action=Gio.SimpleAction.new('split',GLib.VariantType.new('as'))
        action.connect('activate',lambda _,p:self.split(p.unpack()))
        self.add_action(action)
    def do_shutdown(self):
        if self.layout:self.layout.close()
        if self.session:self.session.clear_context()
        Gtk.Application.do_shutdown(self)
    def perform(self,name):
        try:
            owned_session()
            if name=='session':
                if not self.session:
                    from .session import Session
                    from .layout import Layout
                    self.session=Session(self);self.layout=Layout(self);self.hold()
            elif name=='launcher':
                from .launcher import Launcher
                if not self.launcher:self.launcher=Launcher(self)
                self.launcher.toggle()
            elif name=='settings':
                from .preferences import Preferences
                if not self.preferences:
                    self.preferences=Preferences(self)
                    self.preferences.connect('destroy',lambda *_:setattr(self,'preferences',None))
                self.preferences.present()
        except Exception as error:error_dialog(None,error)
    def split(self,arguments):
        try:
            if not self.layout:raise RuntimeError('BashKitten desktop session is not running')
            self.layout.split(*[int(x) for x in arguments])
        except Exception as error:error_dialog(None,error)
    def do_command_line(self,command):
        arguments=command.get_arguments()[1:]
        if not arguments:arguments=['settings']
        if arguments[0]=='split':self.split(arguments[1:])
        elif arguments[0] in ('session','settings','launcher'):self.perform(arguments[0])
        else:command.printerr('Unknown BashKitten OS command\n');return 2
        return 0

def main():
    # XFCE discovers the package's autostart entry in standalone sessions too.
    if sys.argv[1:]==['session'] and os.environ.get('BASHKITTEN_EXECUTION_ROLE') not in {'container','termux'}:
        return 0
    if sys.argv[1:]==['initialize']:
        from .defaults import initialize
        initialize();return 0
    return Desktop().run(sys.argv)
if __name__=='__main__':sys.exit(main())
