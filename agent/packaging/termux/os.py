#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build BashKitten OS using the pinned native Termux framework and recipe."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,sys,tarfile
ROOT=pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'agent/packaging'))
from source_cache import fetch
def framework_filter(member,destination):
 filtered=tarfile.data_filter(member,destination)
 # Current Python strips trailing slashes from link targets. Preserve that
 # harmless source spelling after its native containment checks so the exact
 # pinned-source audit below also accepts a freshly extracted framework.
 if member.issym() and filtered.linkname==member.linkname.rstrip('/'):
  filtered=filtered.replace(linkname=member.linkname)
 return filtered
def prepare_framework(work,archive,checksum):
 # Keep each pinned framework separate. A build-package.sh from an older
 # release is not evidence that the cached recipes match the current lock.
 framework=work/('framework-'+checksum[:16])
 marker=framework/'.bashkitten-source-sha256'
 if framework.exists() and (not marker.is_file() or marker.read_text().strip()!=checksum):
  raise ValueError('Incomplete or mismatched Termux framework cache: '+str(framework))
 if not framework.exists():
  framework.mkdir(parents=True)
  with tarfile.open(archive) as source:
   prefix=source.getmembers()[0].name.split('/')[0]+'/'
   for member in source:
    if not member.name.startswith(prefix):continue
    member.name=member.name[len(prefix):]
    if member.name:source.extract(member,framework,filter=framework_filter)
  marker.write_text(checksum+'\n')
 # The framework is executable build input. Detect local edits as well as a
 # changed pin before claiming the archive's provenance in the package record.
 with tarfile.open(archive) as source:
  for member in source:
   parts=member.name.split('/',1)
   if len(parts)!=2 or not parts[1]:continue
   actual=framework/parts[1]
   if member.isfile():
    if not actual.is_file() or actual.is_symlink():raise ValueError('Missing pinned Termux source: '+parts[1])
    with actual.open('rb') as stream:
     digest=hashlib.file_digest(stream,'sha256').digest()
    if digest!=hashlib.file_digest(source.extractfile(member),'sha256').digest():raise ValueError('Changed pinned Termux source: '+parts[1])
   elif member.issym() and (not actual.is_symlink() or os.readlink(actual)!=member.linkname):
    raise ValueError('Changed pinned Termux symlink: '+parts[1])
 return framework
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--architecture',choices=['aarch64','x86_64'],required=True);p.add_argument('--work',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
 work=a.work.resolve();out=a.output.resolve()
 if work.is_relative_to(ROOT) or out.is_relative_to(ROOT):p.error('Work and output must be outside the source checkout')
 lock=json.loads((ROOT/'agent/packaging/node/lock.json').read_text())['termux']['recipes']
 archive=fetch(lock,local=ROOT/'agent/vendor/node'/(lock['sha256']+'-'+lock['url'].rsplit('/',1)[-1]))
 framework=prepare_framework(work,archive,lock['sha256'])
 recipe=framework/'x11-packages/bashkitten-os';recipe.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/'os/packaging/termux/build.sh',recipe/'build.sh')
 cache=work/'build-cache';cache.mkdir(exist_ok=True)
 data=work/'data';data.mkdir(exist_ok=True)
 container='bashkitten-os-'+a.architecture+'-'+lock['sha256'][:16]
 ndk_pin=json.loads((ROOT/'agent/packaging/node/lock.json').read_text())['termux']['dependency_sources']['libc++']
 ndk_archive=fetch(ndk_pin,local=work/'android-ndk-r30-linux.zip')
 ndk=work/'android-ndk-r30'
 if not (ndk/'source.properties').is_file():subprocess.run(['unzip','-q',str(ndk_archive),'-d',str(work)],check=True)
 image=json.loads((ROOT/'auth/build/termux-toolchain.json').read_text())['builderImage']
 env={**os.environ,'TERMUX_BUILDER_IMAGE_NAME':image,'CONTAINER_NAME':container,
  'TERMUX_DOCKER_RUN_EXTRA_ARGS':'--volume '+str(ROOT)+':/bashkitten:ro --volume '+str(ndk)+':/home/builder/lib/android-ndk-r30:ro --volume '+str(cache)+':/home/builder/.termux-build:rw --volume '+str(data)+':/data:rw',
  'TERMUX_DOCKER_EXEC_EXTRA_ARGS':'--env BASHKITTEN_SOURCE_ROOT=/bashkitten --env GOTELEMETRY=off --env DO_NOT_TRACK=1'}
 subprocess.run(['./scripts/run-docker.sh','./build-package.sh','-I','-f','-a',a.architecture,'bashkitten-os'],cwd=framework,env=env,check=True)
 version=(ROOT/'browser/bashkitten/config/version.txt').read_text().strip()+'-1';deb=framework/'output'/f'bashkitten-os_{version}_{a.architecture}.deb'
 if not deb.is_file():raise ValueError('Missing native Termux OS package')
 out.mkdir(parents=True,exist_ok=True);target=out/deb.name;shutil.copy2(deb,target)
 record={'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'version':version,'architecture':a.architecture,'target':'termux','file':deb.name,'sha256':hashlib.sha256(deb.read_bytes()).hexdigest(),'framework':lock,'ndk':ndk_pin}
 (out/(deb.name+'.json')).write_text(json.dumps(record,indent=2)+'\n');(out/(deb.name+'.sha256')).write_text(record['sha256']+'  '+deb.name+'\n')
if __name__=='__main__':main()
