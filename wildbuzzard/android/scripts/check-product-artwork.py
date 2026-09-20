#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Verify the actual APK resolves Mozilla resource IDs to product artwork.

This checks merged resources after flavor/library overrides and obfuscation,
not only filenames in the source tree. New packaged engine images require an
explicit audit entry. Android framework/third-party Material resources and
structural nine-patch backgrounds are outside Mozilla artwork replacement.
"""
import argparse
import hashlib
import io
import os
import shutil
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parents[3]
RES=ROOT/'mobile/android/fenix/app/src/main/res'
A='{http://schemas.android.com/apk/res/android}'


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('apk',type=Path)
 parser.add_argument('--aapt2',default='aapt2')
 parser.add_argument('--source',help='Verify against this recorded git revision instead of working-tree files')
 parser.add_argument('--report',type=Path,required=True)
 args=parser.parse_args()
 if args.aapt2 == 'aapt2' and not shutil.which('aapt2'):
  candidates=[]
  for name in ('MOZBUILD_STATE_PATH','ANDROID_HOME','ANDROID_SDK_ROOT'):
   if os.environ.get(name):candidates.extend(Path(os.environ[name]).rglob('aapt2'))
  candidates=[p for p in candidates if p.is_file() and os.access(p,os.X_OK)]
  if not candidates:raise SystemExit('Pass --aapt2 or configure the Android SDK')
  args.aapt2=str(sorted(candidates)[-1])
 def read_source(path):
  return subprocess.check_output(['git','show',args.source+':'+str(path.relative_to(ROOT))],cwd=ROOT) if args.source else path.read_bytes()
 def source_paths(prefix):
  if args.source:
   return [ROOT/p for p in subprocess.check_output(['git','ls-tree','-r','--name-only',args.source,str(prefix.relative_to(ROOT))],cwd=ROOT,text=True).splitlines()]
  return list(prefix.rglob('*'))
 inventory=json.loads(read_source(ROOT/'wildbuzzard/android/ui-artwork.json'))
 def aapt(*options):
  return subprocess.check_output([args.aapt2,'dump',*options,str(args.apk)],text=True,stderr=subprocess.PIPE)
 table=aapt('resources')
 resources={}
 for m in re.finditer(r'^    resource (0x[0-9a-f]+) ((?:drawable|mipmap)/\S+)\n((?:      .*\n)*)',table,re.M):
  resources[m[2]]={'id':m[1],'body':m[3]}
 ids={v['id']:k for k,v in resources.items()}
 def files(name,seen=()):
  if name in seen:raise AssertionError('Cyclic resource alias: '+name)
  body=resources[name]['body'];out=re.findall(r'\(file\) (\S+)',body)
  for ref in re.findall(r'\) @([^\s]+)',body):
   target=ids.get(ref,ref)
   assert target in resources,(name,target)
   out+=files(target,seen+(name,))
  return sorted(set(out))
 logo_files=files('drawable/wildbuzzard_logo')
 aliases_checked=0
 for name in inventory['brand_aliases']:
  name='drawable/'+name
  if name not in resources:continue
  assert files(name)==logo_files,'Brand alias still resolves to another image: '+name
  aliases_checked+=1
 # Inspect every packaged functional vector in all configurations. Resource
 # names survive shrinking even when APK file paths have been shortened.
 expected={}
 for p in source_paths(RES):
  if not p.parent.name.startswith('drawable') or p.suffix!='.xml':continue
  content=read_source(p)
  try:node=ET.fromstring(content)
  except ET.ParseError:continue
  if node.tag!='vector' or b'original Wild Buzzard artwork' not in content:continue
  expected.setdefault('drawable/'+p.stem,[]).append(tuple(n.get(A+'pathData') for n in node.iter('path')))
 vectors_checked=0;cache={}
 for name,paths in expected.items():
  if name not in resources:continue
  for member in files(name):
   if member not in cache:
    dump=aapt('xmltree','--file',member)
    cache[member]=tuple(re.findall(r'pathData\([^)]*\)="([^"]*)"',dump))
   assert cache[member] in paths,'Packaged vector differs from original product geometry: '+name+' '+member
   vectors_checked+=1
 engine_checked=0;error_assets_checked=0
 with zipfile.ZipFile(args.apk) as apk:
  for p in source_paths(ROOT/'mobile/android/fenix/app/src/main/assets'):
   if not p.name.startswith('mozac_error_') or p.suffix!='.svg':continue
   assert apk.read('assets/'+p.name)==read_source(p),'Old Android error illustration: '+p.name
   error_assets_checked+=1
  with zipfile.ZipFile(io.BytesIO(apk.read('assets/omni.ja'))) as omni:
   audited={member:ROOT/row['source'] for member,row in inventory['engine_resources'].items()}
   audited.update({'chrome/pdfjs/content/web/images/'+Path(source).name:ROOT/source for source in inventory['pdf_viewer_images']})
   branded={'chrome/geckoview/content/branding/'+name:ROOT/'mobile/android/branding/wildbuzzard/content'/name for name in ['about.png','favicon32.png','favicon64.png']}
   audited.update(branded)
   for member in omni.namelist():
    if not member.endswith(('.svg','.png','.webp','.jpg','.jpeg','.gif','.ico','.avif')):continue
    assert member in audited,'Unaudited image in packaged engine: '+member
    assert omni.read(member)==read_source(audited[member]),'Packaged engine image is stale: '+member
    engine_checked+=1
 result={'source':args.source or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'apk_sha256':hashlib.sha256(args.apk.read_bytes()).hexdigest(),'brand_aliases_verified':aliases_checked,'functional_vector_variants_verified':vectors_checked,'android_error_images_verified':error_assets_checked,'packaged_engine_images_verified':engine_checked,'all_passed':True}
 args.report.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':main()
