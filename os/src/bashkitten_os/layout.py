# SPDX-License-Identifier: AGPL-3.0-only
# Normal/transient eligibility follows Gnozzard 59ca6d56 (GPL-3.0-or-later).
# Xfwm remains the WM; requests never replace its modal/size-hint handling.
from .common import *
gi.require_version('Wnck', '3.0')
from gi.repository import Wnck

def native_hints(xids):
    import subprocess, json, sys
    result=subprocess.run([sys.executable, str(Path(__file__).with_name('window_hints.py')), *map(str,xids)],
                          check=True,capture_output=True,text=True,timeout=4)
    return {int(key):value for key,value in json.loads(result.stdout).items()}

class Layout:
    def __init__(self, application):
        self.app=application; self.prefs=settings(); self.screen=Wnck.Screen.get_default()
        self.pair=None; self.hints={}; self.ratio=.5
        self.loading=set(); self.epoch=0; self.pending=0; self.divider=None; self.targets={}; self.dragging=False
        self.workarea_watch=None;self.workarea_cancel=None
        self.screen.connect('window-opened', self.opened)
        self.screen.connect('window-closed', self.closed)
        self.screen.connect('active-window-changed', self.activated)
        self.screen.connect('viewports-changed', lambda *_: self.queue())
        self.screen.connect('active-workspace-changed', lambda *_: self.release(False))
        Gdk.Screen.get_default().connect('size-changed', lambda *_: self.queue())
        Gdk.Screen.get_default().connect('monitors-changed', lambda *_: self.queue())
        self.prefs.connect('changed::manage-window-size', self.policy)
        self.prefs.connect('changed::two-app-mode', self.policy)
        self.prefs.connect('changed::scale', lambda *_:self.queue())
        for window in self.screen.get_windows(): self.watch(window)
        self.watch_workarea()
        self.activated()

    def watch_workarea(self):
        if self.workarea_cancel:self.workarea_cancel.cancel();self.workarea_cancel=None
        if self.workarea_watch:self.workarea_watch.force_exit();self.workarea_watch=None
        if not self.managed():return
        # xprop is the stock X11 event client: no polling or X round-trip on GTK.
        self.workarea_watch=Gio.Subprocess.new(['xprop','-spy','-root','_NET_WORKAREA'],Gio.SubprocessFlags.STDOUT_PIPE)
        stream=Gio.DataInputStream.new(self.workarea_watch.get_stdout_pipe())
        cancel=Gio.Cancellable();self.workarea_cancel=cancel
        def changed(source,result):
            try:line,_=source.read_line_finish(result)
            except GLib.Error:return
            if line is None or cancel.is_cancelled():return
            self.queue()
            source.read_line_async(GLib.PRIORITY_DEFAULT,cancel,changed)
        stream.read_line_async(GLib.PRIORITY_DEFAULT,cancel,changed)

    def close(self):
        if self.workarea_cancel:self.workarea_cancel.cancel()
        if self.workarea_watch:self.workarea_watch.force_exit()
        self.release(False)

    def managed(self): return self.prefs.get_boolean('manage-window-size')
    def eligible(self, window):
        return bool(window and window.get_window_type()==Wnck.WindowType.NORMAL
            and not window.get_transient() and not window.is_skip_tasklist()
            and not window.is_pinned() and not window.is_minimized() and not window.is_fullscreen()
            and window.get_xid() in self.hints and not self.hints[window.get_xid()]["modal"]
            and (self.hints[window.get_xid()]["minw"] < self.hints[window.get_xid()]["maxw"] or self.hints[window.get_xid()]["minh"] < self.hints[window.get_xid()]["maxh"])
            and (window.get_actions() & Wnck.WindowActions.RESIZE
                 or window.is_maximized() and window.get_actions() & Wnck.WindowActions.UNMAXIMIZE))

    def refresh_hints(self,window):
        xid=window.get_xid()
        if not self.managed() or xid in self.loading:return
        self.loading.add(xid);epoch=self.epoch
        def ready(result,error):
            self.loading.discard(xid)
            if error or window not in self.screen.get_windows():return
            if epoch!=self.epoch:
                if self.managed():self.refresh_hints(window)
                return
            self.hints.update(result)
            self.changed(window)
        async_work(lambda:native_hints([xid]),ready)

    def watch(self, window):
        self.refresh_hints(window)
        window.connect('state-changed', lambda *_: (self.changed(window),self.refresh_hints(window)))
        window.connect('geometry-changed', lambda *_: self.geometry(window))
        window.connect('actions-changed', lambda *_: self.refresh_hints(window))
    def opened(self, _, window): self.watch(window); self.changed(window)
    def changed(self, window):
        if self.pair and window in self.pair and not self.eligible(window): self.release(self.managed())
        elif self.managed() and self.eligible(window): self.queue()
    def closed(self, _, window):
        if self.pair and window in self.pair:
            survivor=next((w for w in self.pair if w!=window),None)
            self.release(False)
            if self.managed() and self.eligible(survivor): survivor.maximize()

    def activated(self, *_):
        window=self.screen.get_active_window()
        if not self.managed() or not self.eligible(window): return
        if self.pair and window not in self.pair: self.release(False)
        self.queue()

    def policy(self, *_):
        self.epoch+=1
        if self.pending: GLib.source_remove(self.pending); self.pending=0
        self.release(self.managed())
        self.watch_workarea()
        if self.managed():
            for window in self.screen.get_windows():self.refresh_hints(window)
            self.queue()

    def release(self, maximize):
        pair=self.pair; self.pair=None; self.targets={}; self.epoch+=1
        if self.pending:GLib.source_remove(self.pending);self.pending=0
        if self.divider: self.divider.destroy(); self.divider=None
        self.dragging=False
        if maximize and pair:
            current=self.screen.get_active_window()
            survivor=current if current in pair else next((w for w in pair if self.eligible(w)),None)
            if self.eligible(survivor): survivor.maximize()

    def split(self, first, second):
        if not self.managed() or not self.prefs.get_boolean('two-app-mode'):
            raise RuntimeError('Enable Manage window size and Two app mode first')
        by_id={w.get_xid():w for w in self.screen.get_windows()}
        pair=[by_id.get(first),by_id.get(second)]
        seen=set()
        while pair[0] and pair[0].get_transient() and pair[0].get_xid() not in seen:
            seen.add(pair[0].get_xid());pair[0]=pair[0].get_transient()
        if pair[0]:first=pair[0].get_xid()
        if first==second or not all(self.eligible(w) for w in pair):
            raise RuntimeError('Choose two different resizable main windows')
        if pair[0].get_workspace()!=pair[1].get_workspace():
            raise RuntimeError('Both windows must be on the same workplace')
        epoch=self.epoch
        def ready(hints,error):
            if epoch!=self.epoch or not self.managed(): return
            if error: error_dialog(None,error); return
            self.hints.update(hints)
            if not all(self.eligible(w) and w in self.screen.get_windows() for w in pair): return
            rectangles=self.rectangles(pair)
            if rectangles is None:
                error_dialog(None,'These applications’ minimum sizes do not fit this display.'); return
            self.release(False); self.pair=pair; self.make_divider()
            for window in pair: window.unmaximize()
            pair[1].activate(Gtk.get_current_event_time())
            self.queue()
        async_work(lambda:native_hints([first,second]),ready)

    def workarea(self):
        display=Gdk.Display.get_default(); monitor=display.get_monitor(0)
        # Rootful display represents the tab; monitor workarea includes panel struts.
        rect=monitor.get_workarea()
        scale=monitor.get_scale_factor()
        return tuple(value*scale for value in (rect.x,rect.y,rect.width,rect.height))

    def rectangles(self,pair):
        x,y,width,height=self.workarea(); gap=6; usable=width-gap
        limits=[]
        for window in pair:
            hint=self.hints[window.get_xid()]; frame=window.get_geometry(); client=window.get_client_window_geometry()
            border=(frame[2]-client[2],frame[3]-client[3])
            limits.append((hint,border))
        low=limits[0][0]['minw']+limits[0][1][0]
        high=usable-limits[1][0]['minw']-limits[1][1][0]
        if low>high or any(h['minh']+b[1]>height for h,b in limits): return None
        left=max(low,min(high,round(usable*self.ratio)))
        result=[]
        for index,(hint,border) in enumerate(limits):
            desired=left if index==0 else usable-left
            cw=min(desired-border[0],hint['maxw']); ch=min(height-border[1],hint['maxh'])
            cw=hint['basew']+((cw-hint['basew'])//hint['incw'])*hint['incw']
            ch=hint['baseh']+((ch-hint['baseh'])//hint['inch'])*hint['inch']
            if cw<hint['minw'] or ch<hint['minh']: return None
            result.append((x if index==0 else x+left+gap,y,cw+border[0],ch+border[1]))
        return result,(x+left,y,gap,height)

    def queue(self):
        if not self.managed() or self.pending:return
        epoch=self.epoch
        def apply():
            self.pending=0
            if epoch!=self.epoch or not self.managed():return False
            if self.pair:
                if not all(self.eligible(w) for w in self.pair):self.release(True);return False
                plan=self.rectangles(self.pair)
                if plan is None:
                    self.release(True); error_dialog(None,'The resized display is too small for both applications.'); return False
                rectangles,divider=plan
                for window,geometry in zip(self.pair,rectangles):
                    self.targets[window.get_xid()]=geometry
                    window.set_geometry(Wnck.WindowGravity.STATIC,Wnck.WindowMoveResizeMask.X|Wnck.WindowMoveResizeMask.Y|
                        Wnck.WindowMoveResizeMask.WIDTH|Wnck.WindowMoveResizeMask.HEIGHT,*geometry)
                scale=Gdk.Display.get_default().get_monitor(0).get_scale_factor()
                self.divider.move(divider[0]//scale,divider[1]//scale);self.divider.resize(max(1,divider[2]//scale),divider[3]//scale);self.divider.show_all()
                requested=dict(self.targets);generation=self.epoch
                def verify():
                    if generation!=self.epoch or not self.pair or self.dragging:return False
                    failed=[w for w in self.pair if self.targets.get(w.get_xid())==requested.get(w.get_xid()) and tuple(w.get_geometry())!=requested.get(w.get_xid())]
                    if failed:
                        self.release(True)
                        error_dialog(None,'The applications did not accept the requested split size. Their normal window constraints remain in effect.')
                    return False
                GLib.timeout_add(1500,verify)
            else:
                window=self.screen.get_active_window()
                if self.eligible(window) and not window.is_maximized():window.maximize()
            return False
        self.pending=GLib.timeout_add(16,apply)

    def geometry(self,window):
        # Geometry notifications acknowledge the request; no unconditional resize loop.
        target=self.targets.get(window.get_xid())
        if target and tuple(window.get_geometry())==target:self.targets.pop(window.get_xid(),None)

    def make_divider(self):
        view=Gtk.Window(type=Gtk.WindowType.TOPLEVEL);self.divider=view
        view.set_decorated(False);view.set_skip_taskbar_hint(True);view.set_skip_pager_hint(True)
        # The reserved gap keeps this visible in the normal window layer. An
        # always-above hint would put the divider over Xfwm's transient dialogs.
        view.set_type_hint(Gdk.WindowTypeHint.UTILITY);view.set_accept_focus(False)
        view.get_style_context().add_class('bashkitten-divider');style(view)
        view.add_events(Gdk.EventMask.BUTTON_PRESS_MASK|Gdk.EventMask.BUTTON_RELEASE_MASK|Gdk.EventMask.POINTER_MOTION_MASK)
        def press(_,event):
            if event.button==1:self.dragging=True;view.grab_add();return True
            return False
        def release(*_):
            if self.dragging:view.grab_remove()
            self.dragging=False;return True
        def motion(_,event):
            if self.dragging and self.pair:
                x,_,width,_=self.workarea();self.ratio=(event.x_root*Gdk.Display.get_default().get_monitor(0).get_scale_factor()-x)/max(1,width-6);self.queue()
            return True
        view.connect('button-press-event',press);view.connect('button-release-event',release)
        view.connect('motion-notify-event',motion);view.connect('grab-broken-event',release)
