#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Replace browser-owned extension artwork in the final Android asset merge."""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('product_icons', Path(__file__).with_name('generate-ui-artwork.py'))
icons=importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)
assets=ROOT/'mobile/android/fenix/app/src/main/assets'
p=ROOT/'wildbuzzard/android/ui-artwork.json'
inventory=json.loads(p.read_text())
rows={}
sources={'extensions/webcompat-reporter/icons/lightbulb.svg':('mobile/android/android-components/components/feature/webcompat-reporter/src/main/assets/extensions/webcompat-reporter/icons/lightbulb.svg','info')}
for name,symbol in {'disqus':'document','facebook':'person','instagram':'image','play':'play','tiktok':'play','x-logo':'document'}.items():
 sources['extensions/webcompat/shims/'+name+'.svg']=('browser/extensions/webcompat/shims/'+name+'.svg',symbol)
for member,(original,symbol) in sources.items():
 out=assets/member
 out.parent.mkdir(parents=True,exist_ok=True)
 out.write_text('<!-- SPDX-License-Identifier: AGPL-3.0-or-later; original Wild Buzzard artwork. -->\n'+f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="{icons.PATHS[symbol]}" fill="none" stroke="#b89b65" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>\n')
 rows['assets/'+member]={'source':str(out.relative_to(ROOT)),'original_source':original,'original_sha256':hashlib.sha256((ROOT/original).read_bytes()).hexdigest(),'action':'original '+symbol+' icon'}
# This local transparent placeholder replaces blocked tracking pixels; it is
# structural image data and is not browser illustration or an outbound request.
original='browser/extensions/webcompat/shims/tracking-pixel.png'
rows['assets/extensions/webcompat/shims/tracking-pixel.png']={'source':original,'action':'transparent structural placeholder','sha256':hashlib.sha256((ROOT/original).read_bytes()).hexdigest()}
inventory['android_extension_assets']=rows
for name in ('ic_launcher-web.webp','ic_launcher_private-web.webp'):
 rel='mobile/android/fenix/app/src/main/'+name
 data=subprocess.check_output(['git','show','ac1d153497b7:'+rel],cwd=ROOT)
 inventory['resources'][rel]={'sha256':hashlib.sha256(data).hexdigest(),'type':'.webp','action':'remove unused upstream store artwork; launcher uses Wild Buzzard logo'}
 (ROOT/rel).unlink(missing_ok=True)
p.write_text(json.dumps(inventory,indent=2)+'\n')
print('Audited',len(rows),'browser-owned extension assets')
