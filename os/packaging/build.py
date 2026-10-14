#!/usr/bin/env python3
"""Build the shared native desktop package from committed source and named patches."""
import argparse,hashlib,json,os,platform,re,shutil,subprocess,sys,tarfile,shlex,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parent

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def run(argv,**kwargs):subprocess.run(list(map(str,argv)),check=True,**kwargs)

def meson():return shlex.split(os.environ.get('BASHKITTEN_MESON','meson'))

def write(path,text,mode=0o644):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);path.chmod(mode)

def write_md5sums(stage):
    records=[]
    for path in sorted(stage.rglob('*')):
        relative=path.relative_to(stage)
        if relative.parts[0]=='DEBIAN' or path.is_symlink() or not path.is_file():continue
        with path.open('rb') as stream:checksum=hashlib.file_digest(stream,'md5').hexdigest()
        records.append(checksum+'  '+relative.as_posix()+'\n')
    write(stage/'DEBIAN/md5sums',''.join(records))

def cache_key(args,prefix):
    key=hashlib.sha256((ROOT/'upstream/sources.json').read_bytes())
    for patch in sorted((ROOT/'patches').rglob('*.patch')):
        key.update(str(patch.relative_to(ROOT)).encode());key.update(patch.read_bytes())
    key.update((prefix+args.architecture+str(args.cross_file)).encode())
    for name in ('CC','CFLAGS','CPPFLAGS','LDFLAGS','PKG_CONFIG','PKG_CONFIG_PATH'):
        key.update((name+'='+os.environ.get(name,'')).encode())
    key.update(subprocess.check_output(shlex.split(os.environ.get('CC','cc'))+['--version']))
    if args.cross_file:key.update(args.cross_file.read_bytes())
    return key

def invalidate(work,identity):
    stamp=work/'source-key'
    if not stamp.exists() or stamp.read_text()!=identity:
        shutil.rmtree(work,ignore_errors=True);work.mkdir(parents=True)
        stamp.write_text(identity)

def verify_sources():
    records=json.loads((ROOT/'upstream/sources.json').read_text())
    for record in records:
        for relative,expected in record['files'].items():
            source=ROOT/'upstream'/record['name']/relative
            if not source.is_file() or digest(source)!=expected:raise RuntimeError('Pristine source checksum mismatch: '+str(source))
    for text in ('GPL-2.0.txt','GPL-3.0.txt','LGPL-2.1.txt','LGPL-3.0.txt','AGPL-3.0.txt','PeGPU-MIT.txt'):
        if not (ROOT/'licenses'/text).is_file():raise RuntimeError('Missing full license: '+text)
    return records

def build_dbusmenu(args,prefix,stage):
    if args.target!='termux':return
    work=args.build_dir/'dbusmenu';source=work/'source';build=work/'build'
    invalidate(work,cache_key(args,prefix).hexdigest())
    if not source.exists():
        shutil.copytree(ROOT/'upstream/libdbusmenu',source)
        for patch in sorted((ROOT/'patches/libdbusmenu').glob('*.patch')):
            run(['patch','-p1','--input',patch.resolve()],cwd=source)
    build.mkdir(parents=True,exist_ok=True)
    private=prefix+'/lib/bashkitten-os/panel'
    env=os.environ.copy()
    env['LDFLAGS']=env.get('LDFLAGS','')+' -Wl,-rpath,'+private+'/lib -Wl,-z,max-page-size=16384 -lm'
    if not (build/'Makefile').exists():
        argv=[source/'configure','--prefix='+private,'--disable-static','--disable-introspection',
              '--disable-vala','--disable-tests','--disable-dumper','--disable-gtk-doc',
              '--enable-gtk','--with-gtk=3']
        if args.autotools_host:argv+=['--host='+args.autotools_host]
        run(argv,cwd=build,env=env)
    run(['make','-j',args.jobs],cwd=build,env=env)
    run(['make','install','DESTDIR='+str(stage)],cwd=build,env=env)
    # Compile-time pkgconfig paths point into staging, runtime rpath stays final.
    pkg=work/'pkgconfig';pkg.mkdir(exist_ok=True)
    for source in (stage/private.lstrip('/')/'lib/pkgconfig').glob('*.pc'):
        write(pkg/source.name,source.read_text().replace('prefix='+private,'prefix='+str(stage/private.lstrip('/'))))
    os.environ['PKG_CONFIG_PATH']=str(pkg)+(':'+os.environ['PKG_CONFIG_PATH'] if os.environ.get('PKG_CONFIG_PATH') else '')

def build_windowing(args,prefix,stage):
    work=args.build_dir/'windowing';work.mkdir(parents=True,exist_ok=True)
    invalidate(work,cache_key(args,prefix).hexdigest())
    build=work/'build';source=ROOT/'upstream/libxfce4windowing'
    private=prefix+'/lib/bashkitten-os/panel'
    if not (build/'build.ninja').exists():
        argv=meson()+['setup',build,source,'--prefix='+private,'--libdir=lib','--buildtype=release',
              '-Dx11=enabled','-Dwayland=disabled','-Dintrospection=false','-Dvala=disabled','-Dtests=false',
              '-Dc_link_args='+repr(shlex.split(os.environ.get('LDFLAGS',''))+['-Wl,-rpath,'+private+'/lib']+
                                   (['-Wl,-z,max-page-size=16384'] if args.target=='termux' else []))]
        if args.cross_file:argv+=['--cross-file',args.cross_file]
        run(argv)
    run(meson()+['compile','-C',build,'-j',args.jobs])
    run(meson()+['install','-C',build,'--destdir',stage,'--no-rebuild'])
    pkg=work/'pkgconfig';pkg.mkdir(exist_ok=True)
    for source in (stage/private.lstrip('/')/'lib/pkgconfig').glob('*.pc'):
        write(pkg/source.name,source.read_text().replace('prefix='+private,'prefix='+str(stage/private.lstrip('/'))))
    os.environ['PKG_CONFIG_PATH']=str(pkg)+(':'+os.environ['PKG_CONFIG_PATH'] if os.environ.get('PKG_CONFIG_PATH') else '')

def build_panel(args,prefix,stage):
    work=args.build_dir/'panel';work.mkdir(parents=True,exist_ok=True)
    source=work/'source';build=work/'build'
    key=cache_key(args,prefix)
    for patch in sorted((ROOT/'patches').glob('*.patch')):key.update(patch.read_bytes())
    identity=key.hexdigest();stamp=work/'source-key'
    if not stamp.exists() or stamp.read_text()!=identity:
        shutil.rmtree(source,ignore_errors=True);shutil.rmtree(build,ignore_errors=True)
        shutil.copytree(ROOT/'upstream/xfce4-panel',source)
        for patch in sorted((ROOT/'patches').glob('*.patch')):run(['patch','-p1','--input',patch.resolve()],cwd=source)
        stamp.write_text(identity)
    panel_prefix=prefix+'/lib/bashkitten-os/panel'
    # Meson already includes this build-source root before dependency -I paths.
    # Stage the matching private headers here: distro libxfce4ui exposes a broad
    # /include/xfce4 path that would otherwise shadow our newer pinned windowing.
    headers=stage/panel_prefix.lstrip('/')/'include/xfce4/libxfce4windowing-0'
    for name in ('libxfce4windowing','libxfce4windowingui'):
        shutil.copytree(headers/name,source/name,dirs_exist_ok=True)
    if not (build/'build.ninja').exists():
        argv=meson()+['setup',build,source,'--prefix='+panel_prefix,'--libdir=lib','--buildtype=release',
              '-Dx11=enabled','-Dwayland=disabled','-Dgtk-layer-shell=disabled','-Dintrospection=false','-Dvala=disabled',
              '-Ddbusmenu=enabled']
        link_args=shlex.split(os.environ.get('LDFLAGS',''))+['-Wl,-rpath,'+panel_prefix+'/lib']
        if args.target=='termux':link_args+=['-Wl,-z,max-page-size=16384','-lm']
        argv+=['-Dc_link_args='+repr(link_args)]
        if args.cross_file:argv+=['--cross-file',args.cross_file]
        run(argv)
    run(meson()+['compile','-C',build,'-j',args.jobs])
    run(meson()+['install','-C',build,'--destdir',stage,'--no-rebuild'])
    return identity

def theme(stage,prefix):
    for factor,touch in ((factor,touch) for factor in (1,2,3) for touch in (False,True)):
        family='BashKitten-Touch' if touch else 'BashKitten'
        name=family if factor==1 else f'{family}-{factor}x'
        theme_root=stage/prefix.lstrip('/')/'share/themes'/name/'xfwm4';theme_root.mkdir(parents=True)
        for source in (ROOT/'upstream/xfwm4-theme/themes/default').glob('*.xpm'):
            value=source.read_text()
            def color(match):
                symbol=match.group(2)
                if 'text' in symbol:replacement='#ffffff' if 'active' in symbol and not 'inactive' in symbol else '#c8c8c8'
                elif 'hilight' in symbol:replacement='#ff7139'
                elif 'shadow' in symbol:replacement='#181818'
                else:replacement='#282828'
                return match.group(1)+replacement
            value=re.sub(r'(\bc )#[A-Fa-f0-9]+ s ([A-Za-z0-9_]+)',color,value)
            if factor!=1 or touch:
                records=re.findall(r'"([^"\n]*)"',value)
                width,height,colors,cpp=map(int,records[0].split())
                rows=records[colors+1:colors+height+1]
                if touch:
                    if source.stem.split('-')[0] in ('close','hide','maximize','menu','shade','stick'):
                        # Expand the hit surface, not the glyph. Edge pixels are
                        # the existing themed background; keep the icon centered.
                        left=max(0,42-width)//2;right=max(0,42-width)-left
                        rows=[row[:cpp]*left+row+row[-cpp:]*right for row in rows]
                        top=max(0,42-height)//2;bottom=max(0,42-height)-top
                        rows=[rows[0]]*top+rows+[rows[-1]]*bottom
                        width+=left+right;height+=top+bottom
                    elif source.stem.startswith(('title-','top-left-','top-right-')):
                        extra=max(0,42-height);middle=height//2
                        rows=rows[:middle]+[rows[middle]]*extra+rows[middle:];height+=extra
                pixels=[]
                for row in rows:
                    pixels.extend([''.join(row[i:i+cpp]*factor for i in range(0,len(row),cpp))]*factor)
                records=[f'{width*factor} {height*factor} {colors} {cpp}',*records[1:colors+1],*pixels]
                changes='integer pixel scaling and touch padding' if touch else 'integer pixel scaling'
                value=f'/* XPM */\n/* Derived from the pinned Xfwm default; {changes}. GPL-2.0-or-later. */\nstatic char *image[] = {{\n'+',\n'.join(json.dumps(row) for row in records)+'};\n'
            (theme_root/source.name).write_text(value)
        value=(ROOT/'upstream/xfwm4-theme/themes/default/themerc').read_text()
        value=re.sub(r'^active_text_color=.*','active_text_color=#ffffff',value,flags=re.M)
        value=re.sub(r'^inactive_text_color=.*','inactive_text_color=#c8c8c8',value,flags=re.M)
        if factor!=1:
            value=re.sub(r'^((?:button_offset|button_spacing|frame_border_top|maximized_offset|title_.*offset.*|shadow_delta_.*)=)(-?\d+)$',lambda m:m.group(1)+str(int(m.group(2))*factor),value,flags=re.M)
        (theme_root/'themerc').write_text(value)

def linux_shlibs(stage,work):
    directory=work/'shlibs';(directory/'debian').mkdir(parents=True,exist_ok=True)
    write(directory/'debian/control','Source: bashkitten-os\nSection: x11\nPriority: optional\nMaintainer: BashKitten <maintainers@openresearchtools.org>\n\nPackage: bashkitten-os\nArchitecture: any\nDescription: BashKitten OS\n')
    private=stage/'usr/lib/bashkitten-os/panel/lib';records=[];elf=[]
    for path in (stage/'usr/lib/bashkitten-os/panel').rglob('*'):
        if not path.is_file() or path.is_symlink():continue
        with path.open('rb') as stream:
            if stream.read(4)!=b'\x7fELF':continue
        elf.append(path)
        dynamic=subprocess.check_output(['readelf','-d',path],text=True)
        soname=re.search(r'\(SONAME\).*\[([^]]+)\]',dynamic)
        if soname:
            parts=soname.group(1).split('.so.')
            if len(parts)==2:records.append(parts[0]+' '+parts[1]+' bashkitten-os')
    shlibs=directory/'debian/shlibs.local';write(shlibs,'\n'.join(records)+'\n')
    result=subprocess.check_output(['dpkg-shlibdeps','-O','-xbashkitten-os','-l'+str(private),
                                    '-L'+str(shlibs),*['-e'+str(path) for path in elf]],cwd=directory,text=True)
    return next(line.partition('=')[2].split(', ') for line in result.splitlines() if line.startswith('shlibs:Depends='))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target',choices=['linux','termux'],required=True)
    parser.add_argument('--architecture',choices=['amd64','arm64','aarch64','x86_64'],required=True)
    parser.add_argument('--version',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--build-dir',type=Path,required=True)
    parser.add_argument('--cross-file',type=Path)
    parser.add_argument('--autotools-host')
    parser.add_argument('--stage-only',action='store_true')
    parser.add_argument('--source-commit')
    parser.add_argument('--jobs',type=int,default=8)
    args=parser.parse_args();records=verify_sources()
    termux=args.target=='termux'
    if args.architecture not in ({'aarch64','x86_64'} if termux else {'amd64','arm64'}):parser.error('Target/architecture mismatch')
    if not re.fullmatch(r'[0-9][0-9A-Za-z.+:~_-]*',args.version):parser.error('Invalid package version')
    source_commit=args.source_commit or subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()
    if not re.fullmatch(r'[a-f0-9]{40}',source_commit):parser.error('Invalid source commit')
    args.build_dir=args.build_dir.resolve();args.output=args.output.resolve();args.output.mkdir(parents=True,exist_ok=True)
    stage=args.build_dir/'stage';shutil.rmtree(stage,ignore_errors=True);stage.mkdir(parents=True)
    prefix='/data/data/com.termux/files/usr' if termux else '/usr'
    build_dbusmenu(args,prefix,stage)
    build_windowing(args,prefix,stage)
    panel_key=build_panel(args,prefix,stage)
    base=stage/prefix.lstrip('/');library=base/'lib/bashkitten-os';share=base/'share/bashkitten-os'
    shutil.copytree(ROOT/'src/bashkitten_os',library/'bashkitten_os',ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ROOT/'data',share)
    shutil.copyfile(REPO/'browser/bashkitten/browser/branding/assets/bashkitten-logo-glasses-original.png',share/'logo.png')
    shutil.copytree(ROOT/'licenses',share/'licenses');shutil.copy(ROOT/'NOTICE',share/'NOTICE')
    shutil.copy(ROOT/'upstream/sources.json',share/'sources.json')
    write(share/'build.json',json.dumps({'schemaVersion':1,'sourceCommit':source_commit,
        'version':args.version,'target':args.target,'architecture':args.architecture},indent=2)+'\n')
    for record in records:
        donor=ROOT/'upstream'/record['name']
        for relative in record['files']:
            if Path(relative).name.upper().startswith(('COPYING','LICENSE','NOTICE','THIRD_PARTY')):
                source=donor/relative;target=share/'licenses/upstream'/record['name']/relative
                target.parent.mkdir(parents=True,exist_ok=True);shutil.copy(source,target)
    python=prefix+'/bin/python' if termux else '/usr/bin/python3'
    for command,module in [('bashkitten-os','main'),('bashkitten-desktop-context','desktop_context'),('bashkitten-atspi','atspi')]+([] if termux else [('bashkitten-app','applications')]):
        write(base/'bin'/command,f'#!{python}\nimport sys\nsys.path.insert(0,{str(Path(prefix)/"lib/bashkitten-os")!r})\nfrom bashkitten_os.{module} import main\nsys.exit(main())\n',0o755)
    write(base/'bin/xfce4-panel',f'#!{python}\nimport os,sys\nos.execv({(prefix+"/lib/bashkitten-os/panel/bin/xfce4-panel")!r},sys.argv)\n',0o755)
    for name in ['org.bashkitten.OS.desktop','org.bashkitten.Applications.desktop']:
        write(base/'share/applications'/name,(ROOT/'data'/name).read_text())
    write((base/'etc' if termux else stage/'etc')/'xdg/autostart/bashkitten-os-session.desktop',(ROOT/'data/bashkitten-os-session.desktop').read_text())
    schema=base/'share/glib-2.0/schemas';schema.mkdir(parents=True,exist_ok=True)
    shutil.copy(ROOT/'data/org.bashkitten.OS.gschema.xml',schema)
    run(['glib-compile-schemas','--strict',schema])
    (schema/'gschemas.compiled').unlink()
    write(base/'share/dbus-1/services/org.freedesktop.impl.portal.desktop.bashkitten.service',(ROOT/'data/org.freedesktop.impl.portal.desktop.bashkitten.service').read_text().replace('@PREFIX@',prefix))
    write(base/'share/xdg-desktop-portal/portals/bashkitten.portal',(ROOT/'data/bashkitten.portal').read_text())
    # xfce4-session owns the public XFCE portal default on both target systems.
    # Provision this private template into an unset owned profile instead.
    write(share/'xfce-portals.conf',(ROOT/'data/xfce-portals.conf').read_text().replace('default=gtk\n','') if termux else (ROOT/'data/xfce-portals.conf').read_text())
    # Install correctly sized existing branding assets. The original wallpaper
    # logo is 1254px; labelling it as 256px makes GTK launcher tooltips oversized.
    for size in (48,64,128,256):
        icon=base/f'share/icons/hicolor/{size}x{size}/apps/bashkitten-os.png'
        icon.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy(REPO/f'browser/bashkitten/browser/branding/default{size}.png',icon)
    shutil.copytree(ROOT/'upstream/gnozzard/data/icons/Gnozzard',base/'share/icons/BashKitten')
    index=base/'share/icons/BashKitten/index.theme';index.write_text(index.read_text().replace('Gnozzard','BashKitten'))
    theme(stage,prefix)
    shutil.copytree(ROOT/'skills',share/'skills')
    if not termux:
        write(base/'share/applications/org.bashkitten.AppImage.desktop','[Desktop Entry]\nType=Application\nName=BashKitten AppImage\nNoDisplay=true\nExec=bashkitten-app launch %f\nMimeType=application/vnd.appimage;application/x-iso9660-appimage;\nIcon=application-x-executable\n')
    dependencies=(['python','pygobject','gtk3','libwnck','xfconf','xfwm4','xfce4-session','xfdesktop','thunar','xfce4-terminal','xdotool','scrot','at-spi2-core (>= 2.62.0)','xorg-xrandr','xorg-xrdb','xorg-xprop','xdg-desktop-portal','libdisplay-info','libxfce4ui','libxfce4util','garcon','exo'] if termux else ['python3','python3-gi','gir1.2-gtk-3.0','gir1.2-wnck-3.0','gir1.2-atspi-2.0','libgtk-3-0t64','libwnck-3-0','libxfconf-0-3','xfconf','xfwm4','xfce4-session','xfdesktop4','thunar','xfce4-terminal','xdotool','scrot','at-spi2-core (>= 2.62.0)','x11-xserver-utils','x11-utils','xdg-desktop-portal','xdg-desktop-portal-gtk','libdbusmenu-gtk3-4','libxfce4ui-2-0','libxfce4util7','libgarcon-1-0','libgarcon-gtk3-1-0','libexo-2-0','zenity','squashfs-tools','desktop-file-utils','xdg-utils','libfuse2t64','sudo'])
    # The inherited icon themes do not require the SVG loader used by our icons.
    dependencies.append('librsvg' if termux else 'librsvg2-common')
    if not termux:
        # Required by postinst even when the guest installs without Recommends.
        dependencies += ['libglib2.0-bin', 'libatk-bridge2.0-0t64 (>= 2.62.0)'] + linux_shlibs(stage,args.build_dir)
    dependencies=list(dict.fromkeys(dependencies))
    control=f'''Package: bashkitten-os
Version: {args.version}
Architecture: {args.architecture}
Maintainer: BashKitten <maintainers@openresearchtools.org>
Section: x11
Priority: optional
Depends: {', '.join(dependencies)}
Provides: xfce4-panel (= 4.20.8)
Conflicts: xfce4-panel
Replaces: xfce4-panel
Description: BashKitten OS desktop customization
 Shared native XFCE launcher, layout, scaling and application integration.
'''
    write(stage/'DEBIAN/control',control)
    # Native package database cache maintenance only, never session provisioning.
    shell=prefix+'/bin/sh' if termux else '/bin/sh'
    write(stage/'DEBIAN/postinst',f'#!{shell}\nset -e\n{prefix}/bin/glib-compile-schemas {prefix}/share/glib-2.0/schemas\n{prefix}/bin/update-desktop-database {prefix}/share/applications\n',0o755)
    # Reuse the main packager's ELF machine/Android 16KB checks.
    runpy.run_path(str(REPO/'agent/packaging/build.py'))['elf_payload'](stage,args.architecture,termux)
    if args.stage_only:
        print(stage);return
    write_md5sums(stage)
    artifact=args.output/f'BashKittenOS_{args.version}_{args.architecture}.deb'
    run(['dpkg-deb','--root-owner-group','--build',stage,artifact])
    write(Path(str(artifact)+'.sha256'),digest(artifact)+'  '+artifact.name+'\n')
    provenance={'target':args.target,'architecture':args.architecture,'version':args.version,'panelKey':panel_key,'sources':[{k:v for k,v in r.items() if k!='files'} for r in records],
        'sourceCommit':source_commit,'depends':dependencies}
    write(Path(str(artifact)+'.json'),json.dumps(provenance,indent=2)+'\n')
    print(artifact)
if __name__=='__main__':main()
