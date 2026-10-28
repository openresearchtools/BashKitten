"""Select and verify the licensed native Go dependency graph for Quantum."""
import json
import pathlib
import shutil
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent


def configuration(read=None):
    read = read or (lambda relative: (ROOT / relative).read_bytes())
    value = json.loads(read('runtime-go.json'))
    if value.get('schema') != 1:
        raise ValueError('Unsupported native Go dependency selection')
    return value


def select(graph, read=None):
    read = read or (lambda relative: (ROOT / relative).read_bytes())
    config = configuration(read)
    removed = set(config['removeUpstreamModules'])
    found = {entry['name'] for entry in graph['components'] if entry['ecosystem'] == 'go' and entry['name'] in removed}
    if found != removed:
        raise ValueError('Quantum dependency baseline changed; review the native adapter selection')
    additions = json.loads(read(config['additionalSources']))
    if additions.get('schema') != 1:
        raise ValueError('Unsupported licensed native Go source graph')
    selected = [entry for entry in graph['components'] if not (entry['ecosystem'] == 'go' and entry['name'] in removed)]
    selected += additions['components']
    if len({(entry['ecosystem'], entry['name'], entry['version']) for entry in selected}) != len(selected):
        raise ValueError('Duplicate active native dependency')
    return {**graph, 'components': selected, 'adaptation': 'runtime-go.json'}


def prepare(source, components):
    config = configuration()
    for local in config['localModules']:
        entry = next(value for value in components if value['ecosystem'] == 'go' and value['name'] == local['name'] and value['version'] == local['version'])
        target = source / local['target']
        target.mkdir(parents=True, exist_ok=True)
        prefix = entry['name'] + '@' + entry['version'] + '/'
        with zipfile.ZipFile(entry['localArchive']) as archive:
            for member in archive.infolist():
                if not member.filename.startswith(prefix):
                    raise ValueError('Unexpected native module archive prefix')
                relative = pathlib.PurePosixPath(member.filename[len(prefix):])
                if relative.is_absolute() or '..' in relative.parts or ((member.external_attr >> 16) & 0o170000) == 0o120000:
                    raise ValueError('Invalid native module source path')
                if member.is_dir():
                    continue
                filename = target / relative
                filename.parent.mkdir(parents=True, exist_ok=True)
                filename.write_bytes(archive.read(member))
        series = ROOT / local['patchSeries']
        for name in series.read_text().splitlines():
            if name and not name.startswith('#'):
                subprocess.run(['patch', '-p1', '--fuzz=0', '--batch', '-i', str(series.parent / name)], cwd=target, check=True)
    for facade in config['facades']:
        target = source / facade['target']
        files = sorted((ROOT / facade['source']).glob('*.go'))
        if not files:
            raise ValueError('Missing native compatibility facade: ' + facade['source'])
        target.mkdir(parents=True, exist_ok=True)
        for filename in files:
            shutil.copy2(filename, target / filename.name)


def validate_modules(modules):
    config = configuration()
    indexed = {entry['Path']: entry for entry in modules}
    for forbidden in config['forbiddenLinkedModules']:
        if forbidden in indexed:
            raise ValueError('Unlicensed upstream dependency remains active: ' + forbidden)
    for name, version in config['requiredLinkedModules'].items():
        if indexed.get(name, {}).get('Version') != version:
            raise ValueError('Native dependency differs from the selected source: ' + name)
    for local in config['localModules']:
        expected = './' + local['target'].removeprefix('backend/')
        if indexed[local['name']].get('Replace', {}).get('Path') != expected:
            raise ValueError('Native dependency subset was not selected: ' + local['name'])
    return [{key: entry[key] for key in ('Path', 'Version', 'Sum', 'Replace') if key in entry} for entry in modules]


def resolved(go, backend, env, tags):
    # Query the actual platform/build-tag package closure. `go list -m all`
    # expands unrelated upstream test/tool requirements that this build neither
    # imports nor executes, and is not the executable's dependency inventory.
    text = subprocess.check_output([go, 'list', '-mod=readonly', '-deps', '-json', '-tags=' + tags, '.'], cwd=backend, env=env, text=True)
    decoder = json.JSONDecoder()
    modules = {}
    while text.strip():
        entry, end = decoder.raw_decode(text.lstrip())
        if entry.get('Module'):
            modules[entry['Module']['Path']] = entry['Module']
        text = text.lstrip()[end:]
    result = validate_modules(list(modules.values()))
    config = configuration()
    for filename in [backend / 'go.mod', *(backend.parent / entry['target'] / 'go.mod' for entry in config['localModules'])]:
        metadata = json.loads(subprocess.check_output([go, 'mod', 'edit', '-json', str(filename)], cwd=backend, env=env, text=True))
        if any(entry['Path'] in config['forbiddenLinkedModules'] for entry in metadata.get('Require', [])):
            raise ValueError('Unused unlicensed dependency remains in a prepared go.mod')
    # Keep portable provenance, not absolute compiler cache/source paths.
    for entry in result:
        if 'Replace' in entry:
            entry['Replace'] = {key: entry['Replace'][key] for key in ('Path', 'Version', 'Sum') if key in entry['Replace']}
    return result


def linked(go, binary, env):
    info = json.loads(subprocess.check_output([go, 'version', '-m', '-json', str(binary)], env=env, text=True))
    return {'goVersion': info['GoVersion'], 'modules': validate_modules(info['Deps'])}
