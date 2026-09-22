#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Replace PDF viewer image geometry, preserving its original audit hashes."""
import importlib.util,re,json,hashlib,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('art',root/'bashkitten/android/scripts/generate-ui-artwork.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
x=json.loads((root/'bashkitten/android/ui-artwork.json').read_text());rows={}
for p in (root/'toolkit/components/pdfjs/content/web/images').glob('*.svg'):
 n=p.stem.lower()
 rules=[('download','download'),('print','print'),('zoomin','plus'),('zoomout','minus'),('close|closing|delete','cross'),('check|done|selected','check'),('next|pagedown|lastpage','down'),('previous|pageup|firstpage','up'),('expanded|menuarrow|viewarrow','down'),('collapsed','right'),('bookmark','bookmark'),('search','search'),('warning','warning'),('key','key'),('help','help'),('pushpin','pin'),('paperclip|attachments','link'),('edit|signature|ink|highlight','edit'),('thumbnail|viewsmanager|layers|spread|scroll','tabs'),('outline','reader'),('properties|info|disclaimer','info'),('presentation','desktop'),('comment|note|paragraph|insert|freetext','document'),('loading|spinner|rotate','reload'),('add','plus'),('handtool|selecttool','accessible'),('noicon','empty'),('viewbutton','tabs'),('secondarytoolbartoggle|actionsbutton','more')]
 key=next((v for pat,v in rules if re.search(pat,n)),None)
 if key is None:raise ValueError(n)
 data=subprocess.check_output(['git','show','ac1d153497b7:'+str(p.relative_to(root))],cwd=root);path='M4,12H20' if key=='minus' else '' if key=='empty' else a.PATHS[key]
 # SVGs are used both as CSS masks and as direct images in the viewer.
 p.write_text('<!-- SPDX-License-Identifier: AGPL-3.0-or-later; original Wild Buzzard artwork. -->\n'+f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="{path}" fill="none" stroke="#555555" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>\n')
 rows[str(p.relative_to(root))]={'sha256':hashlib.sha256(data).hexdigest(),'action':'original '+key+' icon'}
x['pdf_viewer_images']=rows;(root/'bashkitten/android/ui-artwork.json').write_text(json.dumps(x,indent=2)+'\n');print('PDF icons replaced:',len(rows))
