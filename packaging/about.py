#!/usr/bin/env python3
"""Build the shell's offline About page using the web UI's CSS and renderer."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shell', choices=['android', 'linux'])
parser.add_argument('licenses', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
notice = ('The app connects to the separate BashKitten server, which includes unmodified Pi and its npm dependencies under their own licenses. Termux and Node.js are installed separately and retain their own licenses. These notices cover the libraries bundled in this APK.' if args.shell == 'android' else
          'The BashKitten server includes unmodified Pi and its npm dependencies under their own licenses. GTK, WebKitGTK, PyGObject, Python and Node.js are installed by your system package manager. They are not bundled in this app and retain their own licenses.')
data = {'version': json.loads((ROOT / 'package.json').read_text())['version'],
        'notice': notice, 'licenses': json.loads(args.licenses.read_text())}
css = re.search(r'<style>(.*?)</style>', (ROOT / 'src/web/web_ui.html').read_text(), re.S)[1]
script = (ROOT / 'src/web/about.js').read_text()
args.output.write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>About BashKitten</title><style>''' + css + '''
html,body { height:auto; min-height:100%; overflow:auto; }
</style></head><body><div class="settings-page"><section id="settingsAbout" class="settings-panel"></section></div>
<script>''' + script + '\nrenderBashKittenAbout(document.querySelector("#settingsAbout"), ' +
json.dumps(data, ensure_ascii=True).replace('<', '\\u003c') + ');</script></body></html>\n')
