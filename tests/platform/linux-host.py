#!/usr/bin/env python3
"""Run twice against an isolated profile under a real X11 or Wayland display.

First run: signup; second run: persistent cookie restoration. Uses system WebKit.
"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import subprocess

ROOT = Path(__file__).resolve().parents[2]
host_path = Path('/usr/lib/bashkitten/src/linux/host.py') if os.environ.get('BASHKITTEN_TEST_INSTALLED') else ROOT / 'src/linux/host.py'
spec = importlib.util.spec_from_file_location('bashkitten_host', host_path)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
from gi.repository import GLib, WebKit

app = host.BashKitten()
app.register(None)
app.activate()

def pump():
    while GLib.MainContext.default().pending():
        GLib.MainContext.default().iteration(False)
    time.sleep(0.02)

def until(test, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = test()
        if value:
            return value
        pump()
    raise AssertionError('Timed out waiting for WebKit: ' + app.state_label.get_text())

def js(script):
    result = []
    def done(web, value):
        try:
            result.append((True, web.evaluate_javascript_finish(value).to_json(0)))
        except GLib.Error as error:
            result.append((False, error.message))
    app.web.evaluate_javascript(script, -1, None, None, None, done)
    until(lambda: result)
    ok, value = result[0]
    assert ok, value
    return json.loads(value) if value else None

try:
    until(lambda: app.origin and app.web.get_uri() == app.origin + '/' and not app.web.is_loading())
    until(lambda: js('Boolean(document.querySelector("#authForm"))'))
    assert js('window.bashkittenHost.platform') == 'linux'
    if sys.argv[-1] == 'signup':
        until(lambda: js('!document.querySelector("#auth").classList.contains("hidden")'))
        js("document.querySelector('#username').value='desktop-test';document.querySelector('#password').value='desktop-test-password';document.querySelector('#authForm').requestSubmit();true")
    until(lambda: js('!document.querySelector("#app").classList.contains("hidden")'))
    assert js('document.querySelector("#filesToggle").title') == 'Open project folder'
    assert js('document.querySelector("#filePanel").classList.contains("hidden")')
    # Native methods reject synthetic calls; a presentation flag cannot grant control.
    js("window.nativeResult='pending';window.bashkittenHost.call('open-file',{folder:'~'}).then(()=>window.nativeResult='opened',e=>window.nativeResult=e.message);true")
    until(lambda: js("window.nativeResult !== 'pending'"))
    assert js('window.nativeResult') == 'Use a native action button', js('window.nativeResult')
    # A script handler message without the private main-frame capability is ignored.
    js("window.webkit.messageHandlers.bashkitten.postMessage(JSON.stringify({id:'wrong',nonce:'wrong',action:'choose-folder'}));true")
    if os.environ.get('GDK_BACKEND') == 'x11':
        from gi.repository import Gtk
        bounds = app.web.compute_bounds(app.window)[1]
        button = js("(()=>{const r=document.querySelector('#folderBtn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
        xid = app.window.get_surface().get_xid()
        js("document.addEventListener('click',e=>window.clicked={id:e.target.id,trusted:e.isTrusted,x:e.clientX,y:e.clientY},true);true")
        subprocess.run(['xdotool','windowfocus','--sync',str(xid)],check=True)
        for _ in range(15): pump()
        subprocess.run(['xdotool', 'mousemove', '--window', str(xid), str(int(bounds.get_x()+button['x']+app.window.get_surface_transform()[0])), str(int(bounds.get_y()+button['y']+app.window.get_surface_transform()[1])), 'sleep', '0.3', 'click', '1'], check=True)
        try:
            chooser = until(lambda: next((w for w in Gtk.Window.list_toplevels() if w.get_title() == 'Working folder'), None), 8)
        except AssertionError:
            print('Chooser diagnostic:', [w.get_title() for w in Gtk.Window.list_toplevels()], 'click', button, bounds.get_x(), bounds.get_y(), 'hint', js('document.querySelector("#composerHint").textContent'), 'active', js('document.activeElement.outerHTML'), 'clicked', js('window.clicked || null'))
            subprocess.run(['magick','import','-window',str(xid),str(ROOT/'test-results/linux/chooser-diagnostic.png')])
            raise
        chooser.close()
        for _ in range(10): pump()
        print('PASS: a real pointer click opens the system working-folder chooser')
    output = ROOT / 'test-results/linux'
    output.mkdir(parents=True, exist_ok=True)
    captured = []
    def snapshot(web, result):
        web.get_snapshot_finish(result).save_to_png(str(output / ('host-' + sys.argv[-1] + '.png')))
        captured.append(True)
    app.web.get_snapshot(WebKit.SnapshotRegion.VISIBLE, WebKit.SnapshotOptions.NONE, None, snapshot)
    until(lambda: captured)
    print('PASS: native WebKit login, host capabilities, bridge rejection, screenshot (' + sys.argv[-1] + ', ' + type(app.window.get_surface()).__name__ + ')')
finally:
    app.window.close()
    app.quit()
    for _ in range(20):
        pump()
