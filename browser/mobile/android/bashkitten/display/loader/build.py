#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the paired Termux loader from committed source, with the actual APK signer."""
import argparse
import json
import os
import hashlib
import shutil
from pathlib import Path
import re
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent

def build(args):
    if args.keystore:
        if not args.alias or not args.storepass_env:
            raise ValueError('Keystore pairing requires --alias and --storepass-env')
        cert = subprocess.run([str(args.jdk / 'bin/keytool'), '-exportcert', '-keystore', str(args.keystore),
            '-alias', args.alias, '-storepass:env', args.storepass_env], check=True, stdout=subprocess.PIPE).stdout
        signer = hashlib.sha256(cert).hexdigest()
    else:
        signer = args.signer.lower().replace(':', '')
    if not re.fullmatch('[a-f0-9]{64}', signer):
        raise ValueError('Provide the installed/release APK signing certificate SHA-256, never a private key')
    if not re.fullmatch(r'[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+', args.package):
        raise ValueError('Invalid Android package ID')
    protocol = (HERE.parent / 'src/main/java/com/bashkitten/display/DisplayProtocol.java').read_text()
    version = re.search(r'VERSION = "([^"]+)"', protocol).group(1)
    args.output.mkdir(parents=True, exist_ok=True)
    classes = args.output / 'classes'; classes.mkdir(exist_ok=True)
    generated = args.output / 'Pair.java'
    generated.write_text('package com.bashkitten.display.loader; final class Pair {\n' + ''.join(
        f' static final String {key} = {json.dumps(value)};\n' for key, value in
        [('PACKAGE', args.package), ('SIGNER', signer), ('VERSION', version)]) + '}\n')
    subprocess.run([str(args.jdk / 'bin/javac'), '--release', '17', '-cp', str(args.android_jar),
                    '-d', str(classes), str(HERE / 'Loader.java'), str(generated)], check=True)
    jar = args.output / 'loader-classes.jar'
    with zipfile.ZipFile(jar, 'w') as archive:
        for file in sorted(classes.rglob('*.class')): archive.write(file, str(file.relative_to(classes)))
    subprocess.run([str(args.d8), '--release', '--min-api', '31', '--lib', str(args.android_jar),
                    '--output', str(args.output / 'bashkitten-x11-loader.jar'), str(jar)], check=True,
                   env={**os.environ, 'JAVA_HOME': str(args.jdk), 'PATH': str(args.jdk / 'bin') + os.pathsep + os.environ.get('PATH', '')})
    command = args.output / 'bashkitten-x11'
    command.write_text('''#!/data/data/com.termux/files/usr/bin/sh
# Paired native Display loader; no extra APK, signing relationship with Termux or LAN transport.
export CLASSPATH=/data/data/com.termux/files/usr/lib/bashkitten/display/bashkitten-x11-loader.jar
exec /system/bin/app_process / com.bashkitten.display.loader.Loader "$@"
''')
    command.chmod(0o755)
    source = HERE.parents[4] / 'bashkitten/vendor/termux-x11'
    notices = args.output / 'licenses'; notices.mkdir(exist_ok=True)
    shutil.copy2(source / 'source/LICENSE', notices / 'Termux-X11-GPL-3.0.txt')
    shutil.copy2(source / 'source.json', notices / 'source.json')
    (notices / 'NOTICE').write_text('Termux:X11 shell-loader, GPL-3.0-only.\n'
        'Source: https://github.com/termux/termux-x11 at fa3a8b430e2896a19f44c99a9cb056254615ae06.\n'
        'BashKitten modifications, 11 October 2026: SHA-256 signing pin, exact module protocol, current user and removal of environment overrides.\n'
        'Matching loader source and build recipe are in browser/mobile/android/bashkitten/display/loader in the BashKitten source archive.\n')
    manifest = {'package': args.package, 'signerSha256': signer, 'protocol': version,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=HERE, text=True).strip(),
        'upstreamCommit': 'fa3a8b430e2896a19f44c99a9cb056254615ae06',
        'sha256': {name: hashlib.sha256((args.output / name).read_bytes()).hexdigest()
                   for name in ['bashkitten-x11', 'bashkitten-x11-loader.jar']}}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--jdk', required=True, type=Path)
    parser.add_argument('--android-jar', required=True, type=Path)
    parser.add_argument('--d8', required=True, type=Path)
    parser.add_argument('--package', default='com.bashkitten')
    identity = parser.add_mutually_exclusive_group(required=True)
    identity.add_argument('--signer')
    identity.add_argument('--keystore', type=Path)
    parser.add_argument('--alias')
    parser.add_argument('--storepass-env')
    parser.add_argument('--output', required=True, type=Path)
    build(parser.parse_args())
