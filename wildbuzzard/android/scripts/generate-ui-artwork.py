#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Generate original functional icons and brand aliases for the Android app.

Android Components resource names are retained for binary resource references.
The app overrides their artwork, including every configuration qualifier.
Decorative upstream art is replaced by the existing Wild Buzzard logo. No
upstream path geometry is used to generate icons.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
RES = ROOT / 'mobile/android/fenix/app/src/main/res'
COMPONENTS = ROOT / 'mobile/android/android-components/components'
A = '{http://schemas.android.com/apk/res/android}'
HEADER = '<?xml version="1.0" encoding="utf-8"?>\n<!-- SPDX-License-Identifier: AGPL-3.0-or-later; original Wild Buzzard artwork. -->\n'
# Independently drawn geometric symbols, in a 24 by 24 coordinate system.
PATHS = {
 'back': 'M20,12H4M10,6L4,12L10,18',
 'forward': 'M4,12H20M14,6L20,12L14,18',
 'down': 'M6,9L12,15L18,9', 'up':'M6,15L12,9L18,15',
 'left':'M15,6L9,12L15,18','right':'M9,6L15,12L9,18',
 'plus':'M4,12H20M12,4V20','cross':'M5,5L19,19M19,5L5,19',
 'check':'M4,12L9,17L20,6',
 'search':'M16,10A6,6 0,1 1,4,10A6,6 0,1 1,16,10M15,15L21,21',
 'bookmark':'M6,3H18V21L12,17L6,21Z',
 'star':'M12,3L15,9L21,10L17,15L18,21L12,18L6,21L7,15L3,10L9,9Z',
 'history':'M4,7A9,9 0,1 1,3,14M4,3V8H9M12,7V12L16,14',
 'reload':'M19,8A8,8 0,1 0,20,15M20,3V9H14',
 'home':'M3,11L12,3L21,11M6,9V21H10V15H14V21H18V9',
 'download':'M12,3V15M7,10L12,15L17,10M4,16V21H20V16',
 'share':'M9,8L16,5M9,16L16,19M9,12A3,3 0,1 1,3,12A3,3 0,1 1,9,12M21,4A2,2 0,1 1,17,4A2,2 0,1 1,21,4M21,20A2,2 0,1 1,17,20A2,2 0,1 1,21,20',
 'settings':'M3,6H21M3,12H21M3,18H21M8,3V9M16,9V15M10,15V21',
 'globe':'M21,12A9,9 0,1 1,3,12A9,9 0,1 1,21,12M3,12H21M12,3C6,8 6,16 12,21C18,16 18,8 12,3',
 'lock':'M5,10H19V21H5ZM8,10V7A4,4 0,0 1,16,7V10M12,14V17',
 'private':'M7,10V7A5,5 0,0 1,17,7V10M4,10H20V21H4ZM12,14V17',
 'protection':'M21,12A9,9 0,1 1,3,12A9,9 0,1 1,21,12M7,12L10,15L17,8',
 'key':'M11,8A4,4 0,1 1,3,8A4,4 0,1 1,11,8M10,11L20,21M15,16L18,13M18,19L21,16',
 'tab':'M4,5H20V21H4ZM8,2H22V18',
 'tabs':'M3,4H17V18H3ZM7,8H21V22H7Z',
 'folder':'M3,6H9L11,9H21V21H3Z',
 'document':'M5,2H14L20,8V22H5ZM14,2V8H20M8,12H16M8,16H16',
 'copy':'M8,7H21V22H8ZM4,17H2V2H15V4',
 'clipboard':'M8,5H4V22H20V5H16M8,2H16V7H8Z',
 'trash':'M3,6H21M8,6V3H16V6M5,6L6,22H18L19,6M9,10V18M15,10V18',
 'edit':'M4,16L16,4L20,8L8,20L3,21ZM14,6L18,10',
 'grid':'M3,3H9V9H3ZM15,3H21V9H15ZM3,15H9V21H3ZM15,15H21V21H15Z',
 'menu':'M4,6H20M4,12H20M4,18H20',
 'more':'M5,12H5.1M12,12H12.1M19,12H19.1',
 'morevertical':'M12,5V5.1M12,12V12.1M12,19V19.1',
 'warning':'M12,3L22,21H2ZM12,9V14M12,17V17.1',
 'info':'M21,12A9,9 0,1 1,3,12A9,9 0,1 1,21,12M12,11V17M12,7V7.1',
 'help':'M21,12A9,9 0,1 1,3,12A9,9 0,1 1,21,12M9,8C9,4 17,5 15,10L12,13M12,17V17.1',
 'desktop':'M2,3H22V16H2ZM12,16V21M7,21H17',
 'phone':'M6,2H18V22H6ZM10,5H14M11,19H13',
 'tablet':'M3,2H21V22H3ZM11,19H13',
 'image':'M3,3H21V21H3ZM3,17L9,11L13,15L16,12L21,17M17,7H17.1',
 'camera':'M3,7H7L9,4H15L17,7H21V21H3ZM16,13A4,4 0,1 1,8,13A4,4 0,1 1,16,13',
 'microphone':'M9,5A3,3 0,0 1,15,5V12A3,3 0,0 1,9,12ZM5,11V12A7,7 0,0 0,19,12V11M12,19V22M8,22H16',
 'eye':'M2,12Q12,0 22,12Q12,24 2,12ZM15,12A3,3 0,1 1,9,12A3,3 0,1 1,15,12',
 'location':'M12,22C10,18 4,13 4,9A8,8 0,0 1,20,9C20,13 14,18 12,22ZM15,9A3,3 0,1 1,9,9A3,3 0,1 1,15,9',
 'bell':'M5,17V10A7,7 0,0 1,19,10V17L21,19H3ZM9,22H15',
 'play':'M6,3L21,12L6,21Z', 'pause':'M7,3V21M17,3V21',
 'stop':'M5,5H19V19H5Z',
 'print':'M6,8V2H18V8M6,17H2V8H22V17H18M6,14H18V22H6ZM18,11H18.1',
 'pin':'M8,3H16L15,10L19,14H13V22M11,22V14H5L9,10Z',
 'external':'M14,3H21V10M21,3L10,14M11,4H3V21H20V13',
 'link':'M9,15L15,9M8,11L5,14A3,3 0,0 0,10,19L13,16M11,8L14,5A3,3 0,0 1,19,10L16,13',
 'network':'M3,3H9V9H3ZM15,15H21V21H15ZM6,9V18H15M15,3H21V9H15ZM18,9V15',
 'card':'M2,4H22V20H2ZM2,9H22M5,15H10',
 'moon':'M17,3A9,9 0,1 0,21,17A9,9 0,0 1,17,3Z',
 'sun':'M16,12A4,4 0,1 1,8,12A4,4 0,1 1,16,12M12,1V4M12,20V23M1,12H4M20,12H23M4,4L6,6M18,18L20,20M4,20L6,18M18,6L20,4',
 'person':'M16,6A4,4 0,1 1,8,6A4,4 0,1 1,16,6M3,22V19C3,11 21,11 21,19V22',
 'accessible':'M14,4A2,2 0,1 1,10,4A2,2 0,1 1,14,4M3,9H21M12,9V15M12,15L7,22M12,15L17,22',
 'cookie':'M15,3C14,7 17,10 21,9A9,9 0,1 1,15,3ZM8,8H8.1M7,14H7.1M13,17H13.1M13,11H13.1',
 'qr':'M2,2H9V9H2ZM15,2H22V9H15ZM2,15H9V22H2ZM15,15H18V18H22V22H15ZM5,5H6V6H5ZM18,5H19V6H18ZM5,18H6V19H5Z',
 'reader':'M3,3H21V21H3ZM7,7H17M7,12H17M7,17H14',
 'mail':'M2,5H22V19H2ZM2,5L12,13L22,5',
 'cloud':'M6,20A5,5 0,1 1,5,10A7,7 0,0 1,19,9A5,5 0,1 1,19,20Z',
 'storage':'M3,3H21V9H3ZM3,15H21V21H3ZM17,6H17.1M17,18H17.1',
 'zoom':'M3,3H18V18H3ZM7,10H14M10,7V14M17,17L22,22',
 'sort':'M5,3V21M2,18L5,21L8,18M11,5H22M11,11H19M11,17H16',
 'swap':'M3,7H21L17,3M21,17H3L7,21',
 'tool':'M4,20L13,11C10,8 13,2 17,3L15,7L18,10L22,8C23,13 18,16 15,13L6,22Z',
 'spark':'M12,2L15,9L22,12L15,15L12,22L9,15L2,12L9,9Z',
 'heart':'M12,21L3,12C-2,4 8,0 12,7C16,0 26,4 21,12Z',
 'sound':'M7,10H3V15H7L13,21V4ZM17,8Q22,12 17,17',
 'briefcase':'M3,7H21V21H3ZM8,7V3H16V7M3,13H21',
 'cart':'M2,3H5L8,16H20L22,7H6M10,21H10.1M19,21H19.1',
 'gift':'M3,8H21V13H3ZM5,13V22H19V13M12,8V22M12,8C2,8 4,-2 12,8C20,-2 22,8 12,8',
 'hourglass':'M5,2H19M5,22H19M7,2V7L17,17V22M17,2V7L7,17V22',
 'flight':'M12,2L15,10L22,14V16L14,14V19L17,21H7L10,19V14L2,16V14L9,10Z',
 'chart':'M3,3V21H22M6,16L11,10L15,14L21,5',
 'flag':'M4,22V2M4,3H21L17,8L21,13H4',
 'focus':'M3,8V3H8M16,3H21V8M21,16V21H16M8,21H3V16',
}


def symbol(name):
    """Map every named resource to a functional concept, before state modifiers."""
    n=name.removeprefix('mozac_ic_').removeprefix('ic_')
    if n.startswith('flag_'): return 'globe'
    rules=[
     ('chevron|dropdown','down'),('arrow_counter|arrow_clockwise|refresh|reload|sync|update','reload'),
     ('arrow_trending|chart|profiler','chart'),('append|forward','forward'),('back','back'),
     ('ellipsis.*vertical|more_vertical','morevertical'),('ellipsis|more_horizontal','more'),
     ('app_menu','menu'),('plus','plus'),('add_to_homescreen','home'),('microsurvey_success','check'),('cross|delete_me','cross'),('checkmark|color_picker','check'),
     ('bookmark','bookmark'),('star|favourite','star'),('history','history'),
     ('download|import|save_file','download'),('share','share'),('settings|permissions|permission','settings'),
     ('globe|logo_chrome|logo_safari|pwa|search_engine_placeholder','globe'),('shield|protection|etp','protection'),
     ('private','private'),('passkey|login|key','key'),('lock','lock'),('tab_group|collection|tab_tray','tabs'),
     ('tab','tab'),('indicator|dot_notification','info'),('translate','reader'),('fence','grid'),('search|find_in_page','search'),('folder','folder'),('clipboard','clipboard'),('copy','copy'),('delete|data_clearance','trash'),
     ('edit|signature','edit'),('more_grid|grid|select_all','grid'),('warning|critical|crash','warning'),
     ('information|site_info','info'),('help|question','help'),('desktop','desktop'),('tablet','tablet'),('mobile|device','phone'),
     ('image|wallpaper','image'),('camera|google_lens','camera'),('microphone','microphone'),('eye','eye'),('location','location'),
     ('notification','bell'),('autoplay|playing|play','play'),('paused|pause','pause'),('stop','stop'),
     ('print','print'),('pin','pin'),('external','external'),('network|local_host','network'),('link','link'),
     ('credit_card|cc_logo','card'),('night|moon','moon'),('theme|sun','sun'),('avatar|account|social','person'),
     ('accessibility','accessible'),('cookie','cookie'),('qr_cam_focus','focus'),('qr','qr'),('reader|reading_list|newsfeed','reader'),
     ('email','mail'),('cloud','cloud'),('storage','storage'),('zoom','zoom'),('sort','sort'),('swap','swap'),
     ('tool|extension_cog','tool'),('spark|lightning|lightbulb|whats_new','spark'),('heart|thumbs','heart'),
     ('audio|sound','sound'),('video','play'),('document|file|page_portrait|save','document'),
     ('home|shortcut','home'),('briefcase|packaging|shipping','briefcase'),('shopping|cart|price|dollar','cart'),
     ('gift','gift'),('hourglass','hourglass'),('airplane|flight|vacation','flight'),('qr_cam_focus','focus'),
     ('fingerprint|cryptominer','private'),('cursor','forward'),('extension|plugin|labs|experiment|debug','tool'),
     ('ball|cricket|golf|racing|hockey|competitiveness|quality|food|fruit|tree|pet|chill|fence|circle','globe'),
    ]
    if 'chevron' in n or 'dropdown' in n:
        return next((d for d in ['left','right','up'] if d in n),'down')
    for pattern,result in rules:
        if re.search(pattern,n):return result
    raise ValueError('Unclassified functional icon: '+name)


def vector(name,width='24dp',height='24dp',path=None):
    key=symbol(name) if path is None else None
    geometry=path if path is not None else PATHS[key]
    if 'slash' in name or 'off_for_a_site' in name:
        geometry+='M2,2L22,22'
    mirrored = '    android:autoMirrored="true"\n' if any(word in name for word in ('back_', 'forward_', 'chevron_left', 'chevron_right')) else ''
    return HEADER+f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="{width}" android:height="{height}"
    android:viewportWidth="24" android:viewportHeight="24"
{mirrored}    android:tint="?android:attr/textColorPrimary">
    <path android:pathData="{geometry}" android:fillColor="@android:color/transparent"
        android:strokeColor="#FFFFFFFF" android:strokeWidth="1.65"
        android:strokeLineCap="round" android:strokeLineJoin="round" />
</vector>
'''


def main():
    manifest_path=ROOT/'wildbuzzard/android/ui-artwork.json'
    # Preserve the original inventory on regeneration.
    old=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest=old.get('resources',{})
    aliases=set(old.get('brand_aliases',[]))
    baseline = 'ac1d153497b7'
    tracked = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', baseline, 'mobile/android/fenix/app/src/main/res', 'mobile/android/android-components/components'], cwd=ROOT, text=True).splitlines()
    inputs = [ROOT / p for p in tracked if '/src/main/res/' in p and Path(p).parent.name.startswith(('drawable', 'mipmap'))]
    for src in sorted(inputs):
        if not src.parent.name.startswith(('drawable','mipmap')) or src.name=='wildbuzzard_logo.png':continue
        rel=str(src.relative_to(ROOT)); name=src.name.split('.')[0]
        data=subprocess.check_output(['git','show',baseline+':'+rel],cwd=ROOT);kind=ET.fromstring(data).tag if src.suffix=='.xml' else src.suffix
        if src.suffix=='.xml' and list(ET.fromstring(data).iter('path')): kind='vector'
        row={'sha256':hashlib.sha256(data).hexdigest(),'type':kind}
        is_app=src.is_relative_to(RES)
        if kind not in ['vector','.png','.webp'] or '.9.' in src.name:
            row['action']='structural drawable; contains no illustration';manifest[rel]=row;continue
        decorative=is_app and bool(re.search(r'fox|kit_|^kit|onboarding|^nova_|^ic_(cool|cuddling|minimal|momo|pixelated|pride|retro|flaming|high_five)|illustration|wordmark|^fenix_|^ic_launcher_(foreground|monochrome|private_foreground)|sports_widget_celebration|review_prompt',name))
        decorative |= 'firefox' in name or name=='ic_status_logo'
        # Toolbar previews convey choices; independently draw their layout below.
        decorative &= 'toolbar' not in name
        out=RES/src.parent.name/(name+'.xml')
        if decorative:
            if is_app:src.unlink(missing_ok=True)
            aliases.add(name)
            row['action']='Wild Buzzard logo alias'
        elif 'launcher_' in name and 'background' in name:
            out.write_text(HEADER+'<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#1B1A17" /></shape>\n')
            row['action']='solid Wild Buzzard background'
        elif 'toolbar' in name and ('preview' in name or 'onboarding' in name or 'selected' in name or 'active' in name):
            y=4 if 'top' in name else 17
            color='#FFB13B' if ('selected' in name and 'unselected' not in name) or ('active' in name and 'inactive' not in name) else '#888888'
            preview = f'M3,1H21V23H3ZM6,{y}H18V{y+3}H6ZM6,10H18M6,13H14'
            if 'expanded' in name:
                sy, ny = (4, 9) if 'top' in name else (14, 20)
                preview = f'M3,1H21V23H3ZM6,{sy}H18V{sy+3}H6ZM7,{ny-1}L5,{ny}L7,{ny+1}M11,{ny}H13M18,{ny-1}V{ny+1}M17,{ny}H19'
            elif 'shortcut' in name and 'no_shortcut' not in name:
                preview = f'M3,1H21V23H3ZM5,{y}H14V{y+3}H5ZM18,{y}V{y+3}M16.5,{y+1.5}H19.5M6,10H18M6,13H14'
            out.write_text(vector(name,'96dp','112dp',preview).replace('?android:attr/textColorPrimary',color))
            row['action']='original toolbar layout preview'
        else:
            node=ET.fromstring(data) if kind=='vector' else None
            width=node.get(A+'width','24dp') if node is not None else '24dp'
            height=node.get(A+'height','24dp') if node is not None else '24dp'
            out.parent.mkdir(parents=True,exist_ok=True)
            out.write_text(vector(name,width,height))
            if is_app and src!=out:src.unlink(missing_ok=True)
            row['action']='original '+symbol(name)+' icon'
        manifest[rel]=row
    # Alias every density to one brand image. Remove qualifier overrides from the app.
    for name in aliases:
        for p in list(RES.glob('drawable*/'+name+'.*'))+list(RES.glob('mipmap*/'+name+'.*')):
            p.unlink()
    (RES/'values/wildbuzzard_artwork.xml').write_text(HEADER+'<resources>\n'+''.join(f'    <item type="drawable" name="{n}">@drawable/wildbuzzard_logo</item>\n' for n in sorted(aliases))+'</resources>\n')
    assets=ROOT/'mobile/android/fenix/app/src/main/assets'
    for src in (COMPONENTS/'ui/icons/src/main/assets').glob('*.svg'):
        name=src.stem
        key='lock' if 'lock' in name else 'warning' if any(x in name for x in ['shred','confused','surprised']) else 'globe' if 'internet' in name else 'hourglass' if 'hourglass' in name else 'info'
        (assets/src.name).write_text('<!-- SPDX-License-Identifier: AGPL-3.0-or-later; original Wild Buzzard artwork. -->\n'+f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="{PATHS[key]}" fill="none" stroke="#b89b65" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n')
    # Remove flavor-specific artwork that would otherwise override main branding.
    for flavor in ('debug', 'beta', 'nightly', 'release'):
        base = ROOT / 'mobile/android/fenix/app/src' / flavor
        originals = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', baseline, str(base.relative_to(ROOT))], cwd=ROOT, text=True).splitlines()
        for rel in originals:
            src = ROOT / rel
            if src.suffix not in ('.png', '.webp', '.xml') or ('/res/drawable' not in rel and '/res/mipmap' not in rel and 'ic_launcher-' not in rel): continue
            data = subprocess.check_output(['git', 'show', baseline+':'+rel], cwd=ROOT)
            manifest[rel] = {'sha256': hashlib.sha256(data).hexdigest(), 'type': src.suffix, 'action': 'remove flavor override; inherit Wild Buzzard branding'}
            src.unlink(missing_ok=True)
    # Launcher resources inherit the same brand in every build channel.
    (RES / 'values/wildbuzzard_launcher.xml').write_text(HEADER + '<resources><item type="mipmap" name="ic_launcher">@drawable/wildbuzzard_logo</item><item type="mipmap" name="ic_launcher_round">@drawable/wildbuzzard_logo</item></resources>\n')
    launcher = RES / 'mipmap-anydpi-v26'
    launcher.mkdir(exist_ok=True)
    for name in ('ic_launcher', 'ic_launcher_round'):
        (launcher / (name+'.xml')).write_text(HEADER + '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/wildbuzzard_launcher_background"/><foreground android:drawable="@drawable/wildbuzzard_logo"/><monochrome android:drawable="@drawable/wildbuzzard_logo"/></adaptive-icon>\n')
    (RES / 'values/wildbuzzard_launcher_colors.xml').write_text(HEADER + '<resources><color name="wildbuzzard_launcher_background">#1B1A17</color></resources>\n')
    manifest_path.write_text(json.dumps({'description':'Original-resource audit; generated app overrides replace upstream illustration and icon geometry. Structural shapes/selectors retain upstream licenses. Website content and Android framework controls are outside app branding.','brand_aliases':sorted(aliases),'resources':dict(sorted(manifest.items())), 'pdf_viewer_images':old.get('pdf_viewer_images', {}), 'engine_resources':old.get('engine_resources', {}), 'android_extension_assets':old.get('android_extension_assets', {})},indent=2)+'\n')
    print(f'Audited {len(manifest)} drawable variants; {len(aliases)} brand aliases.')

if __name__=='__main__':main()
