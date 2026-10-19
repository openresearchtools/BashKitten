#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Materialize the pinned, patched module in build output. Never mutate donor source."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[3] / 'bashkitten/vendor/termux-x11/source'
DEPENDENCIES = SOURCE.parent.parent / 'display-dependencies'
PIN = 'fa3a8b430e2896a19f44c99a9cb056254615ae06'


def dependency_sources():
    """Verify the separately imported releases replacing frozen donor gitlinks."""
    result = {}
    for name in ('libtirpc', 'libx11', 'xserver'):
        directory = DEPENDENCIES / name
        metadata = json.loads((directory / 'source.json').read_text())
        target = 'lorie/src/main/cpp/' + name
        if metadata['name'] != name or metadata['target'] != target:
            raise ValueError('Unexpected embedded dependency target: ' + name)
        inventory = directory / 'SHA256SUMS'
        if hashlib.sha256(inventory.read_bytes()).hexdigest() != metadata['sourceInventorySha256']:
            raise ValueError('Embedded dependency inventory changed: ' + name)
        listed = set()
        for line in inventory.read_text().splitlines():
            expected, relative = line.split('  ', 1)
            if not relative.startswith('source/') or '..' in Path(relative).parts:
                raise ValueError('Invalid embedded dependency source path')
            path = directory / relative
            data = path.readlink().as_posix().encode() if path.is_symlink() else path.read_bytes()
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError('Embedded dependency source changed: ' + relative)
            listed.add(relative)
        actual = {p.relative_to(directory).as_posix() for p in (directory / 'source').rglob('*')
                  if p.is_file() or p.is_symlink()}
        if listed != actual or not metadata['licensePaths']:
            raise ValueError('Incomplete embedded dependency source: ' + name)
        for license_path in metadata['licensePaths']:
            if license_path not in listed or not (directory / license_path).is_file():
                raise ValueError('Missing embedded dependency license: ' + name)
        result[target] = (directory / 'source', metadata)
    return result


def prepare(output):
    output.parent.mkdir(parents=True, exist_ok=True)
    with (output.parent / '.prepare.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        metadata = json.loads((SOURCE.parent / 'source.json').read_text())
        if metadata['commit'] != PIN:
            raise ValueError('Unreviewed Termux:X11 pin')
        dependencies = dependency_sources()
        patches = sorted((HERE / 'patches').glob('*.patch'))
        digest = hashlib.sha256(Path(__file__).read_bytes() + (SOURCE.parent / 'source.json').read_bytes())
        for patch in patches:
            digest.update(patch.read_bytes())
        for _, dependency in dependencies.values():
            digest.update(json.dumps(dependency, sort_keys=True).encode())
        # Gradle observes donor-tree edits, so this inner cache must observe the
        # same inputs rather than reusing output solely from unchanged metadata.
        for source in sorted(SOURCE.rglob('*')):
            digest.update(source.relative_to(SOURCE).as_posix().encode() + b'\0')
            digest.update(str(source.stat().st_mode).encode() + b'\0')
            if source.is_file():
                with source.open('rb') as stream:
                    digest.update(hashlib.file_digest(stream, 'sha256').digest())
        identity = digest.hexdigest()
        stamp = output / '.prepared'
        if stamp.exists() and stamp.read_text() == identity:
            return
        staging = output.with_name(output.name + '.new')
        shutil.rmtree(staging, ignore_errors=True)
        shutil.copytree(SOURCE, staging)
        for target, (source, _) in dependencies.items():
            shutil.rmtree(staging / target)
            # Preserve upstream links as links; libtirpc's INSTALL points to the
            # maintainer's Automake manual and is not a compilation input.
            shutil.copytree(source, staging / target, symlinks=True)
        for patch in patches:
            subprocess.run(['patch', '--batch', '--forward', '-p1', '-i', str(patch)], cwd=staging, check=True)
        java = staging / 'lorie/src/main/java/com/termux/x11'
        # Native engine, input and extra-key machinery are reused; standalone app,
        # preference Activity, accessibility interceptor and broadcasts are not shipped.
        for name in ['MainActivity.java', 'LorieApp.java', 'LoriePreferences.java', 'CmdEntryPoint.java',
                     'utils/KeyInterceptor.java', 'utils/X11ToolbarViewPager.java', 'utils/ImeHeightProvider.java']:
            (java / name).unlink()
        ns = '{http://schemas.android.com/apk/res-auto}'
        fields = []
        for node in ET.parse(staging / 'lorie/src/main/res/xml/preferences.xml').iter():
            key = node.get(ns + 'key')
            if not key or key == 'extra_keys_config':
                continue
            default = node.get(ns + 'defaultValue', '')
            kind = {'EditTextPreference': 'String', 'SeekBarPreference': 'Int',
                    'ListPreference': 'List', 'SwitchPreferenceCompat': 'Boolean'}.get(node.tag)
            if not kind:
                continue
            if kind in ('String', 'List'):
                default = json.dumps(default)
            if key == 'displayResolutionMode':
                default = '"native"'
            # Browser content bounds already exclude IME: native dimensions follow it.
            if key == 'adjustResolution':
                default = 'false'
            fields.append((kind, key, default or ('false' if kind == 'Boolean' else '0')))
        content = '// Generated from the pinned Termux:X11 preferences; GPL-3.0-only.\npackage com.termux.x11;\n'
        content += 'public final class Prefs extends LoriePreferences.PrefsProto {\n'
        content += ' public final java.util.Map<String, Preference> keys = new java.util.HashMap<>();\n'
        for kind, key, default in fields:
            content += f' public final {kind}Preference {key} = new {kind}Preference("{key}", {default});\n'
        content += ' public final StringPreference extra_keys_config = new StringPreference("extra_keys_config", com.termux.x11.utils.TermuxX11ExtraKeys.DEFAULT_IVALUE_EXTRA_KEYS);\n'
        content += ' public Prefs(android.content.SharedPreferences values) { super(values);\n'
        for _, key, _ in fields:
            content += f' keys.put("{key}", {key});\n'
        content += ' keys.put("extra_keys_config", extra_keys_config);\n }\n}\n'
        (java / 'Prefs.java').write_text(content)
        resources = staging / 'embedded-res/drawable'
        resources.mkdir(parents=True)
        for pattern in ['ic_extra_key_*.xml', 'ic_zoom_*.xml']:
            for resource in (staging / 'lorie/src/main/res/drawable').glob(pattern):
                shutil.copy2(resource, resources / resource.name)
        # Each selected upstream resource keeps its original notices. No app manifest
        # or broadcast receiver from the donor participates in manifest merging.
        shutil.rmtree(output, ignore_errors=True)
        staging.rename(output)
        stamp.write_text(identity)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    prepare(parser.parse_args().output.resolve())
