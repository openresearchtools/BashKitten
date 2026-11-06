#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Publish complete repository source changes without fetching existing sources.

The permanent complete snapshot preserves donor export-ignore files. Native Git
binary patches reproduce each later exact tree; component sources remain with
those components instead of being downloaded into another aggregate.
"""
import gzip
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE_SOURCE = '522a9d8a4e24ae2fdd0b76fd2cc9f98af2ba7190'
BASE_VERSION = '153.6.2'
BASE_MANIFEST_SHA256 = '1f185cabc3c0a332a9e41a6a785818163500883a93578e533c930e47cb6f7abf'


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def repository_patch(revision, directory):
    """Use Git's native binary format and prove replay yields the exact tree."""
    if subprocess.run(['git', 'cat-file', '-e', BASE_SOURCE + '^{commit}'], cwd=ROOT,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(['git', 'fetch', '--filter=blob:none', '--depth=1', 'origin', BASE_SOURCE], cwd=ROOT, check=True)
    patch = directory / 'taskarian.patch'
    with patch.open('wb') as output:
        subprocess.run(['git', 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv',
                        BASE_SOURCE, revision, '--'], cwd=ROOT, stdout=output, check=True)
    index = directory / 'verification.index'
    environment = {**os.environ, 'GIT_INDEX_FILE': str(index)}
    try:
        subprocess.run(['git', 'read-tree', BASE_SOURCE], cwd=ROOT, env=environment, check=True)
        if patch.stat().st_size:
            subprocess.run(['git', 'apply', '--cached', '--binary', str(patch)], cwd=ROOT, env=environment, check=True)
        actual = subprocess.check_output(['git', 'write-tree'], cwd=ROOT, env=environment, text=True).strip()
        expected = subprocess.check_output(['git', 'rev-parse', revision + '^{tree}'], cwd=ROOT, text=True).strip()
        if actual != expected:
            raise ValueError('Repository source patch does not reconstruct the exact source tree')
    finally:
        index.unlink(missing_ok=True)
    return {'schema': 1, 'baseSource': BASE_SOURCE, 'sourceCommit': revision, 'tree': expected,
            'format': 'git diff --binary --full-index', 'patchSha256': module('component-store').sha(patch)}


def main():
    store, application = module('component-store'), module('application')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != store.repository('linux-amd64'):
        raise ValueError('Repository source publication belongs to the AMD64 builder')
    wanted = application.inputs('linux-amd64')
    if store.lookup('corresponding-source', 'linux-amd64', wanted):
        print('Exact repository sources are already published; no source payload downloaded')
        return
    base = store.lookup('corresponding-source', 'linux-amd64', {
        'source': BASE_SOURCE, 'productVersion': BASE_VERSION, 'target': 'linux-amd64'})
    if not base or base['manifestSha256'] != BASE_MANIFEST_SHA256:
        raise ValueError('The permanent verified complete repository source baseline is unavailable')
    reference = {key: base[key] for key in ('repository', 'manifestName', 'manifestSha256', 'tag') if key in base}
    with tempfile.TemporaryDirectory(prefix='taskarian-source-', dir=os.environ['RUNNER_TEMP']) as temporary:
        directory = Path(temporary)
        contents = directory / 'contents'
        contents.mkdir()
        metadata = repository_patch(wanted['source'], contents)
        baseline_archive = next(item for item in base['manifest']['assets']
                                if item['name'] == 'taskarian-source-' + BASE_SOURCE[:12] + '.tar.gz')
        baseline_url = base['url'].rsplit('/', 1)[0] + '/'
        metadata['baseline'] = {'manifest': {**reference, 'url': base['url']},
                                'archive': {**baseline_archive, 'parts': [
                                    {**part, 'url': baseline_url + part['asset']} for part in baseline_archive['parts']]}}
        (contents / 'source.json').write_text(json.dumps(metadata, indent=2) + '\n')
        license_text = subprocess.check_output(['git', 'show', wanted['source'] + ':LICENSE'], cwd=ROOT)
        (contents / 'LICENSE').write_bytes(license_text)
        (contents / 'README.txt').write_text(
            'Complete Taskarian corresponding source\n\n'
            'source.json records the permanent complete baseline archive, ordered download parts, checksums and exact target Git tree. '
            'The baseline includes donor files marked export-ignore; GitHub automatic source ZIP files are not a substitute.\n\n'
            'Download and verify the baseline parts, concatenate in recorded order, verify the full archive, and extract it. '
            'In its taskarian directory run:\n'
            '  git init\n  git add --force .\n  git apply --index --binary /absolute/path/to/taskarian.patch\n'
            '  git write-tree\n'
            'The resulting tree must equal source.json tree. The patch includes every tracked addition, modification, mode change and deletion. '
            'Unchanged upstream and dependency source archives remain available through component-sources.json in the app release.\n')
        output = directory / 'output'
        output.mkdir()
        name = 'taskarian-source-' + wanted['source'][:12] + '.tar.gz'
        with (output / name).open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
                for file in sorted(contents.iterdir()):
                    info = archive.gettarinfo(str(file), arcname='taskarian-source/' + file.name)
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    with file.open('rb') as source:
                        archive.addfile(info, source)
        (output / 'Taskarian-LICENSE.txt').write_bytes(license_text)
        (output / 'repository-source.json').write_text(json.dumps(metadata, indent=2) + '\n')
        store.publish('corresponding-source', 'linux-amd64', wanted['productVersion'], wanted, output,
                      assets={name: 'source', 'Taskarian-LICENSE.txt': 'legal', 'repository-source.json': 'metadata'},
                      source_commit=wanted['source'], dependencies=[reference])
        print('Published exact verified source patch; no existing source archive downloaded')


if __name__ == '__main__':
    main()
