#!/usr/bin/env python3
"""Build the browser's offline component-license page from its packaged inventory."""
import argparse
import importlib.util
import os
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shell', choices=['android', 'linux', 'termux'])
parser.add_argument('licenses', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--version', default=None)
parser.add_argument('--source-reference-directory', action='append', type=Path, default=[])
args = parser.parse_args()
notice = ('This APK contains the Taskarian browser and its bundled browser dependencies. The companion Termux package supplies the Taskarian server, private Node.js/npm, unmodified Pi and its dependencies, DDGS search, Caddy, Authelia, Tor and Valkey under their respective licenses. Termux, Python and declared system libraries are installed separately and retain their own licenses.' if args.shell == 'android' else
          'This package contains the Taskarian browser and server, private Node.js/npm, unmodified Pi and its dependencies, DDGS search, Caddy, Authelia, Tor and Valkey under their respective licenses. Python, GTK and other declared operating-system libraries are installed separately and retain their own licenses.')
if args.shell == 'termux':
    notice = 'This Termux package contains the Taskarian server, private Node.js/npm, unmodified Pi and its dependencies, DDGS search, Caddy, Authelia, Tor and Valkey under their respective licenses. The Android browser is a separate APK. Termux, Python and declared system libraries are installed separately and retain their own licenses.'
version_file = ROOT.parent / 'browser/taskarian/config/version.txt'
version = args.version or (version_file.read_text().strip() if version_file.exists() else json.loads((ROOT / 'package.json').read_text())['version'])
data = {'version': version, 'notice': notice, 'licenses': json.loads(args.licenses.read_text())}
# Component receipts already bind these URLs to the exact packaged inputs.
# Reuse the existing Source provenance field and renderer without changing texts.
directories = list(args.source_reference_directory)
for name in ('TASKARIAN_REMOTE_CLIENT_DIR', 'TASKARIAN_TOR_ANDROID_DIR',
             'TASKARIAN_DISPLAY_ANDROID_DIR', 'TASKARIAN_ANDROID_LIBRARY_SOURCE_DIRECTORY'):
    if os.environ.get(name):
        directories.append(Path(os.environ[name]))
if directories:
    spec = importlib.util.spec_from_file_location('about_component_sources', ROOT / 'packaging/browser-release.py')
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    store = owner.module('component-store')
    releases = {}
    own = next(entry for entry in data['licenses'] if entry.get('name') == 'Taskarian')
    previous = own.get('sourceProvenance')
    if isinstance(previous, dict):
        releases.update({entry['manifestSha256']: entry for entry in previous.get('componentReleases', [])})
    for ref in owner.dependencies(sorted(set(directories))):
        if ref['repository'] not in store.REPOSITORIES or not store.MANIFEST.fullmatch(ref['manifestName']):
            continue
        component, target, _digest = store.reference_identity(ref)
        url = store.manifest_url(ref)
        if not url:
            raise ValueError('Packaged component source reference is unavailable: ' + ref['manifestName'])
        releases[ref['manifestSha256']] = {'component': component, 'target': target,
            'release': url.rsplit('/', 1)[0].replace('/releases/download/', '/releases/tag/'),
            'manifest': url, 'manifestSha256': ref['manifestSha256']}
    if releases:
        provenance = dict(previous) if isinstance(previous, dict) else ({'retainedProvenance': previous} if previous else {})
        provenance.update({'releaseSourceManifest': 'https://github.com/openresearchtools/Taskarian/releases/download/v' + version + '/component-sources.json',
                           'componentReleases': sorted(releases.values(), key=lambda entry: (entry['target'], entry['component'], entry['manifestSha256']))})
        own['sourceProvenance'] = provenance
        args.licenses.write_text(json.dumps(data['licenses'], ensure_ascii=True) + '\n')
args.output.write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Component licenses · Taskarian</title><style>
:root { color-scheme:light dark; font:message-box; background:Canvas; color:CanvasText; }
body { max-width:70em; margin:0 auto; padding:1.5rem; line-height:1.5; }
h1 { font-size:1.5rem; } summary { cursor:pointer; padding:.5rem 0; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:30rem; overflow:auto; }
</style></head><body><h1>Component licenses</h1><p id="version"></p><p id="notice"></p><main id="licenses"></main>
<script>const data = ''' + json.dumps(data, ensure_ascii=True).replace('<', '\\u003c') + ''';
document.querySelector('#version').textContent = 'Taskarian ' + data.version;
document.querySelector('#notice').textContent = data.notice;
function appendText(parent, value) {
  const text = String(value), links = /https?:\\/\\/[^\\s<>"']+/g;
  let offset = 0;
  for (const match of text.matchAll(links)) {
    const source = match[0].replace(/[),.;\\]]+$/, '');
    let url;
    try { url = new URL(source); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
    parent.append(document.createTextNode(text.slice(offset, match.index)));
    const link = document.createElement('a'); link.href = url.href;
    link.rel = 'noreferrer noopener'; link.textContent = source; parent.append(link);
    offset = match.index + source.length;
  }
  parent.append(document.createTextNode(text.slice(offset)));
}
for (const entry of data.licenses) {
  const detail = document.createElement('details'), summary = document.createElement('summary');
  summary.textContent = [entry.name, entry.version, entry.license].filter(Boolean).join(' · ');
  detail.append(summary);
  detail.ontoggle = () => {
    if (detail.open && detail.childElementCount === 1) {
      const fields = [['source', 'Source'], ['sourceCommit', 'Source revision'], ['commit', 'Revision'],
        ['sourceProvenance', 'Source provenance'], ['modifications', 'Modifications'], ['attribution', 'Attribution']];
      for (const [key, label] of fields) {
        if (entry[key] == null) continue;
        const metadata = document.createElement('pre');
        appendText(metadata, label + ': ' + (typeof entry[key] === 'string' ? entry[key] : JSON.stringify(entry[key], null, 2)));
        detail.append(metadata);
      }
      const text = document.createElement('pre'); appendText(text, entry.text); detail.append(text);
    }
  };
  document.querySelector('#licenses').append(detail);
}
</script></body></html>\n''')
