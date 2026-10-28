#!/usr/bin/env python3
"""Pinned-source preparation and offline Files build. Never edits pristine imports."""
import argparse, hashlib, io, json, os, pathlib, platform, re, shutil, subprocess, sys, tarfile, zipfile
import notices
import go_runtime
ROOT = pathlib.Path(__file__).resolve().parent
DEPS = ROOT / 'vendor/dependencies'
sys.path.insert(0, str(ROOT.parent / 'agent/packaging'))
import source_cache
def sha(data): return hashlib.sha256(data).hexdigest()
def run(argv, cwd, env=None):
    print('+', ' '.join(map(str, argv)), flush=True)
    subprocess.run(list(map(str, argv)), cwd=cwd, env=env, check=True)
def source_archive(record, url, args, local=None):
    # Historical part names remain provenance only. Fetch the exact complete
    # upstream object; never rebuild or substitute a different release archive.
    if local is None or not local.is_file():
        parts = record.get('parts', [])
        if len(parts) == 1 and parts[0]['sha256'] == record['sha256']:
            local = DEPS / parts[0]['file']
    return source_cache.fetch({'url':url, 'sha256':record['sha256'], **({'size':record['size']} if 'size' in record else {})},
                              args.source_cache, local=local if local and local.is_file() else None, offline=args.offline_sources)
def tar_extract(data, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        archive.extractall(destination, filter='data')
        roots = {pathlib.PurePosixPath(member.name).parts[0] for member in archive.getmembers() if member.name and member.name != '.'}
    if len(roots) != 1: raise ValueError('Source archive must have one root')
    return destination / roots.pop()
def write_json(filename, value): filename.write_text(json.dumps(value, indent=2) + '\n')
def safe_component(value): return value.replace('/', '__').replace(':', '_')
def input_state(paths):
    tree = subprocess.check_output(['git','ls-tree','HEAD','--',*paths],cwd=ROOT.parent,text=True)
    dirty = subprocess.check_output(['git','status','--porcelain','--',*paths],cwd=ROOT.parent,text=True).strip()
    return tree, dirty
def linux_metadata(payload, work, architecture):
    system = dict(line.split('=', 1) for line in pathlib.Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if system.get('ID', '').strip('"') != 'ubuntu' or system.get('VERSION_ID', '').strip('"') != '24.04':
        raise ValueError('Accepted Linux artifacts require the controlled Ubuntu 24.04 baseline')
    binaries = list((payload/'bin').iterdir()); needed = set(); versions = set()
    for binary in binaries:
        header = binary.read_bytes()[:20]
        if header[:4] != b'\x7fELF' or header[4:6] != b'\x02\x01' or int.from_bytes(header[18:20], 'little') != {'amd64':62,'arm64':183}[architecture]:
            raise ValueError('Wrong native architecture: ' + binary.name)
        dynamic = subprocess.check_output(['readelf', '-d', binary], text=True)
        needed.update(re.findall(r'\(NEEDED\).*\[([^]]+)\]', dynamic))
        versions.update(re.findall(r'GLIBC_([0-9]+\.[0-9]+)', subprocess.check_output(['readelf', '--version-info', binary], text=True)))
    dependency_work = work/'dependencies'; (dependency_work/'debian').mkdir(parents=True, exist_ok=True)
    (dependency_work/'debian/control').write_text('Source: bashkitten-files\nSection: utils\nPriority: optional\nMaintainer: Open Research Tools <openresearchtools@gmail.com>\n\nPackage: bashkitten-files\nArchitecture: any\nDescription: private native Files component\n')
    result = subprocess.check_output(['dpkg-shlibdeps', '-O', *('-e'+str(binary) for binary in binaries)], cwd=dependency_work, text=True)
    depends = result.strip().removeprefix('shlibs:Depends=').split(', ')
    if not depends or not any(value.startswith('libc6') for value in depends): raise ValueError('Missing native OS dependency inventory')
    return sorted(set(depends)), {'baseline':'Ubuntu 24.04','needed':sorted(needed),'maximumGlibc':max(versions,key=lambda v:tuple(map(int,v.split('.')))) if versions else None}
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path)
    parser.add_argument('--target', choices=['linux', 'termux'], default='linux')
    parser.add_argument('--architecture', choices=['amd64', 'arm64', 'aarch64', 'x86_64'], default={'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine()))
    parser.add_argument('--ndk', type=pathlib.Path)
    parser.add_argument('--ndk-archive', type=pathlib.Path)
    parser.add_argument('--go', default='go')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--source-cache', type=pathlib.Path, help='External verified original-source cache (or BASHKITTEN_SOURCE_CACHE)')
    parser.add_argument('--offline-sources', action='store_true', help='Require every pinned source in the cache or an existing verified local archive')
    args = parser.parse_args(); work = args.work_dir.resolve(); work.mkdir(parents=True, exist_ok=True)
    if work == ROOT or ROOT in work.parents: raise ValueError('Build work must stay outside the source module')
    args.source_cache = (args.source_cache or source_cache.default_cache()).expanduser().resolve()
    if args.source_cache == ROOT.parent or ROOT.parent in args.source_cache.parents: raise ValueError('Source cache must stay outside the repository')
    if args.target == 'linux' and args.architecture != {'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine()): raise ValueError('Linux builds require the native runner architecture')
    if args.target == 'termux' and (args.architecture not in ['aarch64','x86_64'] or not args.ndk): raise ValueError('Termux requires --architecture aarch64|x86_64 and the pinned --ndk')
    inputs = ['files','auth/dependencies/go-toolchain','agent/packaging/source_cache.py',*notices.source_inputs()]
    if args.target == 'termux': inputs += ['agent/packaging/termux/native_toolchain.py','agent/packaging/node/lock.json','agent/vendor/node/libcxx']
    source_tree, source_dirty = input_state(inputs)
    if not args.prepare_only:
        identity = {'target':args.target,'architecture':args.architecture}
        stamp = work/'build-target.json'
        if stamp.exists() and json.loads(stamp.read_text()) != identity: raise ValueError('A work directory cannot mix native target architectures')
        write_json(stamp, identity)
    graph = go_runtime.select(json.loads((DEPS/'sources.json').read_text())); native = json.loads((DEPS/'native-sources.json').read_text())
    for name, expected in graph['inputHashes'].items():
        if sha((ROOT/name).read_bytes()) != expected: raise ValueError('Dependency lock changed: '+name)
    archives = work/'archives'; archives.mkdir(exist_ok=True); proxy = work/'goproxy'; proxy.mkdir(exist_ok=True)
    npm_archives = []; all_components = graph['components'] + native['components']
    for entry in all_components:
        previous = archives / (entry.get('filename') or (safe_component(entry['name'])+'@'+entry['version']+('.zip' if entry['ecosystem']=='go' else '.tgz')))
        destination = source_archive(entry['archive'], entry['url'], args, previous if previous.is_file() else None)
        entry['localArchive'] = str(destination)
        if entry['ecosystem'] == 'go':
            relative = entry['url'].split('https://proxy.golang.org/',1)[1]; target = proxy/relative; target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(destination, target)
            for key, extension in [('info','.info'),('goMod','.mod')]:
                metadata = source_archive(entry[key], entry['url'].removesuffix('.zip') + extension, args, target.with_suffix(extension))
                shutil.copyfile(metadata, target.with_suffix(extension))
        elif entry['ecosystem'] == 'npm': npm_archives.append(destination)
    go_source = ROOT.parent/'auth/dependencies/go-toolchain'; go_pin = json.loads((go_source/'sources.json').read_text())
    go_archive = source_cache.fetch(go_pin, args.source_cache, local=go_source/go_pin['file'], offline=args.offline_sources)
    if args.target == 'termux':
        import termux
        termux.recipe_archive(args)
    source = work/'quantum'
    if source.exists(): shutil.rmtree(source)
    shutil.copytree(ROOT/'vendor/quantum/source', source)
    for name in (ROOT/'patches/quantum/series').read_text().splitlines():
        if name and not name.startswith('#'): run(['patch','-p1','--fuzz=0','--batch','-i',ROOT/'patches/quantum'/name], source)
    go_runtime.prepare(source, graph['components'])
    source_dirs = {}
    for entry in native['components']:
        if entry['role'] in ('runtime-source','native-build-tool-source'):
            directory = work/'native'/entry['name']; marker = directory/'.archive-sha256'
            if not marker.exists() or marker.read_text() != entry['archive']['sha256']:
                if directory.exists(): shutil.rmtree(directory)
                extracted = tar_extract(pathlib.Path(entry['localArchive']).read_bytes(), directory)
                marker.write_text(entry['archive']['sha256'])
            else: extracted = next(p for p in directory.iterdir() if p.is_dir())
            source_dirs[entry['name']] = extracted
    write_json(work/'prepared.json', {'schema':1,'sourceDirectories':{k:str(v) for k,v in source_dirs.items()},'components':len(all_components)})
    if args.prepare_only: return
    if not args.output: raise ValueError('--output is required for a native build')
    # Fail before native compilation, rather than leave final package assembly
    # to discover a dependency whose complete original notices are absent.
    legal_records = notices.collect(all_components)
    host_env = dict(os.environ); env = dict(host_env); toolchain = None
    if args.target == 'termux':
        import termux
        env, toolchain = termux.environment(args, work, source_dirs)
    env.update({'GOPROXY':proxy.as_uri(),'GOSUMDB':'off','GOTOOLCHAIN':'local','GOMODCACHE':str(work/'gomodcache'),'CGO_ENABLED':'1','GOTELEMETRY':'off','GOMAXPROCS':str(max(1,args.jobs))})
    version = subprocess.check_output([args.go,'version'],env=env,text=True)
    if version.split()[2] != 'go'+go_pin['version']: raise ValueError('Go compiler must match retained release '+go_pin['version'])
    prefix = work/'prefix'; prefix.mkdir(exist_ok=True)
    env['PATH'] = str(prefix/'bin') + os.pathsep + env['PATH']; env['PKG_CONFIG_PATH'] = str(prefix/'lib/pkgconfig')
    env['PKG_CONFIG_LIBDIR'] = str(prefix/'lib/pkgconfig')
    jobs = str(max(1,args.jobs))
    if args.architecture in ['amd64','x86_64']:
        nasm = source_dirs['nasm']; run(['./configure','--prefix='+str(prefix)],nasm,host_env); run(['make','-j'+jobs],nasm,host_env); run(['make','install'],nasm,host_env)
    mupdf = source_dirs['mupdf']
    run(['make','-j'+jobs,'build=release','USE_SYSTEM_LIBS=no','HAVE_X11=no','HAVE_GLUT=no','HAVE_OBJC=no','HAVE_LIBCRYPTO=no',*(['HAVE_OBJCOPY=no','XCFLAGS=-fPIC'] if toolchain else []),'libs'],mupdf,env)
    zlib = mupdf/'thirdparty/zlib'; run(['./configure','--static','--prefix='+str(prefix)],zlib,env); run(['make','-j'+jobs,'libz.a'],zlib,env); run(['make','install-libs'],zlib,env)
    dav1d = source_dirs['dav1d']
    # Meson remembers its source directory; a release update requires a new one.
    davpin = next(e for e in native['components'] if e['name']=='dav1d')
    davbuild = work/('dav1d-build-'+davpin['version']+'-'+davpin['archive']['sha256'][:12])
    if not davbuild.exists(): run(['meson','setup',davbuild,'--prefix='+str(prefix),'--libdir=lib','--default-library=static','--buildtype=release','-Denable_tools=false','-Denable_tests=false',*(['--cross-file',termux.meson_file(work,env,args.architecture)] if toolchain else [])],dav1d,env)
    run(['meson','compile','-C',davbuild,'-j',jobs],dav1d,env); run(['meson','install','-C',davbuild],dav1d,env)
    ffmpeg = source_dirs['ffmpeg']; flags = ['--prefix='+str(prefix),'--disable-autodetect','--disable-shared','--enable-static','--disable-doc','--disable-debug','--disable-network','--enable-pthreads','--enable-zlib','--enable-libdav1d','--pkg-config-flags=--static','--extra-cflags=-I'+str(prefix/'include'),'--extra-ldflags=-L'+str(prefix/'lib')]
    if toolchain: flags += ['--enable-cross-compile','--target-os=android','--arch='+args.architecture,'--cc='+env['CC'],'--cxx='+env['CXX'],'--ar='+env['AR'],'--nm='+env['NM'],'--ranlib='+env['RANLIB'],'--strip='+env['STRIP'],'--extra-cflags='+env['CFLAGS'],'--extra-ldflags='+env['LDFLAGS']]
    run(['./configure',*flags],ffmpeg,env); run(['make','-j'+jobs,'ffmpeg','ffprobe'],ffmpeg,env)
    npmcache = work/'npmcache'
    for offset in range(0,len(npm_archives),50): run(['npm','cache','add','--cache',npmcache,'--offline','--ignore-scripts',*npm_archives[offset:offset+50]],work,env)
    run(['npm','ci','--cache',npmcache,'--offline','--ignore-scripts','--no-audit','--no-fund'],source/'frontend',env); shutil.copytree(source/'frontend/node_modules/ace-builds/src-min-noconflict',source/'frontend/public/ace',dirs_exist_ok=True); run(['npm','run','build'],source/'frontend',env)
    include = source/'backend/internal/preview/gofitzinclude'; include.symlink_to(mupdf/'include')
    env['CGO_CFLAGS'] = '-I'+str(mupdf/'include'); env['CGO_LDFLAGS'] = '-L'+str(mupdf/'build/release')+' -lmupdf -lmupdf-third -lm '+(env['LDFLAGS']+' -lc++_static -lc++abi -llog' if toolchain else '-lpthread -lstdc++')
    payload = work/'payload';
    if payload.exists(): shutil.rmtree(payload)
    (payload/'bin').mkdir(parents=True)
    native_version = 'github.com/gtsteffaniak/filebrowser/backend/internal/version'
    ldflags = '-s -w -X '+native_version+'.Version=2.0.2-stable+bashkitten -X '+native_version+'.CommitSHA=2c071d1e6eb48d4b88da2657885d345663a0a88b'
    tags = 'mupdf,extlib,static'+(',cgosql' if toolchain else '')
    prepared_modules = go_runtime.resolved(args.go, source/'backend', env, tags)
    run([args.go,'build','-mod=readonly','-trimpath','-tags='+tags,'-ldflags='+ldflags,'-o',payload/'bin/filebrowser','.'],source/'backend',env)
    linked_modules = go_runtime.linked(args.go, payload/'bin/filebrowser', env)
    addon = work/'addon';
    if addon.exists(): shutil.rmtree(addon)
    shutil.copytree(ROOT/'addon',addon)
    clean_env = dict(env); clean_env.pop('CGO_CFLAGS');clean_env.pop('CGO_LDFLAGS')
    run([args.go,'build','-mod=vendor','-trimpath','-ldflags=-s -w','-o',payload/'bin/files-office-addon','.'],addon,clean_env)
    for name in ['ffmpeg','ffprobe']: shutil.copy2(ffmpeg/name,payload/'bin'/name)
    licenses = notices.write(payload, legal_records)
    shutil.copy2(ROOT/'vendor/quantum/source/LICENSE',payload/'legal/Quantum-LICENSE')
    for name in ['COPYING','LICENSE','NOTICE']: shutil.copy2(ROOT/'addon'/name,payload/'legal'/('addon-'+name))
    licenses.extend([{'name':'File Browser Quantum','version':'2.0.2-stable','license':'Apache-2.0','text':(payload/'legal/Quantum-LICENSE').read_text()}, {'name':'BashKitten Files adapters and Office add-on','license':'AGPL-3.0-only AND Apache-2.0 AND MIT','text':'\n\n'.join((ROOT/'addon'/name).read_text() for name in ['NOTICE','COPYING','LICENSE'])}])
    with tarfile.open(go_archive) as archive:
        go_text = '\n\n'.join(archive.extractfile(name).read().decode(errors='replace') for name in go_pin['licenses'])
    (payload/'legal/Go-NOTICES').write_text(go_text)
    licenses.append({'name':'Go runtime and standard library','version':go_pin['version'],'source':go_pin['url'],'license':'BSD-3-Clause and included notices','text':go_text})
    if toolchain: licenses.extend(termux.notices(args,toolchain))
    write_json(payload/'licenses.json',licenses)
    (payload/'sources').mkdir(exist_ok=True); write_json(payload/'sources/dependencies.json', {**graph, 'components': [{key:value for key,value in entry.items() if key != 'localArchive'} for entry in graph['components']]});shutil.copy2(DEPS/'native-sources.json',payload/'sources/native-dependencies.json')
    shutil.copy2(DEPS/'licensed-go-sources.json',payload/'sources/licensed-go-sources.json'); shutil.copy2(ROOT/'runtime-go.json',payload/'sources/runtime-go.json')
    write_json(payload/'sources/prepared-go-modules.json', prepared_modules); write_json(payload/'sources/linked-go-modules.json', linked_modules)
    shutil.copy2(DEPS/'notice-sources.json',payload/'sources/notice-sources.json')
    shutil.copy2(go_source/'sources.json',payload/'sources/go-toolchain.json')
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    depends, abi = linux_metadata(payload, work, args.architecture) if args.target == 'linux' else termux.metadata(payload,args,toolchain)
    manifest={'schema':1,'target':args.target,'architecture':args.architecture,'sourceCommit':revision,'upstream':{'quantum':'2c071d1e6eb48d4b88da2657885d345663a0a88b','wopi':'fd64a470d3a521b0ad026f0f5307c20dd04b472f'},'patches':[{'name':str(p.relative_to(ROOT/'patches')),'sha256':sha(p.read_bytes())} for group in ['quantum','go-ffmpeg'] for p in sorted((ROOT/'patches'/group).glob('*.patch'))],'facades':[{'name':str(p.relative_to(ROOT)),'sha256':sha(p.read_bytes())} for p in sorted((ROOT/'adapters').glob('*/*.go'))],'depends':depends,'abi':abi,'sourceDependencies':[{'name':e['name'],'version':e['version'],'sha256':e['archive']['sha256']} for e in all_components],'executables':['bin/filebrowser','bin/files-office-addon','bin/ffmpeg','bin/ffprobe'],'files':{}}
    for filename in sorted(payload.rglob('*')):
        if filename.is_file(): manifest['files'][str(filename.relative_to(payload))]={'sha256':sha(filename.read_bytes()),'mode':filename.stat().st_mode & 0o777}
    final_tree, dirty = input_state(inputs)
    if source_dirty or dirty or final_tree != source_tree:
        raise ValueError('Native build completed, but packaging requires all consumed source owners committed and unchanged for the whole build')
    write_json(payload/'manifest.json',manifest);args.output.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(args.output,'w:gz') as archive:
        for item in sorted(payload.iterdir()): archive.add(item,arcname=item.name)
    (args.output.parent/'SHA256SUMS').write_text(sha(args.output.read_bytes())+'  '+args.output.name+'\n')
    print('Native Files artifact:',args.output,flush=True)
if __name__=='__main__': main()
