#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Original chrome artwork for the resources packaged by Android Gecko.

The renderer only consumes our SVG geometry or the existing Wild Buzzard logo.
It never uses upstream artwork as input to the image renderer.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import struct
import subprocess

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('art',ROOT/'wildbuzzard/android/scripts/generate-ui-artwork.py')
art=importlib.util.module_from_spec(spec)
spec.loader.exec_module(art)
MAPPINGS={
 'chrome/browser/content/browser/blocker/blockerShield.svg':('browser/components/blocker/content/blockerShield.svg','protection'),
 'chrome/toolkit/content/global/elements/moz-checkbox-icon.svg':('toolkit/content/widgets/moz-checkbox/moz-checkbox-icon.svg','check'),
 'chrome/toolkit/content/global/httpsonlyerror/secure-broken.svg':('toolkit/components/httpsonlyerror/content/secure-broken.svg','warning'),
 'chrome/toolkit/content/global/megalist/icons/cpm-fox-illustration.svg':('toolkit/components/satchel/megalist/content/icons/cpm-fox-illustration.svg','brand-svg'),
 'chrome/toolkit/content/global/ml/mozilla-logo.webp':('toolkit/components/ml/content/mozilla-logo.webp','brand-webp'),
 'chrome/toolkit/res/broken-image.png':('layout/generic/broken-image.png','image'),
 'contentaccessible/close-12.svg':('layout/style/res/close-12.svg','cross'),
 'contentaccessible/html/folder.png':('toolkit/themes/shared/dirListing/folder.png','folder'),
 'chrome/toolkit/skin/classic/global/illustrations/error-malformed-url.svg':('toolkit/themes/shared/illustrations/error-malformed-url.svg','brand-svg'),
}
for name in ('normal','tilt-left','tilt-right'):
 MAPPINGS['chrome/toolkit/res/accessiblecaret-'+name+'.svg']=('layout/style/res/accessiblecaret-'+name+'.svg','caret')
for name,key in {'edit-copy':'copy','error':'warning','eye-slash':'eye-slash','eye':'eye','more':'more','open-in-new':'external','resizer':'resize'}.items():
 MAPPINGS['chrome/toolkit/skin/classic/global/icons/'+name+'.svg']=('toolkit/themes/shared/icons/'+name+'.svg',key)
for name,key in {
 'audio-muted':'sound-slash','audio':'sound','audioNoAudioButton':'sound-slash',
 'closed-caption-settings-button':'settings','closedCaptionButton-cc-off':'caption-slash','closedCaptionButton-cc-on':'caption',
 'fullscreenEnterButton':'focus','fullscreenExitButton':'focus','pause-fill':'pause','play-fill':'play',
 'picture-in-picture-enter-fullscreen-button':'focus','picture-in-picture-exit-fullscreen-button':'focus',
 'picture-in-picture-seekBackward-button':'back','picture-in-picture-seekForward-button':'forward',
 'error.png':'warning','stalled.png':'hourglass','throbber.png':'hourglass',
 'imagedoc-darknoise.png':'dark','imagedoc-lightnoise.png':'light',
}.items():
 if '.' not in name:name+='.svg'
 MAPPINGS['chrome/toolkit/skin/classic/global/media/'+name]=('toolkit/themes/shared/media/'+name,key)
for name,key in {'alert-small':'warning','command-pick-remote-touch':'accessible','command-pick':'forward','error-small':'warning','info-small':'info','resume':'play','stepOver':'forward'}.items():
 MAPPINGS['chrome/devtools/modules/devtools/shared/images/'+name+'.svg']=('devtools/shared/images/'+name+'.svg',key)
for name,key in {'add':'plus','arrow-down':'down','arrow-up':'up','dropmarker-right':'right','dropmarker':'down','lock':'lock','search':'search'}.items():
 MAPPINGS['chrome/geckoview/skin/images/'+name+'.svg']=('mobile/android/themes/geckoview/images/'+name+'.svg',key)


def main():
 rows={}
 for member,(source,key) in MAPPINGS.items():
  p=ROOT/source
  original=subprocess.check_output(['git','show','ac1d153497b7:'+source],cwd=ROOT)
  row={'source':source,'original_sha256':hashlib.sha256(original).hexdigest(),'action':'original '+key+' artwork'}
  if key=='brand-svg':
   p.write_bytes((ROOT/'wildbuzzard/browser/branding/content/about-logo.svg').read_bytes())
  elif key=='brand-webp':
   subprocess.run(['magick',str(ROOT/'mobile/android/fenix/app/src/main/res/drawable-nodpi/wildbuzzard_logo.png'),'-strip','-define','webp:lossless=true',str(p)],check=True)
  else:
   extra={'caret':'M12,1V12M20,16A8,8 0,1 1,4,16A8,8 0,1 1,20,16', 'resize':'M7,21L21,7M14,21L21,14', 'caption':'M11,7H5V17H11M21,7H15V17H21'}
   base=key.removesuffix('-slash');d=extra.get(base,art.PATHS.get(base,''))
   if key.endswith('-slash'):d+='M2,2L22,22'
   svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="{d}" fill="none" stroke="#AFA38B" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>\n'
   if p.suffix=='.svg':p.write_text('<!-- SPDX-License-Identifier: AGPL-3.0-or-later; original Wild Buzzard artwork. -->\n'+svg)
   else:
    width,height=struct.unpack('>II',original[16:24])
    if key in ('dark','light'):
     subprocess.run(['magick','-size',f'{width}x{height}','xc:'+('#24221E' if key=='dark' else '#F2F0E9'),'-strip',str(p)],check=True)
    else:
     subprocess.run(['magick','-background','none','svg:-','-resize',f'{width}x{height}!','-strip',str(p)],input=svg.encode(),check=True)
  row['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();rows[member]=row
 path=ROOT/'wildbuzzard/android/ui-artwork.json';manifest=json.loads(path.read_text());manifest['engine_resources']=rows;path.write_text(json.dumps(manifest,indent=2)+'\n')
 print('Android Gecko artwork replaced:',len(rows))

if __name__=='__main__':main()
