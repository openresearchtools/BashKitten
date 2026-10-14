# SPDX-License-Identifier: AGPL-3.0-only
import json, os, subprocess, uuid, atexit
from .common import *

PORTAL_XML = '''<node><interface name="org.freedesktop.impl.portal.Settings">
 <property name="version" type="u" access="read"/>
 <method name="Read"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
 <method name="ReadAll"><arg type="as" direction="in"/><arg type="a{sa{sv}}" direction="out"/></method>
 <signal name="SettingChanged"><arg type="s"/><arg type="s"/><arg type="v"/></signal>
</interface></node>'''

class Session:
    def __init__(self, application):
        owned_session(); self.application=application; self.prefs=settings()
        self.color_epoch=0; self.appearance_running=False
        self.bus=None;self.registration=None;self.bus_name=None;self.context_generation=None
        async_work(self.publish_context,lambda _,e:error_dialog(None,e) if e else None)
        Gio.bus_get(Gio.BusType.SESSION,None,self.bus_ready)
        self.prefs.connect('changed::color-scheme',self.appearance)
        self.wallpaper_pending=False;self.wallpaper_again=False;self.wallpaper_area=None
        self.wallpaper()
        Gdk.Screen.get_default().connect('size-changed',lambda *_:self.wallpaper())
        Gdk.Screen.get_default().connect('monitors-changed',lambda *_:self.wallpaper())
        self.tray=None
        if linux_guest(): self.tray=GuestIndicator()

    def publish_context(self):
        if os.environ.get('BASHKITTEN_EXECUTION_ROLE')!='termux':return
        path=os.environ.get('BASHKITTEN_DESKTOP_CONTEXT')
        if not path:raise RuntimeError('Termux desktop owner did not provide its context path')
        self.context_generation=str(uuid.uuid4());target=Path(path)
        data={'generation':self.context_generation,'ownerPid':os.getpid(),
              'ownerStartTime':Path('/proc/self/stat').read_text().rsplit(') ',1)[1].split()[19],
              'environment':{key:os.environ[key] for key in ('DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','AT_SPI_BUS_ADDRESS','SESSION_MANAGER',
                  'XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR') if os.environ.get(key)}}
        from .defaults import atomic
        atomic(target,json.dumps(data)+'\n');target.chmod(0o600)
        atexit.register(self.clear_context)

    def clear_context(self):
        if not self.context_generation:return
        target=Path(os.environ['BASHKITTEN_DESKTOP_CONTEXT'])
        try:
            if json.loads(target.read_text()).get('generation')==self.context_generation:target.unlink()
        except (OSError,ValueError):pass

    def bus_ready(self,source,result):
        try:
            self.bus=Gio.bus_get_finish(result)
            self.registration=self.bus.register_object('/org/freedesktop/portal/desktop',
                Gio.DBusNodeInfo.new_for_xml(PORTAL_XML).interfaces[0],self.portal,
                lambda *args:GLib.Variant('u',1),None)
            self.bus_name=Gio.bus_own_name_on_connection(self.bus,'org.freedesktop.impl.portal.desktop.bashkitten',Gio.BusNameOwnerFlags.NONE,None,None)
            self.appearance()
        except Exception as error:error_dialog(None,error)

    def value(self):return GLib.Variant('u',1 if self.prefs.get_string('color-scheme')=='dark' else 2)
    def portal(self,connection,sender,path,interface,method,parameters,invocation):
        namespace='org.freedesktop.appearance'
        if method=='Read':
            ns,key=parameters.unpack()
            if ns!=namespace or key!='color-scheme':
                invocation.return_dbus_error('org.freedesktop.portal.Error.NotFound','Unknown setting');return
            invocation.return_value(GLib.Variant('(v)',(self.value(),)))
        else:
            filters=parameters.unpack()[0]
            import fnmatch
            values={namespace:{'color-scheme':self.value()}} if not filters or any(fnmatch.fnmatchcase(namespace,f) for f in filters) else {}
            invocation.return_value(GLib.Variant('(a{sa{sv}})',(values,)))

    def appearance(self,*_):
        self.color_epoch+=1
        if not self.bus:return
        self.bus.emit_signal(None,'/org/freedesktop/portal/desktop','org.freedesktop.impl.portal.Settings',
                             'SettingChanged',GLib.Variant('(ssv)',('org.freedesktop.appearance','color-scheme',self.value())))
        if self.appearance_running:return
        self.appearance_running=True
        def apply():
            # Coalesce rapid changes; a stale worker cannot leave an older theme selected.
            while True:
                epoch=self.color_epoch; dark=self.prefs.get_string('color-scheme')=='dark'
                from .scaling import XfconfSetting,xfconf_get,xfconf_set_if_needed
                env=os.environ.copy();theme=XfconfSetting('xsettings','/Net/ThemeName','string')
                # Preserve a user-selected custom theme; advertise preference independently.
                if xfconf_get(theme,env) in (None,'Adwaita','Adwaita-dark'):
                    xfconf_set_if_needed(theme,'Adwaita-dark' if dark else 'Adwaita',env)
                xfconf_set_if_needed(XfconfSetting('xsettings','/Gtk/ApplicationPreferDarkTheme','bool'),'true' if dark else 'false',env)
                source=Gio.SettingsSchemaSource.get_default()
                if source.lookup('org.gnome.desktop.interface',True):
                    Gio.Settings.new('org.gnome.desktop.interface').set_string('color-scheme','prefer-dark' if dark else 'prefer-light')
                if epoch==self.color_epoch:return
        def done(_,error):
            self.appearance_running=False
            if error:error_dialog(None,error)
        async_work(apply,done)

    def wallpaper_workarea(self,line):
        # The existing X11 property watcher supplies physical pixels without a
        # synchronous X request on GTK. Our default belongs to workspace zero.
        try:area=tuple(map(int,bytes(line).partition(b'=')[2].split(b',')))[:4]
        except ValueError:return
        if len(area)!=4 or area[2]<=0 or area[3]<=0 or area==self.wallpaper_area:return
        self.wallpaper_area=area;self.wallpaper()

    def wallpaper(self):
        if self.wallpaper_area is None:return
        if self.wallpaper_pending:self.wallpaper_again=True;return
        self.wallpaper_pending=True
        monitor=Gdk.Display.get_default().get_monitor(0); rect=monitor.get_geometry(); scale=monitor.get_scale_factor()
        size=rect.width*scale,rect.height*scale
        x,y,width,height=self.wallpaper_area
        workarea=x-rect.x*scale,y-rect.y*scale,width,height
        def done(_,error):
            self.wallpaper_pending=False
            if error: print('BashKitten default wallpaper:',error, file=__import__('sys').stderr)
            if self.wallpaper_again:
                self.wallpaper_again=False;self.wallpaper()
        from .defaults import update_wallpaper
        async_work(lambda:update_wallpaper(size,workarea),done)

class GuestIndicator:
    def __init__(self):
        self.command=str(PREFIX/'lib/bashkitten/machines/bin/bashkitten-guest-action')
        self.icon=Gtk.StatusIcon.new_from_icon_name('bashkitten-os')
        self.icon.set_visible(True);self.icon.set_tooltip_text('BashKitten — checking service')
        self.icon.connect('activate',lambda *_:self.action('open'))
        self.icon.connect('popup-menu',self.menu)
        self.running=None;self.loading=False
        path=os.environ.get('BASHKITTEN_GUEST_STATUS_FILE')
        self.monitor=None;self.control_monitor=None
        control=Path(os.environ.get('BASHKITTEN_DATA_DIR',Path.home()/'.local/share/bashkitten-pi'))/'control.json'
        self.control_monitor=Gio.File.new_for_path(str(control)).monitor_file(Gio.FileMonitorFlags.NONE,None)
        self.control_monitor.connect('changed',lambda *_:self.refresh())
        if path:
            self.monitor=Gio.File.new_for_path(path).monitor_file(Gio.FileMonitorFlags.NONE,None)
            self.monitor.connect('changed',lambda *_:self.read_status_file(path))
        self.refresh()
    def update_status(self,result):
        self.running=result.get('running')
        self.icon.set_tooltip_text('BashKitten — '+('running' if self.running is True else 'stopped' if self.running is False else 'service unavailable'))
    def read_status_file(self,path):
        async_work(lambda:json.loads(Path(path).read_text()),
                   lambda result,error:self.update_status(result if not error else {}))
    def action(self,action):
        def run():
            return json.loads(subprocess.run([self.command,action],capture_output=True,text=True,check=True,timeout=15).stdout)
        def done(result,error):
            self.loading=False
            if error:
                self.running=None;self.icon.set_tooltip_text('BashKitten — service unavailable')
                if action!='status':error_dialog(None,error)
                return
            if action=='status':
                self.update_status(result)
            else:self.refresh()
        async_work(run,done)
    def refresh(self):
        if not self.loading:self.loading=True;self.action('status')
    def menu(self,_,button,time):
        self.refresh();menu=Gtk.Menu()
        for title,action in [('Open','open'),('Stop BashKitten','stop')]:
            item=Gtk.MenuItem(label=title);item.connect('activate',lambda _,a=action:self.action(a))
            if action=='stop':item.set_sensitive(self.running is True)
            menu.append(item)
        menu.show_all();menu.popup(None,None,Gtk.StatusIcon.position_menu,self.icon,button,time)
