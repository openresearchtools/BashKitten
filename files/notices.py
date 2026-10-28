"""Build the shared native license inventory from pinned original notice bytes."""
import hashlib
import io
import json
import pathlib
import shutil
import tarfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
REPOSITORY = ROOT.parent
SUPPLEMENTS = ROOT / 'vendor/dependencies/notice-sources.json'


def source_inputs():
    mapping = json.loads(SUPPLEMENTS.read_text())
    if mapping.get('schema') != 1:
        raise ValueError('Unsupported native notice inventory')
    paths = set()
    for entry in mapping['components'].values():
        paths.update(entry.get('provenanceFiles', []))
        paths.update(source['file'] for source in entry['sources'] if 'file' in source)
    for name in paths:
        resolved = (REPOSITORY / name).resolve()
        if pathlib.Path(name).is_absolute() or not resolved.is_relative_to(REPOSITORY):
            raise ValueError('Notice source leaves the repository: ' + name)
    return sorted(paths)


def component_key(entry):
    return entry['ecosystem'] + ':' + entry['name'] + '@' + entry['version']


def archive_members(entry, members):
    data = pathlib.Path(entry['localArchive']).read_bytes()
    if entry['ecosystem'] == 'go':
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return {member: archive.read(member) for member in members}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        return {member: archive.extractfile(member).read() for member in members}


def collect(components):
    mapping = json.loads(SUPPLEMENTS.read_text())['components']
    indexed = {component_key(entry): entry for entry in components}
    selected = {key: set(entry['notices']) for key, entry in indexed.items()}
    for supplement in mapping.values():
        for source in supplement.get('sources', []):
            if 'component' in source:
                selected[source['component']].add(source['member'])
    extracted = {key: archive_members(indexed[key], members) for key, members in selected.items() if members}
    records = []
    missing = []
    for entry in components:
        key = component_key(entry)
        notices = [(pathlib.PurePosixPath(member).name, extracted[key][member]) for member in entry['notices']]
        supplement = mapping.get(key, {})
        declaration = supplement.get('declaredLicense')
        if declaration:
            metadata = json.loads(extracted[key][declaration['member']])
            if entry['ecosystem'] != 'npm' or metadata.get('name') != entry['name'] or metadata.get('version') != entry['version'] or metadata.get('license') != declaration['identifier'] or supplement.get('license') != declaration['identifier']:
                raise ValueError('Canonical license text lacks an exact published declaration: ' + key)
        for source in supplement.get('sources', []):
            if 'component' in source:
                data = extracted[source['component']][source['member']]
                name = pathlib.PurePosixPath(source['member']).name
            else:
                filename = REPOSITORY / source['file']
                data, name = filename.read_bytes(), filename.name
            if hashlib.sha256(data).hexdigest() != source['sha256']:
                raise ValueError('Pinned notice checksum changed: ' + key)
            notices.append((name, data))
        text = []
        for name, data in notices:
            try:
                value = data.decode('utf-8')
            except UnicodeDecodeError:
                value = data.decode('latin1')
            if not value.strip() or '\0' in value:
                raise ValueError('Missing or invalid notice text: ' + key + '/' + name)
            text.append(value)
        if not text:
            missing.append(key)
        if declaration:
            text.insert(0, 'Declared SPDX license evidence: this exact published package metadata declares ' + declaration['identifier'] + '. No standalone full upstream license file was present at this pin. The original metadata and canonical SPDX license template follow; copyright placeholders are preserved verbatim, without invented attribution.')
        records.append({'name': entry['name'], 'version': entry['version'], 'source': entry['url'],
                        'license': supplement.get('license') or entry.get('license') or 'See included license text',
                        'text': '\n\n'.join(text), 'noticeEvidence': {'kind': 'declared-spdx' if declaration else 'upstream', 'reason': supplement.get('reason'), 'sources': supplement.get('sources', [])}, '_notices': notices})
    if missing:
        raise ValueError('Missing full license text; native artifacts cannot be sealed: ' + ', '.join(missing))
    return records


def write(payload, records):
    result = []
    for record in records:
        target = payload / 'legal' / (record['name'] + '@' + record['version']).replace('/', '__').replace(':', '_')
        target.mkdir(parents=True, exist_ok=True)
        for index, (name, data) in enumerate(record['_notices']):
            (target / (str(index) + '-' + name)).write_bytes(data)
        result.append({key: value for key, value in record.items() if key != '_notices'})
    for source in source_inputs():
        target = payload / 'sources/legal' / source
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPOSITORY / source, target)
    return result
