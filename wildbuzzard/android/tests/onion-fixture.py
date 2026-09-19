#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Private onion + private-CA HTTPS fixture. Store generated credentials outside git."""
import argparse
import base64
import datetime
import http.server
import json
import os
from pathlib import Path
import signal
import ssl
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--directory', required=True, type=Path)
parser.add_argument('--tor', required=True)
parser.add_argument('--expired', action='store_true', help='Serve an expired leaf for the validity rejection test')
args = parser.parse_args()
os.umask(0o077)
root = args.directory.resolve()
root.mkdir(parents=True, exist_ok=True)
service = root/'service'
(service/'authorized_clients').mkdir(parents=True, exist_ok=True)
public_service = root/'public-service'
public_service.mkdir(parents=True, exist_ok=True)

def openssl(*values):
    return subprocess.check_output(['openssl', *map(str, values)], stderr=subprocess.DEVNULL)

client = root/'client.pem'
if not client.exists():
    openssl('genpkey', '-algorithm', 'X25519', '-out', client)
public = openssl('pkey', '-in', client, '-pubout', '-outform', 'DER')[-32:]
private = openssl('pkey', '-in', client, '-outform', 'DER')[-32:]
key = base64.b32encode(private).decode().rstrip('=')
(service/'authorized_clients/test.auth').write_text('descriptor:x25519:'+base64.b32encode(public).decode().rstrip('=')+'\n')
(root/'torrc').write_text(f'DataDirectory {root}/data\nSocksPort 0\nHiddenServiceDir {service}\nHiddenServicePort 443 127.0.0.1:9443\nHiddenServiceDir {public_service}\nHiddenServicePort 443 127.0.0.1:9443\nLog notice stdout\n')
log = (root/'tor.log').open('a')
tor = subprocess.Popen([args.tor, '-f', str(root/'torrc')], stdout=log, stderr=subprocess.STDOUT)
server = None
try:
    deadline = time.monotonic()+20
    while not (service/'hostname').exists() or not (public_service/'hostname').exists():
        if tor.poll() is not None or time.monotonic() > deadline:
            raise RuntimeError('Tor did not initialize; inspect tor.log')
        time.sleep(0.1)
    host = (service/'hostname').read_text().strip()
    public_host = (public_service/'hostname').read_text().strip()
    (root/'probe-fixture.json').write_text(json.dumps({'onion':host,'publicOnion':public_host,'key':key,'expired':args.expired}))
    (root/'fixture.auth_private').write_text(host.removesuffix('.onion')+':descriptor:x25519:'+key+'\n')
    (root/'qr.txt').write_text('http://'+host+'?key='+key+'\n')
    if not (root/'ca.pem').exists():
        openssl('req','-x509','-newkey','rsa:2048','-nodes','-days','30','-subj','/CN=WildBuzzard Test Private CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',root/'ca.key','-out',root/'ca.pem')
    def certificate_context(expired):
        openssl('req','-new','-newkey','rsa:2048','-nodes','-subj','/CN='+host,'-keyout',root/'server.key','-out',root/'server.csr')
        (root/'extensions').write_text('subjectAltName=DNS:'+host+',DNS:'+public_host+',IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
        if expired:
            (root/'cert-index').touch(exist_ok=True)
            (root/'cert-records').mkdir(exist_ok=True)
            if not (root/'cert-serial').exists(): (root/'cert-serial').write_text('1000\n')
            (root/'ca.cnf').write_text(f'''[ca]
default_ca=fixture
[fixture]
database={root}/cert-index
serial={root}/cert-serial
new_certs_dir={root}/cert-records
certificate={root}/ca.pem
private_key={root}/ca.key
default_md=sha256
unique_subject=no
policy=subject
[subject]
commonName=supplied
''')
            now = datetime.datetime.now(datetime.timezone.utc)
            date = lambda days: (now-datetime.timedelta(days=days)).strftime('%Y%m%d%H%M%SZ')
            openssl('ca','-batch','-notext','-config',root/'ca.cnf','-in',root/'server.csr','-out',root/'server.pem','-startdate',date(2),'-enddate',date(1),'-extfile',root/'extensions')
        else:
            openssl('x509','-req','-in',root/'server.csr','-CA',root/'ca.pem','-CAkey',root/'ca.key','-CAcreateserial','-days','7','-extfile',root/'extensions','-out',root/'server.pem')
        (root/'chain.pem').write_bytes((root/'server.pem').read_bytes()+(root/'ca.pem').read_bytes())
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(root/'chain.pem',root/'server.key')
        return context
    web = Path(__file__).parent/'web'
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self,*a,**kw): super().__init__(*a,directory=str(web),**kw)
        def log_message(self,*a): pass
    class TLSServer(http.server.ThreadingHTTPServer):
        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(15)
            try:
                return self.context.wrap_socket(connection, server_side=True), address
            except Exception:
                connection.close()
                raise
    server = TLSServer(('127.0.0.1',9443),Handler)
    server.context = certificate_context(args.expired)
    print('Private onion fixture: https://'+host,flush=True)
    print('Unenrolled onion fixture: https://'+public_host,flush=True)
    print('Import fixture.auth_private from '+str(root)+'; no CA installation is needed for the onion test.',flush=True)
    def renew(expired):
        try:
            server.context = certificate_context(expired)
        except Exception as error:
            print('Certificate renewal failed; previous TLS context retained: '+str(error),flush=True)
            return
        (root/'probe-fixture.json').write_text(json.dumps({'onion':host,'publicOnion':public_host,'key':key,'expired':expired}))
        print('TLS leaf renewed under the persistent CA; expired='+str(expired),flush=True)
    signal.signal(signal.SIGHUP,lambda *_: renew(False))
    signal.signal(signal.SIGUSR1,lambda *_: renew(True))
    print('Send SIGHUP to renew the leaf; SIGUSR1 installs an expired leaf. Tor keeps running.',flush=True)
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    if server is not None: server.server_close()
    tor.terminate()
    try: tor.wait(timeout=10)
    except subprocess.TimeoutExpired: tor.kill(); tor.wait()
    log.close()
