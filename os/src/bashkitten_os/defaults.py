# SPDX-License-Identifier: AGPL-3.0-only
# First-use XFCE configuration; Thunar action merging follows BuzzardOS 6c1b89f.
import os, shutil, subprocess, tempfile
from pathlib import Path
import xml.etree.ElementTree as ET
from .common import PREFIX,SHARE,linux_guest


def atomic(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    descriptor,name=tempfile.mkstemp(prefix='.'+path.name,dir=path.parent)
    try:
        with os.fdopen(descriptor,'w') as stream:stream.write(text)
        os.replace(name,path)
    finally:Path(name).unlink(missing_ok=True)

def new_default(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    try:stream=path.open('x',encoding='utf-8')
    except FileExistsError:return
    created=os.fstat(stream.fileno())
    try:
        with stream:stream.write(text)
    except BaseException:
        # Remove only our incomplete creation, not a user replacement.
        try:
            current=path.lstat()
            if (current.st_dev,current.st_ino)==(created.st_dev,created.st_ino):path.unlink()
        except FileNotFoundError:pass
        raise

def initialize():
    config=Path(os.environ.get('XDG_CONFIG_HOME',Path.home()/'.config'))
    portals=config/'xdg-desktop-portal'
    # User portal choices take precedence; this is a provisioning default, not
    # a package-owned replacement for xfce4-session's system configuration.
    if not any(os.path.lexists(portals/name) for name in ('portals.conf','xfce-portals.conf')):
        new_default(portals/'xfce-portals.conf',(SHARE/'xfce-portals.conf').read_text())
    channel_dir=config/'xfce4/xfconf/xfce-perchannel-xml'
    for source in (SHARE/'defaults').glob('*.xml'):
        target=channel_dir/source.name
        if not target.exists():
            atomic(target,source.read_text().replace('@PREFIX@',str(PREFIX)))
            if source.name=='xfce4-desktop.xml':atomic(config/'bashkitten-os/initial-wallpaper','pending\n')
    css=config/'gtk-3.0/gtk.css'
    line=f'@import url("{SHARE}/desktop.css");'
    content=css.read_text() if css.exists() else ''
    initialized=config/'bashkitten-os/initialized'
    if not initialized.exists():
        if line not in content:atomic(css,line+'\n'+content)
        atomic(initialized,'1\n')
    # Custom actions are merged by owned IDs once per explicit package/provisioning invocation.
    # Existing unrelated actions and user customizations to our actions are preserved.
    if linux_guest(): merge_thunar(config)

def merge_thunar(config):
    target=config/'Thunar/uca.xml'
    tree=ET.parse(target) if target.exists() else ET.ElementTree(ET.Element('actions'))
    root=tree.getroot();existing={x.findtext('unique-id') for x in root.findall('action')}
    donor=ET.parse(SHARE/'thunar-uca.xml')
    for action in donor.getroot():
        if action.findtext('unique-id') not in existing:
            action.find('command').text=action.findtext('command').replace('@PREFIX@',str(PREFIX))
            root.append(action)
    ET.indent(tree);atomic(target,ET.tostring(root,encoding='unicode')+'\n')

def update_wallpaper(size,workarea):
    from gi.repository import GdkPixbuf
    from .scaling import XfconfSetting,xfconf_get,xfconf_set_if_needed
    env=os.environ.copy()
    result=subprocess.run(['xrandr','--listmonitors'],capture_output=True,text=True,check=True,timeout=10)
    monitors=[line.split()[-1] for line in result.stdout.splitlines()[1:] if line.split()]
    if not monitors:return
    # This is only the existing managed default. User path or placement always wins.
    destination=Path(os.environ.get('XDG_CACHE_HOME',Path.home()/'.cache'))/'bashkitten-os/default-wallpaper.png'
    initial=Path(os.environ.get('XDG_CONFIG_HOME',Path.home()/'.config'))/'bashkitten-os/initial-wallpaper'
    selected=[]
    for monitor in monitors:
        base=f'/backdrop/screen0/monitor{monitor}/workspace0'
        image=XfconfSetting('xfce4-desktop',base+'/last-image','string')
        placement=XfconfSetting('xfce4-desktop',base+'/image-style','int')
        path=xfconf_get(image,env);mode=xfconf_get(placement,env)
        if not initial.exists() and path not in (None,'',str(destination),str(SHARE/'logo.png')):continue
        if path==str(destination) and mode not in (None,'1'):continue
        selected.append((image,placement,path,mode))
    if not selected:return
    width,height=size
    x,y,area_width,area_height=workarea
    left,top=max(0,x),max(0,y)
    right,bottom=min(width,x+area_width),min(height,y+area_height)
    if right<=left or bottom<=top:return
    logo=GdkPixbuf.Pixbuf.new_from_file(str(SHARE/'logo.png'))
    ratio=min(1,(right-left)/logo.get_width(),(bottom-top)/logo.get_height())
    lw,lh=max(1,int(logo.get_width()*ratio)),max(1,int(logo.get_height()*ratio))
    if ratio<1:logo=logo.scale_simple(lw,lh,GdkPixbuf.InterpType.BILINEAR)
    output=GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB,False,8,width,height);output.fill(0x202225ff)
    offset_x,offset_y=left+(right-left-lw)//2,top+(bottom-top-lh)//2
    logo.composite(output,offset_x,offset_y,lw,lh,offset_x,offset_y,1,1,GdkPixbuf.InterpType.BILINEAR,255)
    # A user can change image/placement while the off-thread render is running.
    # Revalidate ownership before replacing the managed file or XFConf values.
    selected=[entry for entry in selected if xfconf_get(entry[0],env)==entry[2] and xfconf_get(entry[1],env)==entry[3]]
    if not selected:
        initial.unlink(missing_ok=True);return
    destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=destination.with_suffix('.new.png');output.savev(str(temporary),'png',[],[]);os.replace(temporary,destination)
    for image,placement,path,mode in selected:
        if xfconf_get(image,env)==path and xfconf_get(placement,env)==mode:
            xfconf_set_if_needed(image,str(destination),env);xfconf_set_if_needed(placement,'1',env)
    initial.unlink(missing_ok=True)
    # Changing the same file is observed by xfdesktop's normal file monitor.
