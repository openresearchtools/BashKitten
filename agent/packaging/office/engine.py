# SPDX-License-Identifier: AGPL-3.0-only
"""Native Collabora engine configure/build phase; no UI or package metadata."""
import json
from pathlib import Path
import subprocess
import source_graph
import branding
PREFIX = '/data/data/com.termux/files/usr'
RUNTIME = PREFIX + '/lib/taskarian/office/runtime'
ENGINE_OPTIONS = json.loads(Path(__file__).with_name('engine-options.json').read_text())
def run(command, cwd=None, env=None):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, env=env, check=True)

def configure_linux(source, cache, jobs, env):
    run(['sh', './autogen.sh', *ENGINE_OPTIONS, *branding.engine_options(), '--with-parallelism=' + str(jobs),
         '--with-external-tar=' + str(cache)], cwd=source / 'engine', env=env)
    selected = source_graph.engine_inputs(source / 'engine/config_host.mk')
    retained = {row['name']: row['sha256'] for row in source_graph.verify_dependencies()['components']}
    if any(retained.get(row['name']) != row['sha256'] for row in selected):
        raise ValueError('Configured native dependency graph contains an unmaterialized source')
    branding.verify_engine(source)

def configure_termux(source, args, env):
    options = [*ENGINE_OPTIONS, *branding.engine_options(), '--build=x86_64-pc-linux-gnu',
               '--host=' + args.architecture + '-linux', '--prefix=' + RUNTIME,
               '--with-parallelism=' + str(args.jobs), '--with-external-tar=' + str(args.cache),
               '--with-external-dict-dir=' + PREFIX + '/share/hunspell',
               '--with-external-hyph-dir=' + PREFIX + '/share/hyphen',
               '--with-external-thes-dir=' + PREFIX + '/share/mythes', '--without-system-libxml']
    run(['sh', './autogen.sh', *options], cwd=source / 'engine', env=env)
    # Check the selected native graph before make can fetch anything. A new
    # dependency needs a separately reviewed/materialized source input.
    retained = {row['name']: row['sha256'] for row in source_graph.verify_dependencies()['components']}
    for config in [source / 'engine/config_host.mk', source / 'engine/config_build.mk']:
        for row in source_graph.engine_inputs(config):
            if retained.get(row['name']) != row['sha256']:
                raise ValueError('Unmaterialized Bionic build dependency: ' + row['name'])
    branding.verify_engine(source)
    return options

def compile_engine(source, args, env):
    if args.target.startswith('termux-'):
        configure_termux(source, args, env)
    else:
        configure_linux(source, args.cache, args.jobs, env)
    run(['make', '-j' + str(args.jobs), 'build'], cwd=source / 'engine', env=env)
