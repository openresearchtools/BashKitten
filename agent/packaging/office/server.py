# SPDX-License-Identifier: AGPL-3.0-only
"""Native Online server/gbuild phase, separately from its browser bundle."""
import subprocess
import re
import branding
PREFIX = '/usr/lib/taskarian/office/runtime'
RUNTIME = '/data/data/com.termux/files/usr/lib/taskarian/office/runtime'
def run(command, cwd=None, env=None):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, env=env, check=True)

def build_linux(source, jobs, env, *, web=True):
    run(['./autogen.sh'], cwd=source, env=env)
    run(['./configure', '--prefix=' + PREFIX, '--sysconfdir=' + PREFIX + '/etc',
         '--localstatedir=' + PREFIX + '/var', '--disable-tests',
         *branding.online_options(),
         '--with-lo-builddir=' + str(source / 'engine'),
         '--with-lokit-path=' + str(source / 'engine/include'),
         '--with-lo-path=' + PREFIX + '/engine'], cwd=source, env=env)
    branding.verify_online(source)
    run(['make', '-j' + str(jobs), *([] if web else ['SUBDIRS=.'])], cwd=source, env=env)
    run(['make', 'sbom-check'], cwd=source, env=env)

def build_termux(source, args, env, *, web=True):
    from termux import build_libcap, build_libiconv, online_make_inputs
    PREFIX = '/data/data/com.termux/files/usr'
    libcap = build_libcap(args, env)
    libiconv = build_libiconv(args, env)
    native = {**env, 'CPPFLAGS': env['CPPFLAGS'] + ' -I' + str(libcap / 'libcap/include')
              + ' -I' + str(libiconv / 'include'),
              'LDFLAGS': env['LDFLAGS'] + ' -L' + str(libcap / 'libcap')
              + ' -L' + str(libiconv / 'lib/.libs'), 'LIBS': '-liconv'}
    run(['bash', './autogen.sh'], cwd=source, env=native)
    run(['./configure', '--build=x86_64-pc-linux-gnu', '--host=' + args.architecture + '-linux-android',
         '--prefix=' + RUNTIME, '--sysconfdir=' + RUNTIME + '/etc', '--localstatedir=' + RUNTIME + '/var',
         '--disable-tests', '--disable-pam', '--enable-landlock', '--enable-seccomp',
         *branding.online_options(),
         '--with-lo-builddir=' + str(source / 'engine'),
         '--with-lokit-path=' + str(source / 'engine/include'), '--with-lo-path=' + RUNTIME + '/engine'],
        cwd=source, env=native)
    branding.verify_online(source)
    config = (source / 'config.h').read_text()
    for required in ['#define MOBILEAPP 0', '#define DISABLE_SECCOMP 0', '#define DISABLE_LANDLOCK 0',
                     '#define HAVE_LIBCAP 1', '#define TASKARIAN_TERMUX_PREFIX "' + PREFIX + '"']:
        if required not in config:
            raise ValueError('Native server/isolation configuration missing: ' + required)
    # Online forwards its complete configured CPPFLAGS to native gbuild. Keep
    # configure's COKit/Poco/OpenSSL additions for the remaining autotools units;
    # overriding top-level CPPFLAGS would remove those required include paths.
    run(['make', '-j' + str(args.jobs), *online_make_inputs(libcap, libiconv),
         *([] if web else ['SUBDIRS=.'])], cwd=source, env=native)
    run(['make', 'sbom-check'], cwd=source, env=native)
    readelf = args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'
    server = source / 'coolwsd'
    dynamic = subprocess.check_output([readelf, '-d', server], text=True)
    symbols = subprocess.check_output([readelf, '--dyn-syms', server], text=True)
    if not re.search(r'\(NEEDED\).*\[libiconv\.so\]', dynamic) or 'libiconv_open' not in symbols:
        raise ValueError('Native WOPI server is not linked to the required GNU UTF-7 converter')
