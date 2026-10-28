#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Use and verify the pinned engine/Online native branding facilities."""
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
BRANDING = ROOT / 'office/branding'
PRODUCT = 'Office'
VENDOR = 'BashKitten'
PRODUCT_URL = 'https://github.com/openresearchtools/BashKitten'
ENGINE_IMAGES = ['intro.png', 'intro-highres.png', 'logo.svg', 'logo_inverted.svg',
                 'logo-sc.svg', 'logo-sc_inverted.svg', 'about.svg']
ONLINE_FILES = ['branding.js', 'branding.css', 'images/toolbar-bg-logo.svg',
                'branding-sources.json', 'branding-bashkitten-LICENSE.txt']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    # Both native builds silently retain donor assets when inputs are absent.
    # Refuse incomplete branding before configure or packaging can do that.
    required = ['ATTRIBUTION.txt', *('engine/' + name for name in ENGINE_IMAGES),
                *('online/' + name for name in ONLINE_FILES)]
    for name in required:
        path = BRANDING / name
        if not path.is_file() or not path.stat().st_size:
            raise ValueError('Missing Office branding input: ' + name)
    attribution = (BRANDING / 'ATTRIBUTION.txt').read_text()
    if 'BashKitten integrated Office built on Collabora Online' not in attribution or 'LibreOffice' not in attribution:
        raise ValueError('Office integration attribution must identify Collabora Online and LibreOffice')
    provenance = json.loads((BRANDING / 'online/branding-sources.json').read_text())
    pin = json.loads((ROOT / 'office/upstream/online/source.json').read_text())
    if provenance.get('product') != PRODUCT or provenance.get('revision') != pin['commit']:
        raise ValueError('Office branding provenance differs from the native source pin')
    for key in ['artwork', 'wordmark']:
        row = provenance[key]
        original = ROOT / row['path']
        if not original.resolve().is_relative_to(ROOT.resolve()) or digest(original) != row['sha256']:
            raise ValueError('Office branding artwork provenance differs: ' + key)
    for name, row in provenance['legal'].items():
        original = ROOT / row['source']
        copied = BRANDING / 'online' / name
        if (Path(name).name != name or not original.resolve().is_relative_to(ROOT.resolve())
                or digest(original) != row['sha256'] or digest(copied) != row['sha256']):
            raise ValueError('Office branding legal text differs from its retained source: ' + name)
    records = []
    for path in sorted(BRANDING.rglob('*')):
        if path.is_symlink():
            raise ValueError('Office branding inputs must be ordinary retained files')
        if path.is_file():
            records.append({'file': str(path.relative_to(ROOT)), 'sha256': digest(path)})
    return records


def engine_options():
    inputs()
    return ['--with-product-name=' + PRODUCT, '--with-vendor=' + VENDOR,
            '--with-branding=' + str(BRANDING / 'engine')]


def online_options():
    inputs()
    return ['--with-app-name=' + PRODUCT, '--with-vendor=' + VENDOR,
            '--with-info-url=' + PRODUCT_URL,
            '--with-app-branding=' + str(BRANDING / 'online')]


def make_value(path, key):
    match = re.search(r'^(?:export )?' + re.escape(key) + r'[ \t]*=[ \t]*(.*?)[ \t]*$', path.read_text(), re.M)
    if not match:
        raise ValueError('Native branding configuration lacks ' + key + ': ' + str(path))
    return match.group(1)


def verify_engine(source):
    inputs()
    config = source / 'engine/config_host.mk'
    expected = {'PRODUCTNAME': PRODUCT, 'OOO_VENDOR': VENDOR,
                'CUSTOM_BRAND_DIR': str(BRANDING / 'engine'), 'DEFAULT_BRAND_IMAGES': ''}
    for key, value in expected.items():
        if make_value(config, key) != value:
            raise ValueError('Native engine Office branding mismatch: ' + key)
    if set(make_value(config, 'CUSTOM_BRAND_IMAGES').split()) != set(ENGINE_IMAGES):
        raise ValueError('Native engine branding is incomplete')


def verify_online(source):
    inputs()
    for config in [source / 'Makefile', source / 'browser/Makefile']:
        for key, value in {'APP_NAME': PRODUCT, 'VENDOR': VENDOR, 'INFO_URL': PRODUCT_URL,
                           'APP_HAS_BRANDING': 'true',
                           'APP_BRANDING_DIR': str(BRANDING / 'online')}.items():
            if make_value(config, key) != value:
                raise ValueError('Native Online Office branding mismatch: ' + key)


def verify_runtime(runtime):
    """Check installed native outputs, so packaging cannot bless a stale build."""
    inputs()
    version = runtime / 'engine/program/versionrc'
    if not re.search(r'^Vendor=' + re.escape(VENDOR) + r'$', version.read_text(), re.M):
        raise ValueError('Installed native engine has a different vendor')
    name_key = '{http://openoffice.org/2001/registry}name'
    registry = ET.parse(runtime / 'engine/share/registry/main.xcd').getroot()
    products = [node for component in registry if component.get(name_key) == 'Setup'
                for node in component.findall('node') if node.get(name_key) == 'Product']
    if len(products) != 1:
        raise ValueError('Installed native engine product registry is missing or ambiguous')
    product = {prop.get(name_key): prop.findtext('value') for prop in products[0].findall('prop')}
    if product.get('ooName') != PRODUCT or product.get('ooVendor') != VENDOR:
        raise ValueError('Installed native engine product registry has a different identity')
    for name in ENGINE_IMAGES:
        directory = 'program' if name.startswith('intro') else 'program/shell'
        installed = runtime / 'engine' / directory / name
        if not installed.is_file() or digest(installed) != digest(BRANDING / 'engine' / name):
            raise ValueError('Installed native engine branding differs: ' + name)
    web = runtime / 'share/coolwsd/browser/dist'
    for path in sorted((BRANDING / 'online').rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(BRANDING / 'online')
        if path.parent == BRANDING / 'online' and path.name.startswith('branding'):
            installed = web / relative
        elif path.parent == BRANDING / 'online/images' and path.suffix == '.svg':
            installed = web / relative
        else:
            continue
        if not installed.is_file() or digest(installed) != digest(path):
            raise ValueError('Installed native Online branding differs: ' + str(relative))
    if digest(web / 'images/toolbar-bg.svg') != digest(BRANDING / 'online/images/toolbar-bg-logo.svg'):
        raise ValueError('Installed native toolbar branding differs')


def metadata():
    return {'productName': PRODUCT, 'vendor': VENDOR, 'productURL': PRODUCT_URL,
            'attribution': (BRANDING / 'ATTRIBUTION.txt').read_text(), 'inputs': inputs()}
