#!/usr/bin/env python3
"""Offline, separately packaged Files native build. Never edits pristine imports."""
import argparse, hashlib, io, json, os, pathlib, platform, re, shutil, subprocess, tarfile, zipfile
ROOT = pathlib.Path(__file__).resolve().parent
DEPS = ROOT / 'vendor/dependencies'
def sha(data): return hashlib.sha256(data).hexdigest()
def run(argv, cwd, env=None):
    print('+', ' '.join(map(str, argv)), flush=True)
    subprocess.run(list(map(str, argv)), cwd=cwd, env=env, check=True)
def contents(entry):
    data = bytearray()
    for part in entry['parts']:
        value = (DEPS / part['file']).read_bytes()
        if len(value) != part['size'] or sha(value) != part['sha256']: raise ValueError('Corrupt source part: ' + part['file'])
        data.extend(value)
    if len(data) != entry['size'] or sha(data) != entry['sha256']: raise ValueError('Corrupt joined source archive')
    return bytes(data)
def tar_extract(data, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        archive.extractall(destination, filter='data')
        roots = {pathlib.PurePosixPath(member.name).parts[0] for member in archive.getmembers() if member.name and member.name != '.'}
    if len(roots) != 1: raise ValueError('Source archive must have one root')
    return destination / roots.pop()
def write_json(filename, value): filename.write_text(json.dumps(value, indent=2) + '\n')
def safe_component(value): return value.replace('/', '__').replace(':', '_')
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
    parser.add_argument('--architecture', choices=['amd64', 'arm64'], default={'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine()))
    parser.add_argument('--go', default='go')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args(); work = args.work_dir.resolve(); work.mkdir(parents=True, exist_ok=True)
    if work == ROOT or ROOT in work.parents: raise ValueError('Build work must stay outside the source module')
    if args.architecture != {'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine()): raise ValueError('Use the owning native architecture; this recipe is not a cross-compiler')
    if args.target == 'termux' and not os.environ.get('PREFIX', '').startswith('/data/data/'): raise ValueError('Termux builds must run in native Termux')
    graph = json.loads((DEPS/'sources.json').read_text()); native = json.loads((DEPS/'native-sources.json').read_text())
    for name, expected in graph['inputHashes'].items():
        if sha((ROOT/name).read_bytes()) != expected: raise ValueError('Dependency lock changed: '+name)
    archives = work/'archives'; archives.mkdir(exist_ok=True); proxy = work/'goproxy'; proxy.mkdir(exist_ok=True)
    npm_archives = []; all_components = graph['components'] + native['components']
    for entry in all_components:
        data = contents(entry['archive'])
        destination = archives / (entry.get('filename') or (safe_component(entry['name'])+'@'+entry['version']+('.zip' if entry['ecosystem']=='go' else '.tgz')))
        destination.write_bytes(data); entry['localArchive'] = str(destination)
        if entry['ecosystem'] == 'go':
            relative = entry['url'].split('https://proxy.golang.org/',1)[1]; target = proxy/relative; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
            for key, extension in [('info','.info'),('goMod','.mod')]: target.with_suffix(extension).write_bytes(contents(entry[key]))
        elif entry['ecosystem'] == 'npm': npm_archives.append(destination)
    source = work/'quantum'
    if source.exists(): shutil.rmtree(source)
    shutil.copytree(ROOT/'vendor/quantum/source', source)
    for name in (ROOT/'patches/quantum/series').read_text().splitlines():
        if name and not name.startswith('#'): run(['patch','-p1','--fuzz=0','--batch','-i',ROOT/'patches/quantum'/name], source)
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
    env = dict(os.environ); env.update({'GOPROXY':proxy.as_uri(),'GOSUMDB':'off','GOTOOLCHAIN':'local','GOMODCACHE':str(work/'gomodcache'),'CGO_ENABLED':'1'})
    version = subprocess.check_output([args.go,'version'],env=env,text=True)
    if 'go1.27.' not in version: raise ValueError('The pinned Quantum module requires native Go 1.27.x; pass --go explicitly')
    prefix = work/'prefix'; prefix.mkdir(exist_ok=True)
    env['PATH'] = str(prefix/'bin') + os.pathsep + env['PATH']; env['PKG_CONFIG_PATH'] = str(prefix/'lib/pkgconfig')
    env['PKG_CONFIG_LIBDIR'] = str(prefix/'lib/pkgconfig')
    jobs = str(max(1,args.jobs))
    if args.architecture == 'amd64':
        nasm = source_dirs['nasm']; run(['./configure','--prefix='+str(prefix)],nasm,env); run(['make','-j'+jobs],nasm,env); run(['make','install'],nasm,env)
    mupdf = source_dirs['mupdf']
    run(['make','-j'+jobs,'build=release','USE_SYSTEM_LIBS=no','HAVE_X11=no','HAVE_GLUT=no','HAVE_OBJC=no','HAVE_LIBCRYPTO=no','libs'],mupdf,env)
    zlib = mupdf/'thirdparty/zlib'; run(['./configure','--static','--prefix='+str(prefix)],zlib,env); run(['make','-j'+jobs,'libz.a'],zlib,env); run(['make','install-libs'],zlib,env)
    dav1d = source_dirs['dav1d']; davbuild = work/'dav1d-build'
    if not davbuild.exists(): run(['meson','setup',davbuild,'--prefix='+str(prefix),'--libdir=lib','--default-library=static','--buildtype=release','-Denable_tools=false','-Denable_tests=false'],dav1d,env)
    run(['meson','compile','-C',davbuild,'-j',jobs],dav1d,env); run(['meson','install','-C',davbuild],dav1d,env)
    ffmpeg = source_dirs['ffmpeg']; flags = ['--prefix='+str(prefix),'--disable-autodetect','--disable-shared','--enable-static','--disable-doc','--disable-debug','--disable-network','--enable-pthreads','--enable-zlib','--enable-libdav1d','--pkg-config-flags=--static','--extra-cflags=-I'+str(prefix/'include'),'--extra-ldflags=-L'+str(prefix/'lib')]
    run(['./configure',*flags],ffmpeg,env); run(['make','-j'+jobs,'ffmpeg','ffprobe'],ffmpeg,env)
    npmcache = work/'npmcache'
    for offset in range(0,len(npm_archives),50): run(['npm','cache','add','--cache',npmcache,'--offline','--ignore-scripts',*npm_archives[offset:offset+50]],work,env)
    run(['npm','ci','--cache',npmcache,'--offline','--ignore-scripts','--no-audit','--no-fund'],source/'frontend',env); shutil.copytree(source/'frontend/node_modules/ace-builds/src-min-noconflict',source/'frontend/public/ace',dirs_exist_ok=True); run(['npm','run','build'],source/'frontend',env)
    include = source/'backend/internal/preview/gofitzinclude'; include.symlink_to(mupdf/'include')
    env['CGO_CFLAGS'] = '-I'+str(mupdf/'include'); env['CGO_LDFLAGS'] = '-L'+str(mupdf/'build/release')+' -lmupdf -lmupdf-third -lm -lpthread -lstdc++'
    payload = work/'payload';
    if payload.exists(): shutil.rmtree(payload)
    (payload/'bin').mkdir(parents=True)
    run([args.go,'build','-trimpath','-tags=mupdf,extlib,static','-ldflags=-s -w','-o',payload/'bin/filebrowser','.'],source/'backend',env)
    addon = work/'addon';
    if addon.exists(): shutil.rmtree(addon)
    shutil.copytree(ROOT/'addon',addon)
    clean_env = dict(env); clean_env.pop('CGO_CFLAGS');clean_env.pop('CGO_LDFLAGS')
    run([args.go,'build','-mod=vendor','-trimpath','-ldflags=-s -w','-o',payload/'bin/files-office-addon','.'],addon,clean_env)
    for name in ['ffmpeg','ffprobe']: shutil.copy2(ffmpeg/name,payload/'bin'/name)
    licenses = []
    for entry in all_components:
        target = payload/'legal'/safe_component(entry['name']+'@'+entry['version']); target.mkdir(parents=True,exist_ok=True)
        data = pathlib.Path(entry['localArchive']).read_bytes()
        if entry['ecosystem']=='go':
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for index,name in enumerate(entry['notices']): (target/(str(index)+'-'+pathlib.PurePosixPath(name).name)).write_bytes(archive.read(name))
        else:
            with tarfile.open(fileobj=io.BytesIO(data),mode='r:*') as archive:
                for index,name in enumerate(entry['notices']): (target/(str(index)+'-'+pathlib.PurePosixPath(name).name)).write_bytes(archive.extractfile(name).read())
        licenses.append({'name':entry['name'],'version':entry['version'],'source':entry['url'],'text':'\n\n'.join(p.read_text(errors='replace') for p in sorted(target.iterdir()))})
    shutil.copy2(ROOT/'vendor/quantum/source/LICENSE',payload/'legal/Quantum-LICENSE')
    for name in ['COPYING','LICENSE','NOTICE']: shutil.copy2(ROOT/'addon'/name,payload/'legal'/('addon-'+name))
    licenses.extend([{'name':'File Browser Quantum','version':'2.0.2-stable','license':'Apache-2.0','text':(payload/'legal/Quantum-LICENSE').read_text()}, {'name':'BashKitten Files Office add-on','license':'AGPL-3.0-only AND Apache-2.0 AND MIT','text':'\n\n'.join((ROOT/'addon'/name).read_text() for name in ['NOTICE','COPYING','LICENSE'])}])
    write_json(payload/'licenses.json',licenses)
    (payload/'sources').mkdir(); shutil.copy2(DEPS/'sources.json',payload/'sources/dependencies.json');shutil.copy2(DEPS/'native-sources.json',payload/'sources/native-dependencies.json')
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    depends, abi = linux_metadata(payload, work, args.architecture) if args.target == 'linux' else ([], {'baseline':'native Termux'})
    manifest={'schema':1,'target':args.target,'architecture':args.architecture,'sourceCommit':revision,'upstream':{'quantum':'2c071d1e6eb48d4b88da2657885d345663a0a88b','wopi':'fd64a470d3a521b0ad026f0f5307c20dd04b472f'},'patches':[{'name':p.name,'sha256':sha(p.read_bytes())} for p in sorted((ROOT/'patches/quantum').glob('*.patch'))],'depends':depends,'abi':abi,'sourceDependencies':[{'name':e['name'],'version':e['version'],'sha256':e['archive']['sha256']} for e in all_components],'executables':['bin/filebrowser','bin/files-office-addon','bin/ffmpeg','bin/ffprobe'],'files':{}}
    for filename in sorted(payload.rglob('*')):
        if filename.is_file(): manifest['files'][str(filename.relative_to(payload))]={'sha256':sha(filename.read_bytes()),'mode':filename.stat().st_mode & 0o777}
    dirty = subprocess.check_output(['git','status','--porcelain','--',str(ROOT)],cwd=ROOT,text=True)
    if dirty.strip(): raise ValueError('Native build completed, but Files source must be committed before packaging an accepted artifact')
    write_json(payload/'manifest.json',manifest);args.output.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(args.output,'w:gz') as archive:
        for item in sorted(payload.iterdir()): archive.add(item,arcname=item.name)
    (args.output.parent/'SHA256SUMS').write_text(sha(args.output.read_bytes())+'  '+args.output.name+'\n')
    print('Native Files artifact:',args.output,flush=True)
if __name__=='__main__': main()
