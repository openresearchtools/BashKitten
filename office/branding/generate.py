#!/usr/bin/env python3
"""Regenerate the native Office branding inputs from existing BashKitten art.

This is a maintainer tool, never a build-time download or runtime dependency.
It copies upstream legal documents byte-for-byte and embeds the existing PNG
in SVG wrappers; it does not trace, redraw, or replace the kitten artwork.
"""
# SPDX-License-Identifier: AGPL-3.0-only
import base64
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
UPSTREAM = ROOT / 'office/upstream/online/source'
ART = ROOT / 'browser/bashkitten/browser/branding/content/about-logo@2x.png'
FONT = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
FONT_BOLD = FONT.with_name('DejaVuSans-Bold.ttf')
ENGINE = HERE / 'engine'
ONLINE = HERE / 'online'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    if not path.is_file() or path.read_bytes() != data:
        path.write_bytes(data)


def svg(width, height, content):
    return f'''<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Office, part of BashKitten">
{content}
</svg>
'''


def image(x, y, size, encoded):
    return f'<image x="{x}" y="{y}" width="{size}" height="{size}" xlink:href="data:image/png;base64,{encoded}"/>'


def wordmark(ink, muted, encoded):
    return svg(300, 88, image(0, 0, 88, encoded) + f'''
<text x="100" y="48" fill="{ink}" font-family="system-ui, sans-serif" font-size="44" font-weight="700">Office</text>
<text x="102" y="74" fill="{muted}" font-family="system-ui, sans-serif" font-size="18">BashKitten</text>''')


def main():
    ENGINE.mkdir(parents=True, exist_ok=True)
    (ONLINE / 'images').mkdir(parents=True, exist_ok=True)
    art = ART.read_bytes()
    encoded = base64.b64encode(art).decode('ascii')
    icon = svg(128, 128, image(0, 0, 128, encoded))
    light = wordmark('#10243c', '#5f5f65', encoded)
    dark = wordmark('#f4fbff', '#a6a6aa', encoded)
    assets = {
        'logo.svg': light,
        'logo_inverted.svg': dark,
        'logo-sc.svg': icon,
        'logo-sc_inverted.svg': icon,
        'about.svg': svg(320, 240, image(96, 4, 128, encoded) + '''
<text x="160" y="185" text-anchor="middle" fill="#10243c" font-family="system-ui, sans-serif" font-size="40" font-weight="700">Office</text>
<text x="160" y="218" text-anchor="middle" fill="#5f5f65" font-family="system-ui, sans-serif" font-size="20">BashKitten</text>'''),
    }
    for name, content in assets.items():
        write(ENGINE / name, content)
    for scale, name in [(1, 'intro.png'), (2, 'intro-highres.png')]:
        canvas = Image.new('RGBA', (500 * scale, 200 * scale), '#f3f3f3')
        kitten = Image.open(ART).convert('RGBA')
        kitten.thumbnail((164 * scale, 164 * scale), Image.Resampling.LANCZOS)
        canvas.alpha_composite(kitten, (24 * scale, 18 * scale))
        draw = ImageDraw.Draw(canvas)
        draw.text((212 * scale, 35 * scale), 'Office', fill='#10243c', font=ImageFont.truetype(str(FONT_BOLD), 60 * scale))
        draw.text((216 * scale, 112 * scale), 'BashKitten', fill='#5f5f65', font=ImageFont.truetype(str(FONT), 25 * scale))
        output = io.BytesIO()
        canvas.convert('RGB').save(output, format='PNG', optimize=True)
        write(ENGINE / name, output.getvalue())
    write(ONLINE / 'images/office.svg', icon)
    write(ONLINE / 'images/office-wordmark.svg', light)
    write(ONLINE / 'images/toolbar-bg-logo.svg', light)
    # Native backstage CSS references this resource filename. Override its
    # contents through the supported images directory; keep the resource API.
    write(ONLINE / 'images/collabora-office-white.svg', dark)
    # Office has a light UI regardless of the surrounding browser/OS theme.
    # Retain the existing wordmark while fixing its ink to its own light color.
    wordmark_source = ROOT / 'browser/bashkitten/browser/branding/content/bashkitten-wordmark.svg'
    wordmark_text = wordmark_source.read_text(encoding='utf-8').replace(
        '</style>', '.wordmark { fill: #10243c !important; }\n  </style>')
    write(ONLINE / 'images/bashkitten-wordmark.svg', wordmark_text)
    legal = {
        'branding-attribution.txt': HERE / 'ATTRIBUTION.txt',
        'branding-bashkitten-LICENSE.txt': ROOT / 'LICENSE',
        'branding-artwork-LICENSE.txt': ROOT / 'browser/bashkitten/browser/branding/LICENSE',
        'branding-online-COPYING.txt': UPSTREAM / 'COPYING',
        'branding-engine-COPYING.txt': UPSTREAM / 'engine/COPYING',
        'branding-engine-COPYING.MPL.txt': UPSTREAM / 'engine/COPYING.MPL',
        'branding-engine-COPYING.LGPL.txt': UPSTREAM / 'engine/COPYING.LGPL',
        'branding-engine-NOTICE.txt': UPSTREAM / 'engine/readlicense_oo/license/NOTICE',
        'branding-engine-license.html': UPSTREAM / 'engine/readlicense_oo/license/license.xml',
    }
    provenance = {
        'schema': 1,
        'product': 'Office',
        'upstream': 'Collabora Online with LibreOffice technology',
        'revision': '42745e44dd8530fac7acd5f46cb7571ceea63c6a',
        'release': 'cp-26.04.5-2',
        'artwork': {'path': str(ART.relative_to(ROOT)), 'sha256': sha256(art)},
        'wordmark': {'path': str(wordmark_source.relative_to(ROOT)), 'sha256': sha256(wordmark_source.read_bytes()),
                     'adaptation': 'Fix existing light ink for the native light Office UI'},
        'rasterFonts': {str(font): sha256(font.read_bytes()) for font in (FONT, FONT_BOLD)},
        'legal': {},
    }
    for name, source in legal.items():
        data = source.read_bytes()
        write(ONLINE / name, data)
        provenance['legal'][name] = {'source': str(source.relative_to(ROOT)), 'sha256': sha256(data)}
    write(ONLINE / 'branding-sources.json', json.dumps(provenance, indent=2) + '\n')


if __name__ == '__main__':
    main()
