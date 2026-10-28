# SPDX-License-Identifier: AGPL-3.0-only
"""Files-specific cross flags; compiler validation stays with the Termux owner."""
import hashlib, importlib.util, json, pathlib, re, shlex, subprocess, sys, tarfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
PREFIX = '/data/data/com.termux/files/usr'
sys.path.insert(0, str(ROOT/'agent/packaging'))
import source_cache

def recipe_archive(args):
    pin = json.loads((ROOT/'agent/packaging/node/lock.json').read_text())['termux']
    previous = ROOT/'agent/vendor/node'/(pin['recipes']['sha256']+'-'+pin['recipe_commit'])
    return source_cache.fetch(pin['recipes'], getattr(args, 'source_cache', None),
                              local=previous if previous.is_file() else None,
                              offline=getattr(args, 'offline_sources', False))

def environment(args, work, sources):
    spec = importlib.util.spec_from_file_location('bashkitten_native_toolchain', ROOT/'agent/packaging/termux/native_toolchain.py')
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    args.work = work
    env, provenance = owner.build_environment(args)
    pin = json.loads((ROOT/'agent/packaging/node/lock.json').read_text())['termux']
    archive = recipe_archive(args)
    # Reuse the selected native Termux recipes' missing platform adaptations.
    # Shared-library/Python packaging patches are irrelevant to our static libs.
    selected = {'mupdf':['no-sigsetjmp.patch','tmpdir.patch'], 'ffmpeg':['libavutil-file_open.c.patch']}
    patches = []
    with tarfile.open(archive) as upstream:
        for component, names in selected.items():
            for name in names:
                member = next(m for m in upstream.getmembers() if m.name.endswith('/packages/'+component+'/'+name))
                raw = upstream.extractfile(member).read()
                patches.append({'name':component+'/'+name,'sha256':hashlib.sha256(raw).hexdigest()})
                marker = sources[component]/('.bashkitten-'+name+'.sha256')
                if marker.exists():
                    if marker.read_text() != patches[-1]['sha256']: raise ValueError('Changed native patch requires a fresh work directory')
                    continue
                subprocess.run(['patch','--batch','--fuzz=0','-p1'],cwd=sources[component],input=raw.decode().replace('@TERMUX_PREFIX@',PREFIX),text=True,check=True)
                marker.write_text(patches[-1]['sha256'])
        provenance['frameworkLicense'] = next(m.name for m in upstream.getmembers() if m.name.count('/') == 1 and pathlib.PurePosixPath(m.name).name.lower().startswith('license'))
    provenance['recipes'] = {**pin['recipes'],'commit':pin['recipe_commit'],'patches':patches}
    env.update({'GOOS':'android','GOARCH':{'aarch64':'arm64','x86_64':'amd64'}[args.architecture]})
    return env, provenance

def meson_file(work, env, architecture):
    cpu = {'aarch64':'aarch64','x86_64':'x86_64'}[architecture]
    filename = work/'dav1d-cross.ini'
    lines = ['[binaries]']
    for key, variable in [('c','CC'),('cpp','CXX'),('ar','AR'),('strip','STRIP')]: lines.append(key+' = '+repr(shlex.split(env[variable])))
    lines += ["pkg-config = 'pkg-config'", '[host_machine]', "system = 'android'", 'cpu_family = '+repr(cpu), 'cpu = '+repr(cpu), "endian = 'little'", '[properties]', 'needs_exe_wrapper = true']
    filename.write_text('\n'.join(lines)+'\n'); return filename

def metadata(payload, args, provenance):
    needed = set(); readelf = args.ndk/'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'
    for binary in (payload/'bin').iterdir():
        with binary.open('rb') as stream: header = stream.read(20)
        if header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20],'little') != {'aarch64':183,'x86_64':62}[args.architecture]: raise ValueError('Wrong native Bionic architecture: '+binary.name)
        dynamic = subprocess.check_output([readelf,'-d',binary],text=True)
        needed.update(re.findall(r'\(NEEDED\).*\[([^]]+)\]',dynamic))
        program = subprocess.check_output([readelf,'-l',binary],text=True)
        if '/system/bin/linker64' not in program: raise ValueError('Native Bionic executable must use Android linker64: '+binary.name)
        if 'GLIBC_' in subprocess.check_output([readelf,'--version-info',binary],text=True): raise ValueError('Host glibc leaked into Bionic output')
    public = args.ndk/'toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib'/(args.architecture+'-linux-android')/'28'
    missing = needed - {p.name for p in public.glob('*.so')}
    if missing: raise ValueError('Unresolved Bionic dependencies: '+', '.join(sorted(missing)))
    return [], {'baseline':'Android API 28, native Bionic','needed':sorted(needed),'toolchain':provenance}

def notices(args, provenance):
    result = [{'name':'Android NDK runtime','version':'r30','source':provenance['pin']['url'],'license':provenance['pin']['license'],'text':'\n\n'.join((args.ndk/name).read_text() for name in ['NOTICE','NOTICE.toolchain'])}]
    archive = recipe_archive(args)
    with tarfile.open(archive) as upstream: text = upstream.extractfile(provenance['frameworkLicense']).read().decode()
    result.append({'name':'Termux native media adaptations','version':provenance['recipes']['commit'],'source':provenance['recipes']['url'],'text':text})
    return result
