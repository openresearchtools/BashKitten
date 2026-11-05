# SPDX-License-Identifier: AGPL-3.0-only
"""Resolve reviewed Maven notice URLs to pinned, offline full license texts."""
import hashlib
import json
import re
from pathlib import Path


def validate_text(name, text):
    value = text.strip()
    if (not value or re.fullmatch(r'https?://\S+', value) or
            re.match(r'^(?:404[: ]|403[: ]|Not Found\b|<html\b|<!doctype html)', value, re.I)):
        raise ValueError('Missing full license text: ' + name)
    return value


class MavenNotices:
    def __init__(self, directory, dependencies):
        self.directory = Path(directory)
        data = json.loads((self.directory / 'sources.json').read_text())
        actual = sorted({':'.join(x[k] for k in ('group', 'name', 'version'))
                         for x in json.loads(Path(dependencies).read_text())})
        if actual != data['dependencies']:
            raise ValueError('Android dependencies changed; review the pinned offline license notices')
        self.texts = {}
        for key, item in data['texts'].items():
            self.texts[key] = self.read_verified(item)
        for item in data['inputs']:
            self.read_verified(item)
        self.entries = {}
        for entry in data['entries']:
            for item in entry['poms']:
                self.read_verified(item)
            key = (entry['name'], entry['url'])
            if key in self.entries:
                raise ValueError('Duplicate Maven notice resolution: ' + repr(key))
            self.entries[key] = entry

    def read_verified(self, item):
        path = Path(item['file'])
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Invalid notice path: ' + str(path))
        value = (self.directory / path).read_bytes()
        if hashlib.sha256(value).hexdigest() != item['sha256']:
            raise ValueError('Notice input checksum mismatch: ' + str(path))
        return value.decode('utf-8')

    def resolve(self, name, text):
        value = text.strip()
        if not re.fullmatch(r'https?://\S+', value):
            return validate_text(name, value)
        entry = self.entries.get((name, value))
        if entry is None:
            raise ValueError('Unreviewed Maven license URL: ' + name + ' / ' + value)
        body = '\n\n'.join(self.texts[key] for key in entry['texts'])
        validate_text(name, body)
        return ('Components: ' + ', '.join(entry['components']) + '\n'
                'Declared licenses: ' + '; '.join(entry['declarations']) + '\n'
                'Original license reference: ' + value + '\n\n' + body)


def native_source_notices(directory):
    """Preserve legal files and legal source preambles, including nested donors."""
    directory = Path(directory)
    records = []
    seen = set()
    for path in sorted(directory.rglob('*')):
        if not path.is_file():
            continue
        if re.match(r'^(licen[cs]e|copying|notice|copyright|ftl|gpl|patents)([._-]|$)', path.name, re.I):
            text = path.read_text(encoding='utf-8')
        elif path.suffix.lower() in {'.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.s', '.y', '.java', '.kt'}:
            # Include consecutive leading comments only, never implementation.
            # .S/.s assembly and Bison .y inputs carry grants just like C sources.
            data = path.read_bytes()
            try:
                source = data.decode('utf-8')
            except UnicodeDecodeError:
                # The pinned Xorg donors retain ISO-8859-1 author names.
                source = data.decode('iso-8859-1')
            source = source.lstrip('\ufeff \t\r\n')
            match = re.match(r'(?:(?:/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))\s*)+', source)
            text = match.group() if match else ''
            if not re.search(r'copyright|permission is hereby|redistribution and use', text, re.I):
                continue
        else:
            continue
        if text.strip() and text not in seen:
            seen.add(text)
            records.append(str(path.relative_to(directory)) + '\n\n' + text)
    if not records:
        raise ValueError('Missing native source notices: ' + str(directory))
    return '\n\n'.join(records)
