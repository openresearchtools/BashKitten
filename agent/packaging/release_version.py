"""Prepare and check one Firefox-aligned version sequence across release channels."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    'firefox_release', ROOT / 'browser/bashkitten/scripts/firefox_release.py')
firefox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(firefox)


def parts(version):
    value = firefox.product_parts(version)
    return value + (0,) if len(value) == 2 else value


def newest_published():
    repository = os.environ.get('GH_REPO', 'openresearchtools/BashKitten')
    tags = subprocess.check_output(
        ['gh', 'api', '--paginate', f'repos/{repository}/releases?per_page=100',
         '--jq', '.[] | select(.draft == false) | .tag_name'], text=True).splitlines()
    versions = []
    for tag in tags:
        if not tag.startswith('v'):
            raise ValueError('Unexpected published product tag: ' + tag)
        versions.append(parts(tag[1:]))
    return max(versions, default=(0, 0, 0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'check'])
    args = parser.parse_args()
    current = firefox.validate_versions(ROOT / 'browser')
    version = current['bashkitten']
    latest = newest_published()
    if args.command == 'check':
        if parts(version) <= latest:
            raise ValueError('This product version is already published or older; prepare a new candidate first')
    else:
        firefox.require_clean(ROOT / 'browser')
        if parts(version) <= latest:
            if parts(version)[:2] != latest[:2]:
                raise ValueError('The source uses an older Firefox release line than the latest published version')
            latest_version = '.'.join(map(str, latest if latest[2] else latest[:2]))
            version = firefox.next_product_version(latest_version, current['firefox'])
        (ROOT / 'browser/bashkitten/config/version.txt').write_text(version + '\n')
        npm_version = version if version.count('.') == 2 else version + '.0'
        for name in ('package.json', 'package-lock.json'):
            path = ROOT / 'agent' / name
            data = json.loads(path.read_text())
            data['version'] = npm_version
            if name == 'package-lock.json':
                data['packages']['']['version'] = npm_version
            path.write_text(json.dumps(data, indent=2) + '\n')
    print(version)


if __name__ == '__main__':
    main()
