#!/usr/bin/env python3
"""Optional LibreOffice smoke test. Does NOT claim Zotero Refresh validation.
Uses Python's standard library, an installed LibreOffice and a private temp profile.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
META = 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0'
TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'


def docx_state(path):
    with ZipFile(path) as archive:
        properties = {
            element.attrib['name']: ''.join(element.itertext())
            for element in ET.fromstring(archive.read('docProps/custom.xml'))
            if element.attrib['name'].startswith('ZOTERO_')
        }
        document = ET.fromstring(archive.read('word/document.xml'))
        bookmarks = [element.attrib[f'{{{W}}}name']
                     for element in document.iter(f'{{{W}}}bookmarkStart')
                     if element.attrib[f'{{{W}}}name'].startswith('ZOTERO_BREF_')]
        return properties, bookmarks


def odt_state(path):
    with ZipFile(path) as archive:
        properties = {
            element.attrib[f'{{{META}}}name']: ''.join(element.itertext())
            for element in ET.fromstring(archive.read('meta.xml')).iter(f'{{{META}}}user-defined')
            if element.attrib[f'{{{META}}}name'].startswith('ZOTERO_')
        }
        document = ET.fromstring(archive.read('content.xml'))
        bookmarks = [element.attrib[f'{{{TEXT}}}name']
                     for element in document.iter(f'{{{TEXT}}}bookmark-start')
                     if element.attrib[f'{{{TEXT}}}name'].startswith('ZOTERO_BREF_')]
        return properties, bookmarks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('docx', type=Path, help='Bookmark-mode V3 DOCX to verify')
    args = parser.parse_args()
    source = args.docx.resolve(strict=True)
    executable = shutil.which('libreoffice') or shutil.which('soffice')
    if not executable:
        parser.error('Install LibreOffice for this optional check; it is not a core dependency.')
    original = docx_state(source)
    if not original[0] or not original[1]:
        parser.error('Input must contain Zotero bookmark citations; Word-field mode is not this test.')
    with tempfile.TemporaryDirectory(prefix='sr-office-') as temporary:
        root = Path(temporary)
        for format_name in ('docx', 'odt', 'pdf'):
            output = root / format_name
            output.mkdir()
            process = subprocess.run([
                executable, f'-env:UserInstallation={(root / "profile").as_uri()}',
                '--headless', '--convert-to', format_name, '--outdir', str(output), str(source),
            ], capture_output=True, text=True, timeout=90, check=True)
            converted = output / f'{source.stem}.{format_name}'
            if not converted.is_file() or converted.stat().st_size == 0:
                raise RuntimeError(f'LibreOffice produced no {format_name}: {process.stdout} {process.stderr}')
            if format_name != 'pdf':
                after = docx_state(converted) if format_name == 'docx' else odt_state(converted)
                if original != after:
                    raise RuntimeError(f'Zotero properties/bookmarks changed in {format_name} conversion')
        print(json.dumps({
            'passed': True, 'zoteroProperties': len(original[0]), 'liveBookmarks': len(original[1]),
            'checks': ['DOCX re-save', 'ODT conversion', 'PDF export'],
            'zoteroRefreshTested': False,
        }, indent=2))


if __name__ == '__main__':
    main()
