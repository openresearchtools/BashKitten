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
import tempfile

# Exercise the real desktop launchers without changing the user's default apps.
launch_environment = None
if os.environ.get('BASHKITTEN_TEST_NATIVE_FILES') == '1':
    launch_environment = tempfile.TemporaryDirectory(prefix='bashkitten-launch-test-')
    launch_root = Path(launch_environment.name)
    os.environ['XDG_CONFIG_HOME'] = str(launch_root / 'config')
    os.environ['XDG_DATA_HOME'] = str(launch_root / 'data')
    applications = launch_root / 'data/applications'
    applications.mkdir(parents=True)
    launches = launch_root / 'launched.jsonl'
    recorder = launch_root / 'record.py'
    recorder.write_text('import json,sys\nwith open(' + repr(str(launches)) + ", 'a') as output: output.write(json.dumps(sys.argv[1:])+'\\n')\n")
    desktop = applications / 'bashkitten-launch-test.desktop'
    desktop.write_text('[Desktop Entry]\nType=Application\nName=BashKitten launcher fixture\nExec=python3 ' + str(recorder) + ' %U\nNoDisplay=true\n')

ROOT = Path(__file__).resolve().parents[2]
host_path = Path('/usr/lib/bashkitten/src/linux/host.py') if os.environ.get('BASHKITTEN_TEST_INSTALLED') else ROOT / 'src/linux/host.py'
spec = importlib.util.spec_from_file_location('bashkitten_host', host_path)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
from gi.repository import GLib, WebKit
if launch_environment:
    from gi.repository import Gio
    launcher = Gio.DesktopAppInfo.new_from_filename(str(desktop))
    for mime in ['text/plain', 'inode/directory', 'x-scheme-handler/https']:
        assert launcher.set_as_default_for_type(mime)

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

def js(script, target=None):
    result = []
    def done(web, value):
        try:
            result.append((True, web.evaluate_javascript_finish(value).to_json(0)))
        except GLib.Error as error:
            result.append((False, error.message))
    (target or app.web).evaluate_javascript(script, -1, None, None, None, done)
    until(lambda: result)
    ok, value = result[0]
    assert ok, value
    return json.loads(value) if value else None

try:
    until(lambda: app.origin and (app.web.get_uri() or '').split('#')[0] == app.origin + '/' and not app.web.is_loading())
    until(lambda: js('Boolean(document.querySelector("#authForm"))'))
    assert js('window.bashkittenHost.platform') == 'linux'
    if sys.argv[-1] == 'signup':
        until(lambda: js('!document.querySelector("#auth").classList.contains("hidden")'))
        js("document.querySelector('#username').value='desktop-test';document.querySelector('#password').value='desktop-test-password';document.querySelector('#authForm').requestSubmit();true")
    until(lambda: js('!document.querySelector("#app").classList.contains("hidden")'))
    assert js('document.querySelector("#filesToggle").title') == 'Open project folder'
    assert js('document.querySelector("#filePanel").classList.contains("hidden")')
    # A second notification changes the fragment of an already-open app.
    js("""window.linkFixture=null; (async()=>{
      const {csrf}=await (await fetch('/api/bootstrap')).json();
      const ids=[];
      for(const title of ['Session link one','Session link two']) {
        const body=new FormData(); body.set('title',title);
        const response=await fetch('/api/sessions',{method:'POST',headers:{'x-bashkitten-csrf':csrf},body});
        if(!response.ok) throw Error(await response.text()); ids.push((await response.json()).id);
      }
      window.linkFixture={ids,csrf};
    })().catch(e=>window.linkFixture={error:e.message}); true""")
    links = until(lambda: js('window.linkFixture'))
    assert 'error' not in links, links
    for index, session_id in enumerate(links['ids']):
        app.web.load_uri(app.origin + '/#session=' + session_id)
        until(lambda: js('document.querySelector("#title").textContent') == ['Session link one', 'Session link two'][index])
        until(lambda: js('document.querySelector(".session.active")?.dataset.id') == session_id)
        assert js('Boolean(window.linkFixture)'), 'Session links must not reload the document'
    js('document.querySelector(' + json.dumps('[data-id="' + links['ids'][0] + '"]') + ').click();true')
    until(lambda: app.web.get_uri().endswith('#session=' + links['ids'][0]))
    print('PASS: hot session links switch the displayed conversation and sidebar clicks update the link')
    # Native methods reject synthetic calls; a presentation flag cannot grant control.
    js("window.nativeResult='pending';window.bashkittenHost.call('open-file',{folder:'~'}).then(()=>window.nativeResult='opened',e=>window.nativeResult=e.message);true")
    until(lambda: js("window.nativeResult !== 'pending'"))
    assert js('window.nativeResult') == 'Use a native action button', js('window.nativeResult')
    js("window.nativeResult='pending';window.bashkittenHost.call('paste-image').then(()=>window.nativeResult='read',e=>window.nativeResult=e.message);true")
    until(lambda: js("window.nativeResult !== 'pending'"))
    assert js('window.nativeResult') == 'Use a native action button'
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
        if os.environ.get('BASHKITTEN_TEST_NATIVE_FILES') == '1':
            from gi.repository import Gdk
            def tap(selector):
                rect = js("(()=>{const r=document.querySelector(" + json.dumps(selector) + ").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
                subprocess.run(['xdotool', 'windowfocus', '--sync', str(xid), 'mousemove', '--window', str(xid), str(int(bounds.get_x()+rect['x']+app.window.get_surface_transform()[0])), str(int(bounds.get_y()+rect['y']+app.window.get_surface_transform()[1])), 'click', '1'], check=True)
                for _ in range(10): pump()
            def launched(value):
                return launches.exists() and any(value in json.loads(line) for line in launches.read_text().splitlines())
            tap('#filesToggle')
            until(lambda: launches.exists())
            native_file = ROOT / 'test-results/linux/Open file π with spaces.txt'
            native_file.parent.mkdir(parents=True, exist_ok=True)
            native_file.write_text('Open this existing project file, without downloading a copy.\n')
            host.control('project-root', {'path': str(native_file.parent)})
            from urllib.parse import urlencode
            for target, uri in [('', app.origin + '/api/files/content?' + urlencode({'root': str(native_file.parent), 'path': native_file.name})), ('_blank', 'https://bashkitten.com/launcher-test')]:
                js("(()=>{const a=document.createElement('a');a.id='launchFixture';a.textContent='Open fixture';a.href=" + json.dumps(uri) + ";a.target=" + json.dumps(target) + ";a.style='position:fixed;top:120px;left:400px;z-index:9999';document.body.append(a)})();true")
                tap('#launchFixture')
                until(lambda: launched(uri if target else native_file.as_uri()) or (not target and launched(str(native_file))))
                js("document.querySelector('#launchFixture').remove();true")
            print('PASS: project folder, Unicode/spaced local file and new-window URL launch through actual system application associations')
            fixture = ROOT / 'tests/fixtures/images/small.png'
            tap('#attachBtn'); tap('#menuAttach')
            chooser = until(lambda: next((w for w in Gtk.Window.list_toplevels() if w is not app.window and w.get_visible()), None), 10)
            chooser_id = chooser.get_surface().get_xid()
            subprocess.run(['xdotool', 'windowfocus', '--sync', str(chooser_id), 'key', 'ctrl+l', 'type', '--clearmodifiers', str(fixture)], check=True)
            for _ in range(15): pump()
            subprocess.run(['xdotool', 'key', 'Return'], check=True)
            for _ in range(15): pump()
            if chooser.get_visible(): subprocess.run(['xdotool', 'key', 'Return'], check=True)
            try:
                until(lambda: js("[...document.querySelectorAll('#attachmentTray img')].some(img=>img.naturalWidth>0)"), 10)
            except AssertionError:
                print('Upload diagnostic:', [w.get_title() for w in Gtk.Window.list_toplevels() if w.get_visible()], js('document.querySelector("#composerHint").textContent'), js('document.querySelector("#attachmentTray").innerHTML'))
                subprocess.run(['magick', 'import', '-window', str(chooser_id if chooser.get_visible() else xid), str(ROOT/'test-results/linux/upload-diagnostic.png')])
                raise
            before = js("document.querySelectorAll('#attachmentTray .attachment').length")
            subprocess.run(['xclip', '-selection', 'clipboard', '-t', 'image/png', '-i', str(fixture)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            js("document.addEventListener('paste',e=>window.pasteResult={trusted:e.isTrusted,types:[...e.clipboardData.types],files:e.clipboardData.files.length,items:[...e.clipboardData.items].map(i=>({kind:i.kind,type:i.type}))},true);true")
            tap('#prompt')
            subprocess.run(['xdotool', 'key', '--clearmodifiers', 'ctrl+v'], check=True)
            try:
                until(lambda: js("document.querySelectorAll('#attachmentTray .attachment').length") > before, 8)
            except AssertionError:
                print('Paste diagnostic:', app.web.get_display().get_clipboard().get_formats().to_string(), js('window.pasteResult || null'), js('document.activeElement.id'), js('document.querySelector("#composerHint").textContent'))
                raise
            print('PASS: system upload picker and real image clipboard paste reach the shared attachment tray')
            subprocess.run(['xclip', '-selection', 'clipboard', '-i'], input=b'BashKitten clipboard text', check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['xdotool', 'key', '--clearmodifiers', 'ctrl+v'], check=True)
            until(lambda: js("document.querySelector('#prompt').value.endsWith('BashKitten clipboard text')"))
            if os.environ.get('BASHKITTEN_TEST_LOGIN_UI') == '1':
                tap('#settingsBtn'); tap('#tabServices')
                until(lambda: js("document.querySelectorAll('#servicesList button').length > 0"))
                js("document.querySelector('#serviceFilter').value='openai-codex';document.querySelector('#serviceFilter').dispatchEvent(new Event('input'));true")
                tap('#servicesList .service-row button')
                login = until(lambda: next((w for w in Gtk.Window.list_toplevels() if w.get_title() == 'Pi service login'), None), 10)
                helper = login.get_child()
                until(lambda: js("Boolean(document.querySelector('#loginInput'))", helper))
                assert js("typeof window.bashkittenHost", helper) == 'undefined'
                js("document.querySelector('#loginInput').value='browser';document.querySelector('#steps button').click();true", helper)
                until(lambda: js("Boolean(document.querySelector('#steps a[target]'))", helper))
                assert js("new URL(document.querySelector('#steps a[target]').href).hostname", helper) == 'auth.openai.com'
                js("document.querySelector('#cancel').click();true", helper)
                until(lambda: js("document.querySelector('#cancel').hidden", helper))
                login.close()
                print('PASS: native Pi login helper shares authenticated cookies, has no host bridge, and presents the provider browser link (authorization cancelled)')
    js("document.querySelector('#newBtn').click();true")
    until(lambda: app.web.get_uri() == app.origin + '/')
    js("window.linksRemoved=false;Promise.all(window.linkFixture.ids.map(id=>fetch('/api/sessions/'+id,{method:'DELETE',headers:{'x-bashkitten-csrf':window.linkFixture.csrf}}))).then(()=>window.linksRemoved=true);true")
    until(lambda: js('window.linksRemoved'))
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
    if launch_environment:
        launch_environment.cleanup()
