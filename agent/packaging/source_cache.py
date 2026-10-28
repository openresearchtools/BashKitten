#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Cache original upstream source bytes selected by committed checksum pins.

This is download preparation, not dependency resolution. Build owners retain
their native lock, package-identity, license and offline compilation checks.
"""
import hashlib
import http.client
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def default_cache():
    configured = os.environ.get('BASHKITTEN_SOURCE_CACHE')
    if configured:
        return Path(configured).expanduser()
    return Path(os.environ.get('XDG_CACHE_HOME', str(Path.home() / '.cache'))) / 'bashkitten-sources'


def fetch(record, cache=None, *, local=None, offline=False):
    """Return a verified original file; never infer a version or another URL.

    Required record fields are ``url`` (HTTPS) and ``sha256``; ``size`` is
    optional. An existing whole local archive may seed the external cache.
    BASHKITTEN_OFFLINE_SOURCES=1 forbids network access for every caller.
    """
    url, expected = record.get('url'), record.get('sha256')
    if not isinstance(url, str) or urllib.parse.urlsplit(url).scheme != 'https':
        raise ValueError('Pinned source requires an HTTPS URL')
    if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('Pinned source requires an exact SHA256')
    size = record.get('size')
    if size is not None and (type(size) is not int or size < 0):
        raise ValueError('Invalid pinned source size')
    url_path = Path(urllib.parse.urlsplit(url).path)
    name = re.sub(r'[^A-Za-z0-9._-]', '_', url_path.name or 'source')
    legacy_name = name
    # Codeload uses /tar.gz/COMMIT; npm's native package argument parser needs
    # an archive suffix to distinguish that original tarball from a directory.
    if url_path.parent.name in ('tar.gz', 'tarball') and not name.endswith(('.tgz', '.tar.gz')):
        name += '.tar.gz'
    elif url_path.parent.name in ('zip', 'zipball') and not name.endswith('.zip'):
        name += '.zip'
    directory = Path(cache) if cache is not None else default_cache()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (expected + '-' + name)

    def verified(path):
        return (path.is_file() and (size is None or path.stat().st_size == size)
                and digest(path) == expected)

    legacy = directory / (expected + '-' + legacy_name)
    if legacy != target and legacy.is_file() and not target.exists():
        if not verified(legacy):
            raise ValueError('Cached source checksum/size mismatch: ' + str(legacy))
        try:
            target.hardlink_to(legacy)
        except FileExistsError:
            pass
    if target.exists():
        if not verified(target):
            raise ValueError('Cached source checksum/size mismatch: ' + str(target))
        return target
    seed = Path(local) if local is not None else None
    if seed is not None and seed.exists() and not verified(seed):
        raise ValueError('Local source checksum/size mismatch: ' + str(seed))
    if not (seed is not None and seed.is_file()) and (
            offline or os.environ.get('BASHKITTEN_OFFLINE_SOURCES') == '1'):
        raise FileNotFoundError('Pinned source is absent from the offline cache: ' + url)
    attempts = 1 if seed is not None and seed.is_file() else 3
    for attempt in range(attempts):
        incoming = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix='.source-', delete=False) as output:
                incoming = Path(output.name)
                if seed is not None and seed.is_file():
                    with seed.open('rb') as source:
                        shutil.copyfileobj(source, output)
                else:
                    request = urllib.request.Request(url, headers={'User-Agent': 'BashKitten-Source-Builder/1'})
                    with urllib.request.urlopen(request, timeout=180) as source:
                        shutil.copyfileobj(source, output)
            if not verified(incoming):
                raise ValueError(f'Downloaded source checksum/size mismatch: {url}; '
                                 f'expected sha256={expected}, size={size}; '
                                 f'received sha256={digest(incoming)}, size={incoming.stat().st_size}')
            incoming.chmod(0o644)
            incoming.replace(target)
            return target
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError, ValueError) as error:
            retryable = (not isinstance(error, urllib.error.HTTPError)
                         or error.code in (408, 429) or error.code >= 500)
            if attempt + 1 == attempts or not retryable:
                raise
            print(f'Pinned source download attempt {attempt + 1}/{attempts} failed: {error}; '
                  'retrying the same URL and checksum', file=sys.stderr)
            time.sleep(attempt + 1)
        finally:
            if incoming is not None:
                incoming.unlink(missing_ok=True)
