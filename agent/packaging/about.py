#!/usr/bin/env python3
"""Build the shell's offline About page using the web UI's CSS and renderer."""
import argparse
import base64
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shell', choices=['android', 'linux', 'termux'])
parser.add_argument('licenses', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--version', default=None)
args = parser.parse_args()
notice = ('This APK contains the BashKitten browser and its bundled browser dependencies. The companion Termux package supplies the BashKitten server, unmodified Pi and npm dependencies, DDGS search, Caddy, Authelia and Tor under their respective licenses. Termux, Node.js, Python and declared system libraries are installed separately and retain their own licenses.' if args.shell == 'android' else
          'This package contains the BashKitten browser and server, unmodified Pi and npm dependencies, DDGS search, Caddy, Authelia and Tor under their respective licenses. Node.js, Python, GTK and other declared operating-system libraries are installed separately and retain their own licenses.')
if args.shell == 'termux':
    notice = 'This Termux package contains the BashKitten server, unmodified Pi and npm dependencies, DDGS search, Caddy, Authelia and Tor under their respective licenses. The Android browser is a separate APK. Termux, Node.js, Python and declared system libraries are installed separately and retain their own licenses.'
version_file = ROOT.parent / 'browser/bashkitten/config/version.txt'
version = args.version or (version_file.read_text().strip() if version_file.exists() else json.loads((ROOT / 'package.json').read_text())['version'])
data = {'version': version, 'license': 'GPL-3.0-only' if args.shell == 'termux' else 'AGPL-3.0-or-later', 'notice': notice, 'licenses': json.loads(args.licenses.read_text())}
data['logo'] = 'data:image/png;base64,' + base64.b64encode((ROOT / 'src/web/logo.png').read_bytes()).decode()
css = re.search(r'<style>(.*?)</style>', (ROOT / 'src/web/web_ui.html').read_text(), re.S)[1]
script = (ROOT / 'src/web/about.js').read_text()
args.output.write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>About BashKitten</title><style>''' + css + '''
html,body { height:auto; min-height:100%; overflow:auto; }
</style></head><body><div class="settings-page"><section id="settingsAbout" class="settings-panel"></section></div>
<script>''' + script + '\nrenderBashKittenAbout(document.querySelector("#settingsAbout"), ' +
json.dumps(data, ensure_ascii=True).replace('<', '\\u003c') + ');</script></body></html>\n')
