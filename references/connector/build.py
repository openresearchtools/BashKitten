#!/usr/bin/env python3
"""Build the ordinary References WebExtension from the pristine released Connector."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,zipfile,os,runpy
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]
WORK=ROOT/'.build/source'
OUT=ROOT/'dist/references'
VERSION='1.0.6'

def run(*args):subprocess.run(args,cwd=WORK,check=True,env={**os.environ,'NPM_CONFIG_OFFLINE':'true'})
# Keep npm's content cache; reconstruct source from the named patch every time.
if WORK.exists():shutil.rmtree(WORK)
shutil.copytree(ROOT/'upstream/source',WORK)
for patch in sorted((ROOT/'patches').glob('*.patch')):run('git','apply','--no-index','--unsafe-paths',str(patch))
shutil.copy(ROOT/'src/references.js',WORK/'src/common/references.js')
npm_sources=ROOT/'vendor/npm'
fetch_source=runpy.run_path(str(REPO/'agent/packaging/source_cache.py'))['fetch']
archives=[]
for entry in json.loads((npm_sources/'SOURCES.json').read_text())['archives']:
 relative=Path(entry['archive'])
 if relative.is_absolute() or '..' in relative.parts:raise SystemExit('Invalid npm source seed path')
 archive=fetch_source(entry,local=npm_sources/relative)
 archives.append({**entry,'path':str(archive.resolve())})
cache_inputs=ROOT/'.build/npm-archives.json'
cache_inputs.write_text(json.dumps({'archives':archives,'lockfile':str(WORK/'package-lock.json')})+'\n')
npm_cache=ROOT/'.build/npm-cache'
run('node',str(ROOT/'seed-cache.cjs'),str(Path(shutil.which('npm')).resolve()),str(npm_cache),str(cache_inputs))
run('npm','ci','--offline','--cache',str(npm_cache),'--ignore-scripts','--no-audit','--no-fund')
run('bash','build.sh','-v',VERSION)
if OUT.exists():shutil.rmtree(OUT)
shutil.copytree(WORK/'build/firefox',OUT)
shutil.copytree(ROOT/'src/references',OUT/'references')
shutil.copy(ROOT.parent/'web/theme.css',OUT/'references/theme.css')
shutil.copytree(ROOT/'legal',OUT/'legal')
shutil.copy(ROOT/'upstream/SOURCE.json',OUT/'legal/connector-source.json')
for directory in ['preferences','integration','tools','test','offscreen']:
 shutil.rmtree(OUT/directory,ignore_errors=True)
for filename in ['api.js','oauthsimple.js','updaterFix.js','manifest-v3.json']:
 (OUT/filename).unlink(missing_ok=True)
# Use the References artwork for native action and per-tab status icons.
# Donor legal attribution stays in legal/; main BashKitten branding is separate.
icons=ROOT/'src/icons'
for size in [16,32,64,128]:shutil.copy(icons/f'Icon-{size}.png',OUT/f'Icon-{size}.png')
for path in (OUT/'images').rglob('*zotero*'):
 if path.suffix=='.png':shutil.copy(icons/('Icon-16.png' if '-16px' in path.name else 'Icon-32.png'),path)
# Retired cloud/reporting/editor surfaces must not advertise donor services.
retired_messages=('integration_', 'reports_', 'preferences_onlineLibrary_',
 'preferences_googleDocs', 'preferences_translators_reportErrors', 'firstRun_',
 'permissions_siteAccess_message_repo_required', 'permissions_siteAccess_message_api_required',
 'error_connection_enableSavingToOnlineLibrary')
message_overrides={
 'browserAction_incompatibleVersion':'References capture $2 is incompatible with the selected backend$3. Install matching supported References components.',
 'expiredBetaBuild_message':'This References capture build has expired. Install a supported signed References package.',
 'progressWindow_savingToOnlineLibrary':'References backend unavailable',
 'progressWindow_error_noTranslator':'No items could be saved because this website is not supported by a References translator.',
}
for path in (OUT/'_locales').glob('*/messages.json'):
 data=json.loads(path.read_text())
 for key in list(data):
  if key.startswith(retired_messages):
   del data[key];continue
  record=data[key]
  if isinstance(record,dict) and isinstance(record.get('message'),str):
   record['message']=message_overrides.get(key,record['message'].replace('Zotero Connector','References').replace('Zotero','References'))
   if re.search(r'zotero\.org|References Forums',record['message'],re.I):raise SystemExit('Unadapted product locale: '+str(path)+': '+key)
 path.write_text(json.dumps(data,ensure_ascii=False)+'\n')
for path in OUT.rglob('*.html'):
 if path.is_relative_to(OUT/'references'):continue  # Authored product pages already retain intentional legal attribution.
 text=path.read_text(encoding='utf-8-sig').replace('Zotero Connector','References').replace('>Zotero<','>References<').replace('<title>Zotero - Confirm Import','<title>References — Confirm Import').replace('>Zotero Item Selector','>References Item Selector')
 path.write_text(text)
manifest=json.loads((OUT/'manifest.json').read_text())
manifest.update(name='References',description='Capture references into the selected BashKitten project.',homepage_url='https://github.com/openresearchtools/BashKitten')
manifest['browser_action']['default_title']='References Add'
manifest['browser_action']['default_area']='navbar'
manifest['browser_action']['default_icon']={'16':'Icon-16.png','32':'Icon-32.png','48':'Icon-64.png'}
# Keep Gecko's configurable action command without the donor's screenshot shortcut.
manifest['commands']['_execute_browser_action'].pop('suggested_key',None)
manifest.pop('applications',None)
# Capture sends page URLs/content to the selected local or remote backend.
# Use Gecko's existing required-data prompt, available on desktop 140 / Android 142.
manifest['browser_specific_settings']={
 'gecko':{'id':'references@bashkitten.org','strict_min_version':'140.0',
          'data_collection_permissions':{'required':['browsingActivity','websiteContent']}},
 'gecko_android':{'strict_min_version':'142.0'},
}
manifest['content_scripts']=[script for script in manifest['content_scripts'] if script['matches']==['http://*/*','https://*/*']]
manifest['permissions']=[p for p in manifest['permissions'] if p not in ['http://127.0.0.1/*','https://repo.zotero.org/*','https://api.zotero.org/*']]
manifest['options_ui']={'page':'references/about.html','open_in_tab':True}
manifest['web_accessible_resources']=[p for p in manifest['web_accessible_resources'] if not p.startswith('test/')]
manifest.pop('minimum_chrome_version',None)
# Firefox does not need the MV3 virtual offscreen implementation.
manifest['background']['scripts']=[p for p in manifest['background']['scripts'] if not p.startswith(('offscreen/','background/offscreen'))]
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Bundle immutable translator code as ordinary extension resources, never moving startup fetches.
translators=ROOT.parent/'vendor/translators/source'
if not translators.is_dir():raise SystemExit('Pinned References translator source is required')
(OUT/'translators').mkdir();metadata=[]
for path in sorted(translators.glob('*.js')):
 text=path.read_text(encoding='utf-8-sig');match=re.match(r'^\s*({[\s\S]*?})\s*\n',text)
 if not match:continue
 info=json.loads(match[1]);identifier=info.get('translatorID')
 if not identifier:continue
 metadata.append(info);(OUT/'translators'/f'{identifier}.js').write_text(text.split('/** BEGIN TEST CASES **/')[0])
(OUT/'translators/metadata.json').write_text(json.dumps(metadata,ensure_ascii=False)+'\n')
for name in ['COPYING','LICENSE','LICENSE.md','README.md']:
 if (translators/name).is_file():shutil.copy(translators/name,OUT/'legal'/f'translators-{name}')
# Preserve actual shipped dependency licenses from the pinned npm installation.
legal_records=[]
def legal_record(name,version,license,files):
 if not files:raise SystemExit('Missing full Connector license: '+name)
 texts=[]
 for path in files:
  data=path.read_bytes()
  try:text=data.decode('utf-8')
  except UnicodeDecodeError:text=data.decode('latin1')
  if not text.strip():raise SystemExit('Empty Connector license: '+str(path))
  texts.append(str(path.relative_to(OUT))+'\n'+text)
 legal_records.append({'name':name,'version':version,'license':license,'text':'\n\n'.join(texts)})

supplements=json.loads((ROOT/'legal/sources.json').read_text())
for entry in supplements['components']:
 file=ROOT/'legal'/entry['file'];selection=entry['appliesTo']
 package=WORK/'node_modules'/selection['package']
 package_metadata=json.loads((package/'package.json').read_text())
 if (Path(entry['file']).is_absolute() or '..' in Path(entry['file']).parts
     or Path(selection['file']).is_absolute() or '..' in Path(selection['file']).parts
     or hashlib.sha256(file.read_bytes()).hexdigest()!=entry['sha256']
     or package_metadata['version']!=selection['version']
     or hashlib.sha256((package/selection['file']).read_bytes()).hexdigest()!=selection['sha256']):
  raise SystemExit('Connector legal supplement or selected source changed: '+entry['name'])
 legal_record(entry['name'],entry['version'],entry['license'],[OUT/'legal'/entry['file']])
runtime_packages=['react','react-dom','react-dom-factories','prop-types','dompurify','single-file-core']
visited=set()
while runtime_packages:
 package=runtime_packages.pop()
 if package in visited:continue
 visited.add(package)
 folder=WORK/'node_modules'/package
 package_json=json.loads((folder/'package.json').read_text())
 runtime_packages.extend(package_json.get('dependencies',{}))
 texts=[]
 for path in folder.iterdir():
  if path.is_file() and re.match(r'^(LICENSE|LICENCE|COPYING|NOTICE)',path.name,re.I):
   target=OUT/'legal'/(package.replace('/','-')+'-'+path.name)
   shutil.copy(path,target);texts.append(target)
 if not texts:
  texts=[OUT/'legal'/entry['file'] for entry in supplements['components']
         if entry['appliesTo']['package']==package]
 legal_record(package,package_json['version'],package_json.get('license','See original notices'),texts)
 if package=='single-file-core':
  # Upstream's prebuilt bundle removes comments. Keep the actual imported
  # vendor sources' full grants and attributions alongside its AGPL notice.
  comments=[];seen=set()
  for path in sorted((folder/'vendor').rglob('*.js')):
   for comment in re.findall(r'/\*[\s\S]*?\*/',path.read_text()):
    if re.search(r'copyright|licen[cs]e',comment,re.I) and comment not in seen:
     seen.add(comment);comments.append(str(path.relative_to(folder))+'\n'+comment)
  if not comments:raise SystemExit('Missing SingleFile vendor source notices')
  target=OUT/'legal/SingleFile-vendor-NOTICES.txt';target.write_text('\n\n'.join(comments)+'\n')
  legal_record('SingleFile embedded vendor sources',package_json['version'],'Original per-file MIT/BSD/AGPL and other terms',[target])
if any(entry['appliesTo']['package'] not in visited for entry in supplements['components']):
 raise SystemExit('Connector legal supplement no longer belongs to a shipped package')
for package in ['translate','utilities','zotero-schema']:
 texts=[]
 for path in (ROOT/'upstream/source/src'/package).iterdir():
  if path.is_file() and re.match(r'^(LICENSE|LICENCE|COPYING|NOTICE)',path.name,re.I):
   target=OUT/'legal'/(package+'-'+path.name);shutil.copy(path,target);texts.append(target)
 # Schema is part of the donor's retained COPYING; its own source has no
 # standalone license. Keep that actual upstream ownership distinction.
 legal_record('Zotero '+package,'Pinned in connector-source.json','See original notices',texts or [OUT/'COPYING'])
shared=ROOT.parent/'legal';shared_pin=json.loads((shared/'Utilities-third-party-source.json').read_text())
for entry in shared_pin['components']:
 path=shared/entry['file']
 if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:
  raise SystemExit('Shared Utilities license checksum changed: '+entry['name'])
 target=OUT/'legal'/entry['file'];shutil.copy(path,target)
 legal_record('Utilities: '+entry['name'],entry['version'],entry['license'],[target])
 if entry.get('originalFile'):
  original=shared/entry['originalFile']
  if hashlib.sha256(original.read_bytes()).hexdigest()!=entry['originalFileSha256']:
   raise SystemExit('Shared Utilities original notice checksum changed: '+entry['name'])
  shutil.copy(original,OUT/'legal'/entry['originalFile'])
shutil.copy(shared/'Utilities-third-party-source.json',OUT/'legal/Utilities-third-party-source.json')
comments=[];seen=set()
for path in sorted(OUT.rglob('*.js')):
 if path.is_relative_to(OUT/'lib/SingleFile'):continue # Collected from its unminified pinned source above.
 for comment in re.findall(r'/\*[\s\S]*?\*/',path.read_text()):
  if re.search(r'copyright|licen[cs]e',comment,re.I) and comment not in seen:
   seen.add(comment);comments.append(str(path.relative_to(OUT))+'\n'+comment)
target=OUT/'legal/Connector-source-NOTICES.txt';target.write_text('\n\n'.join(comments)+'\n')
legal_record('Connector and translator source copyrights','Pinned in connector-source.json','Original per-file terms',[target,OUT/'COPYING',OUT/'legal/NOTICE.md'])
# DOMPurify's retained full dual-license text also contains the complete MPL2
# required by the shipped Mozilla browser-polyfill source.
mpl=OUT/'legal/dompurify-LICENSE'
if 'Mozilla Public License, version 2.0' not in mpl.read_text():raise SystemExit('Missing full browser-polyfill MPL2 license')
legal_record('Mozilla WebExtension browser-polyfill','0.1.1','MPL-2.0',[mpl])
(OUT/'legal/licenses.json').write_text(json.dumps(legal_records,indent=2)+'\n')
(OUT/'legal/THIRD_PARTY_NOTICES.txt').write_text('\n\n'.join(
 entry['name']+' '+entry['version']+'\n'+entry['license']+'\n\n'+entry['text'] for entry in legal_records)+'\n')
# Verify resource graph and compile syntax only; product behavior is checked in the installed app.
for name in manifest['background']['scripts']+sum([x['js'] for x in manifest['content_scripts']],[]):
 if not (OUT/name).is_file():raise SystemExit('Missing manifest resource: '+name)
for path in [OUT/'references.js',OUT/'background.js',OUT/'connector.js',OUT/'itemSaver.js',OUT/'itemSaver_background.js',OUT/'inject/pageSaving.js']:
 subprocess.run(['node','--check',str(path)],check=True,stdout=subprocess.DEVNULL)
checksums={str(p.relative_to(OUT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.rglob('*')) if p.is_file()}
(ROOT/'dist/runtime-sha256.json').write_text(json.dumps(checksums,indent=2)+'\n')
xpi=ROOT/'dist/references.xpi'
with zipfile.ZipFile(xpi,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for path in sorted(OUT.rglob('*')):
  if path.is_file():
   info=zipfile.ZipInfo(str(path.relative_to(OUT)),date_time=(2026,10,28,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;archive.writestr(info,path.read_bytes())
result={'version':VERSION,'extensionId':'references@bashkitten.org','hostId':'references-host@bashkitten.org','hostApi':1,'connectorApi':3,'translatorCount':len(metadata),'translatorCommit':'c83003773b65359e41466e1d419b2d1df5512af7','sha256':hashlib.sha256(xpi.read_bytes()).hexdigest(),'signed':False}
(ROOT/'dist/component.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
