#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Stage publisher credentials outside the checkout; never print their contents."""
import base64
import os
from pathlib import Path

encoded = os.environ.get('ANDROID_KEYSTORE_BASE64')
if not encoded:
    if os.environ.get('GITHUB_EVENT_NAME') == 'pull_request':
        raise SystemExit(0)
    raise SystemExit('Publisher signing secrets must be configured')
for name in ('ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'):
    if not os.environ.get(name):
        raise SystemExit('Missing publisher signing field: ' + name)
for name, destination in [('ANDROID_KEYSTORE_BASE64', 'WILDBUZZARD_PUBLISHER_KEYSTORE'),
                          ('LINEAGE_BASE64', 'WILDBUZZARD_SIGNING_LINEAGE')]:
    value = os.environ.get(name)
    if not value:
        continue
    path = Path(os.environ[destination])
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(base64.b64decode(value, validate=True))
print('Publisher signing identity staged')
