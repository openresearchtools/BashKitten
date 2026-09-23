#!/usr/bin/env python3
"""Build the browser's offline component-license page from its packaged inventory."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shell', choices=['android', 'linux', 'termux'])
parser.add_argument('licenses', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--version', default=None)
args = parser.parse_args()
notice = ('This APK contains the BashKitten browser and its bundled browser dependencies. The companion Termux package supplies the BashKitten server, unmodified Pi and npm dependencies, DDGS search, Caddy, Authelia, Tor and Valkey under their respective licenses. Termux, Node.js, Python and declared system libraries are installed separately and retain their own licenses.' if args.shell == 'android' else
          'This package contains the BashKitten browser and server, unmodified Pi and npm dependencies, DDGS search, Caddy, Authelia, Tor and Valkey under their respective licenses. Node.js, Python, GTK and other declared operating-system libraries are installed separately and retain their own licenses.')
if args.shell == 'termux':
    notice = 'This Termux package contains the BashKitten server, unmodified Pi and npm dependencies, DDGS search, Caddy, Authelia, Tor and Valkey under their respective licenses. The Android browser is a separate APK. Termux, Node.js, Python and declared system libraries are installed separately and retain their own licenses.'
version_file = ROOT.parent / 'browser/bashkitten/config/version.txt'
version = args.version or (version_file.read_text().strip() if version_file.exists() else json.loads((ROOT / 'package.json').read_text())['version'])
data = {'version': version, 'notice': notice, 'licenses': json.loads(args.licenses.read_text())}
args.output.write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Component licenses · BashKitten</title><style>
:root { color-scheme:light dark; font:message-box; background:Canvas; color:CanvasText; }
body { max-width:70em; margin:0 auto; padding:1.5rem; line-height:1.5; }
h1 { font-size:1.5rem; } summary { cursor:pointer; padding:.5rem 0; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:30rem; overflow:auto; }
</style></head><body><h1>Component licenses</h1><p id="version"></p><p id="notice"></p><main id="licenses"></main>
<script>const data = ''' + json.dumps(data, ensure_ascii=True).replace('<', '\\u003c') + ''';
document.querySelector('#version').textContent = 'BashKitten ' + data.version;
document.querySelector('#notice').textContent = data.notice;
for (const entry of data.licenses) {
  const detail = document.createElement('details'), summary = document.createElement('summary');
  summary.textContent = [entry.name, entry.version, entry.license].filter(Boolean).join(' · ');
  detail.append(summary);
  detail.ontoggle = () => {
    if (detail.open && detail.childElementCount === 1) {
      const text = document.createElement('pre'); text.textContent = entry.text; detail.append(text);
    }
  };
  document.querySelector('#licenses').append(detail);
}
</script></body></html>\n''')
