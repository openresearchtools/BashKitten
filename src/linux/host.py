#!/usr/bin/env python3
"""Small system-WebKit host. The local Node server owns all chat and Pi behavior."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

import gi
gi.require_version('Gtk', '4.0')
gi.require_version('WebKit', '6.0')
from gi.repository import Gio, GLib, Gtk, WebKit

CONTROL = Path(__file__).resolve().parents[1] / 'server/control.mjs'
NODE = os.environ.get('BASHKITTEN_NODE') or shutil.which('node')
DATA = Path(os.environ.get('BASHKITTEN_DATA_DIR', Path.home() / '.local/share/bashkitten-pi'))
PROFILE = DATA / 'desktop'
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2)


def control(command='status', value=None):
    if not NODE:
        raise RuntimeError('Install Node.js 22.19 or newer to start BashKitten.')
    result = subprocess.run([NODE, str(CONTROL), command, json.dumps(value or {})],
                            capture_output=True, text=True, timeout=45)
    try:
        reply = json.loads(result.stdout if result.returncode == 0 else result.stderr)
    except ValueError:
        raise RuntimeError('Local controller failed. See the BashKitten control log.')
    if result.returncode or reply.get('error'):
        raise RuntimeError(reply.get('error', 'Local controller failed'))
    return reply


class BashKitten(Gtk.Application):
    def __init__(self):
        profile_id = hashlib.sha256(str(DATA).encode()).hexdigest()[:16]
        super().__init__(application_id='com.bashkitten.desktop.p' + profile_id)
        self.window = None
        self.origin = None
        self.polling = False
        self.nonce = secrets.token_hex(32)

    def background(self, work, done, failed=None):
        future = POOL.submit(work)
        def finish(_):
            def deliver():
                try:
                    result = future.result()
                except Exception as error:
                    (failed or self.error)(str(error))
                else:
                    done(result)
                return GLib.SOURCE_REMOVE
            GLib.idle_add(deliver)
        future.add_done_callback(finish)

    def do_activate(self):
        if self.window:
            self.window.present()
            return
        PROFILE.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(PROFILE, 0o700)
        self.window = Gtk.ApplicationWindow(application=self, title='BashKitten', default_width=1120, default_height=820)
        header = Gtk.HeaderBar()
        menu = Gtk.MenuButton(icon_name='open-menu-symbolic', tooltip_text='Services')
        popover = Gtk.Popover()
        actions = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, margin_top=12, margin_bottom=12, margin_start=12, margin_end=12)
        for label, command in [('Start backend', 'start'), ('Stop backend', 'stop'), ('Restart backend', 'restart'), ('Stop all Pi instances', 'pi-stop')]:
            button = Gtk.Button(label=label)
            button.connect('clicked', lambda _, cmd=command: self.background(lambda: control(cmd), self.status))
            actions.append(button)
        self.state_label = Gtk.Label(label='Checking services…', wrap=True)
        actions.append(self.state_label)
        popover.set_child(actions)
        menu.set_popover(popover)
        header.pack_start(menu)
        self.window.set_titlebar(header)
        self.stack = Gtk.Stack()
        fallback = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18, halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER)
        self.message = Gtk.Label(label='Starting BashKitten…', wrap=True, max_width_chars=64)
        fallback.append(self.message)
        retry = Gtk.Button(label='Start / Retry')
        retry.connect('clicked', lambda _: self.background(lambda: control('start'), self.status))
        fallback.append(retry)
        self.stack.add_named(fallback, 'status')
        network = WebKit.NetworkSession.new(str(PROFILE / 'data'), str(PROFILE / 'cache'))
        network.get_cookie_manager().set_persistent_storage(str(PROFILE / 'cookies.sqlite'), WebKit.CookiePersistentStorage.SQLITE)
        self.content = WebKit.UserContentManager()
        self.content.register_script_message_handler('bashkitten')
        self.content.connect('script-message-received::bashkitten', self.native_message)
        self.web = WebKit.WebView(network_session=network, user_content_manager=self.content)
        self.web.get_settings().set_enable_developer_extras(False)
        self.web.connect('decide-policy', self.navigate)
        self.web.connect('load-failed', self.load_failed)
        self.stack.add_named(self.web, 'web')
        self.window.set_child(self.stack)
        self.window.present()
        self.poll()
        GLib.timeout_add_seconds(5, self.poll)

    def error(self, message):
        self.message.set_text(message)
        self.state_label.set_text(message)

    def poll(self):
        if not self.polling:
            self.polling = True
            def done(value):
                self.polling = False
                self.status(value)
            def failed(message):
                self.polling = False
                self.error(message)
            self.background(control, done, failed)
        return GLib.SOURCE_CONTINUE

    def status(self, value):
        web = value['web']
        self.state_label.set_text('Backend: ' + web['status'] + '\nPi instances: ' + str(sum(s['running'] for s in value['sessions'])))
        if web['status'] != 'running':
            self.message.set_text(web.get('error') or ('Backend stopped' if not web['desired'] else 'Starting backend…'))
            self.stack.set_visible_child_name('status')
            return
        origin = web['url']
        parsed = urlsplit(origin)
        if parsed.hostname != '127.0.0.1' or parsed.scheme not in ('http', 'https'):
            return self.error('Controller returned an invalid local address')
        if origin != self.origin or self.stack.get_visible_child_name() != 'web':
            self.origin = origin
            self.content.remove_all_scripts()
            # The nonce is injected into the trusted main frame only. Subframes
            # and repository documents cannot invoke the native message handler.
            script = """(() => {
              if (location.origin !== ORIGIN || location.pathname !== '/') return;
              const pending = new Map();
              let activationUntil = 0;
              document.addEventListener('click', event => { if (event.isTrusted) activationUntil = performance.now() + 1000; }, true);
              window.addEventListener('bashkitten-native-reply', e => {
                const p = pending.get(e.detail.id); if (!p) return; pending.delete(e.detail.id);
                e.detail.error ? p.reject(Error(e.detail.error)) : p.resolve(e.detail.value);
              });
              Object.defineProperty(window, 'bashkittenHost', {value: Object.freeze({platform:'linux', call(action, value={}) {
                if (performance.now() > activationUntil) return Promise.reject(Error('Use a native action button'));
                activationUntil = 0;
                return new Promise((resolve,reject) => {
                  const id=crypto.randomUUID(); pending.set(id,{resolve,reject});
                  window.webkit.messageHandlers.bashkitten.postMessage(JSON.stringify({id,action,value,nonce:NONCE}));
                });
              }})});
            })();""".replace('ORIGIN', json.dumps(origin)).replace('NONCE', json.dumps(self.nonce))
            self.content.add_script(WebKit.UserScript.new(script, WebKit.UserContentInjectedFrames.TOP_FRAME, WebKit.UserScriptInjectionTime.START, None, None))
            self.web.load_uri(origin + '/')
        self.stack.set_visible_child_name('web')

    def load_failed(self, web, event, uri, error):
        self.error('Could not load the local app: ' + error.message)
        self.stack.set_visible_child_name('status')
        return True

    def navigate(self, web, decision, kind):
        if kind not in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        action = decision.get_navigation_action()
        uri = action.get_request().get_uri()
        if kind == WebKit.PolicyDecisionType.NAVIGATION_ACTION and uri in (self.origin + '/', 'about:blank'):
            decision.use()
        else:
            decision.ignore()
            if action.is_user_gesture() and urlsplit(uri).scheme in ('http', 'https', 'mailto'):
                if uri.startswith(self.origin + '/api/'):
                    self.background(lambda: control('native-file', {'url': uri}), self.open_file)
                else:
                    Gtk.UriLauncher.new(uri).launch(self.window, None, self.launched)
        return True

    def launched(self, launcher, result):
        try:
            launcher.launch_finish(result)
        except GLib.Error as error:
            self.error(error.message)

    def open_file(self, value):
        launcher = Gtk.FileLauncher.new(Gio.File.new_for_path(value['path']))
        launcher.launch(self.window, None, self.launched)

    def reply(self, request, value=None, error=None):
        payload = json.dumps({'id': request['id'], 'value': value, 'error': error})
        self.web.evaluate_javascript("window.dispatchEvent(new CustomEvent('bashkitten-native-reply',{detail:" + payload + '}))', -1, None, None, None)

    def native_message(self, manager, message):
        try:
            request = json.loads(message.to_string())
            if request.get('nonce') != self.nonce or self.web.get_uri() != self.origin + '/':
                return
            action, value = request['action'], request.get('value', {})
            if action == 'choose-folder':
                dialog = Gtk.FileDialog(title=value.get('title', 'Working folder'))
                def selected(dialog, result):
                    try:
                        file = dialog.select_folder_finish(result)
                        self.background(lambda: control('project-root', {'path': file.get_path()}), lambda result: self.reply(request, result), lambda error: self.reply(request, error=error))
                    except GLib.Error as error:
                        if error.matches(Gtk.DialogError.quark(), Gtk.DialogError.DISMISSED) or error.matches(Gtk.DialogError.quark(), Gtk.DialogError.CANCELLED):
                            self.reply(request, None)
                        else:
                            self.reply(request, error=error.message)
                dialog.select_folder(self.window, None, selected)
            elif action == 'open-file':
                def ready(result):
                    self.open_file(result)
                    self.reply(request, {'ok': True})
                self.background(lambda: control('native-file', value), ready, lambda error: self.reply(request, error=error))
            else:
                self.reply(request, error='Unknown native action')
        except (ValueError, KeyError, TypeError):
            return


if __name__ == '__main__':
    os.umask(0o077)
    sys.exit(BashKitten().run(sys.argv))
