#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Stage pristine primp and its locked crates from the retained source archives."""
import argparse, hashlib, json, pathlib, tarfile, tomllib
ROOT = pathlib.Path(__file__).resolve().parents[1]
def sha(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=pathlib.Path);a=p.parse_args()
    lock=ROOT/'runtime-lock.json';base=ROOT/'vendor/sources';inventory=json.loads((base/'sources.json').read_text())
    if sha(lock)!=inventory['lockSha256']:raise ValueError('Search source lock changed')
    records={item['filename']:item for item in inventory['components']}
    def unpack(name,destination,expected):
        item=records[name];source=base/item['file']
        if item['sha256']!=expected or sha(source)!=expected:raise ValueError('Retained source checksum mismatch: '+name)
        destination.mkdir(parents=True,exist_ok=True)
        with tarfile.open(source) as archive:
            prefix=archive.getmembers()[0].name.split('/')[0]+'/'
            for member in archive:
                if not member.name.startswith(prefix):continue
                member.name=member.name[len(prefix):]
                if member.name:archive.extract(member,destination,filter='data')
    primp=next(item for item in json.loads(lock.read_text())['packages'] if item['name']=='primp')['source']
    unpack(primp['filename'],a.output,primp['sha256'])
    crates=tomllib.loads((a.output/'Cargo.lock').read_text())['package'];vendor=a.output/'vendor'
    for crate in crates:
        if 'source' not in crate:continue
        if not crate['source'].startswith('registry+'):raise ValueError('Unexpected Cargo source')
        name=crate['name']+'-'+crate['version'];target=vendor/name
        unpack(name+'.crate',target,crate['checksum'])
        files={str(path.relative_to(target)):sha(path) for path in sorted(target.rglob('*')) if path.is_file() and path.name!='.cargo-checksum.json'}
        (target/'.cargo-checksum.json').write_text(json.dumps({'package':crate['checksum'],'files':files})+'\n')
    config=a.output/'.cargo';config.mkdir(exist_ok=True)
    with (config/'config.toml').open('a') as stream:
        stream.write('\n[source.crates-io]\nreplace-with="bashkitten-retained"\n[source.bashkitten-retained]\ndirectory="vendor"\n[net]\noffline=true\n')
if __name__=='__main__':main()
