#!/usr/bin/env python3
"""Build the ordinary References WebExtension from the pristine released Connector."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,zipfile,os
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]
WORK=ROOT/'.build/source'
OUT=ROOT/'dist/references'
VERSION='1.0.1'

def run(*args):subprocess.run(args,cwd=WORK,check=True,env={**os.environ,'NPM_CONFIG_OFFLINE':'true'})
# Keep npm's content cache; reconstruct source from the named patch every time.
if WORK.exists():shutil.rmtree(WORK)
shutil.copytree(ROOT/'upstream/source',WORK)
for patch in sorted((ROOT/'patches').glob('*.patch')):run('git','apply','--no-index','--unsafe-paths',str(patch))
shutil.copy(ROOT/'src/references.js',WORK/'src/common/references.js')
npm_sources=ROOT/'vendor/npm'
for entry in json.loads((npm_sources/'SOURCES.json').read_text())['archives']:
 if hashlib.sha256((npm_sources/entry['archive']).read_bytes()).hexdigest()!=entry['sha256']:raise SystemExit('Npm source checksum mismatch: '+entry['archive'])
npm_cache=ROOT/'.build/npm-cache'
run('node',str(ROOT/'seed-cache.cjs'),str(Path(shutil.which('npm')).resolve()),str(npm_cache),str(npm_sources))
run('npm','ci','--offline','--cache',str(npm_cache),'--ignore-scripts','--no-audit','--no-fund')
run('bash','build.sh','-v',VERSION)
if OUT.exists():shutil.rmtree(OUT)
shutil.copytree(WORK/'build/firefox',OUT)
shutil.copytree(ROOT/'src/references',OUT/'references')
shutil.copytree(ROOT/'legal',OUT/'legal')
shutil.copy(ROOT/'upstream/SOURCE.json',OUT/'legal/connector-source.json')
for directory in ['preferences','integration','tools','test','offscreen']:
 shutil.rmtree(OUT/directory,ignore_errors=True)
for filename in ['api.js','oauthsimple.js','updaterFix.js','manifest-v3.json']:
 (OUT/filename).unlink(missing_ok=True)
# Runtime package uses existing product icons; donor legal attribution stays in legal/.
branding=REPO/'browser/bashkitten/browser/branding'
for size in [16,32,64,128]:shutil.copy(branding/f'default{size}.png',OUT/f'Icon-{size}.png')
for path in (OUT/'images').rglob('*zotero*'):
 if path.suffix=='.png':shutil.copy(branding/('default16.png' if '-16px' in path.name else 'default32.png'),path)
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
manifest.pop('applications',None)
manifest['browser_specific_settings']={'gecko':{'id':'references@bashkitten.org','strict_min_version':'140.0'}}
manifest['content_scripts']=[script for script in manifest['content_scripts'] if script['matches']==['http://*/*','https://*/*']]
manifest['permissions']=[p for p in manifest['permissions'] if p not in ['http://127.0.0.1/*','https://repo.zotero.org/*','https://api.zotero.org/*','declarativeNetRequest']]
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
runtime_packages=['react','react-dom','react-dom-factories','prop-types','dompurify','single-file-core']
visited=set()
while runtime_packages:
 package=runtime_packages.pop()
 if package in visited:continue
 visited.add(package)
 folder=WORK/'node_modules'/package
 package_json=json.loads((folder/'package.json').read_text())
 runtime_packages.extend(package_json.get('dependencies',{}))
 for path in folder.iterdir():
  if path.is_file() and re.match(r'^(LICENSE|LICENCE|COPYING|NOTICE)',path.name,re.I):
   shutil.copy(path,OUT/'legal'/(package.replace('/','-')+'-'+path.name))
for package in ['translate','utilities','zotero-schema']:
 for path in (ROOT/'upstream/source/src'/package).iterdir():
  if path.is_file() and re.match(r'^(LICENSE|LICENCE|COPYING|NOTICE)',path.name,re.I):shutil.copy(path,OUT/'legal'/(package+'-'+path.name))
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
