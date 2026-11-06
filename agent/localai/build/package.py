#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build unchanged pinned ggml engines for Linux or native Android/Termux."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tarfile

from native_sources import native_notices, retained_sources, sha256

engine, backend, arch = (os.environ[name] for name in ('ENGINE', 'BACKEND', 'TARGETARCH'))
target_os = os.environ.get('TARGETOS', 'linux')
assert engine in ('llama', 'whisper') and backend in ('vulkan', 'cuda') and arch in ('amd64', 'arm64')
assert target_os in ('linux', 'android') and not (target_os == 'android' and backend == 'cuda')
source = os.environ['SOURCE_COMMIT']
assert re.fullmatch('[0-9a-f]{40}', source)
root = Path(os.environ.get('SOURCE_DIR', '/src'))
cache = Path(os.environ.get('CACHE_DIR', '/cache'))
# Keep an independent CMake tree per engine, platform and backend across source updates.
variant = f'{engine}-{target_os}-{arch}-{backend}'
build = cache / 'build' / variant
payload = cache / 'payload' / variant
output = Path(os.environ.get('OUTPUT_DIR', '/out'))
inputs = Path(os.environ.get('BUILD_INPUTS', '/build-inputs'))
ndk = Path(os.environ.get('ANDROID_NDK', '/opt/android-ndk-r29')) if target_os == 'android' else None
source_dependencies = retained_sources(inputs, target_os, backend)
evidence = cache / 'evidence' / variant
if evidence.exists(): shutil.rmtree(evidence)
evidence.mkdir(parents=True)
(evidence / 'retained-sources.json').write_text(json.dumps(source_dependencies, indent=2) + '\n')
pin = json.loads((inputs / 'upstreams.json').read_text())[engine]
assert source == pin['commit'] and os.environ['UPSTREAM_VERSION'] == pin['version']
revision = pin['packageRevision']
assert type(revision) is int and revision > 0
assert os.environ['RELEASE_TAG'] == f'{engine}-{pin["version"]}-r{revision}'
release = os.environ['PUBLISH_TAG']
release_repository = os.environ['RELEASE_REPOSITORY']
assert re.fullmatch(r'openresearchtools/taskarian-build-[a-z0-9-]+', release_repository)
assert release == f'localai-{engine}-{target_os}-{arch}-{backend}-{pin["version"]}-r{revision}'
build_commit = os.environ['BUILDER_COMMIT']
assert re.fullmatch('[0-9a-f]{40}', build_commit)
upstream_release = {'tag': pin['version'], 'commit': source, 'url': pin['releaseUrl'],
                    'releaseId': pin['releaseId'], 'tagObject': pin['tagObject']}
if payload.exists(): shutil.rmtree(payload)
for directory in (payload / 'bin', output, build): directory.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('CCACHE_DIR', str(cache / 'ccache'))
os.environ.setdefault('CCACHE_MAXSIZE', '0')
os.environ.setdefault('npm_config_cache', str(cache / 'npm'))
jobs = int(os.environ.get('BUILD_JOBS', os.environ.get('CMAKE_BUILD_PARALLEL_LEVEL', os.cpu_count() or 2)))
assert jobs > 0
args = ['cmake', '-S', str(root), '-B', str(build), '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
        '-DCMAKE_INSTALL_RPATH=$ORIGIN', '-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON', '-DGGML_NATIVE=OFF',
        '-DGGML_BACKEND_DL=ON', '-DGGML_CPU_ALL_VARIANTS=ON', '-DBUILD_SHARED_LIBS=ON',
        '-DCMAKE_C_COMPILER_LAUNCHER=ccache', '-DCMAKE_CXX_COMPILER_LAUNCHER=ccache',
        '-DCMAKE_CUDA_COMPILER_LAUNCHER=ccache',
        '-DCMAKE_LIBRARY_OUTPUT_DIRECTORY=' + str(build / 'bin'),
        '-DCMAKE_PROJECT_TOP_LEVEL_INCLUDES=',
        '-DGGML_CUDA=' + ('ON' if backend == 'cuda' else 'OFF'),
        '-DGGML_VULKAN=' + ('ON' if backend == 'vulkan' else 'OFF')]
if target_os == 'android':
    args += ['-DCMAKE_TOOLCHAIN_FILE=' + str(ndk / 'build/cmake/android.toolchain.cmake'),
             '-DANDROID_ABI=' + ('x86_64' if arch == 'amd64' else 'arm64-v8a'),
             '-DANDROID_PLATFORM=android-28', '-DANDROID_STL=c++_shared',
             '-DGGML_OPENMP=OFF', '-DGGML_LLAMAFILE=OFF',
             '-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH']
    if backend == 'vulkan':
        # glslc and the shader generator run on the build host, not the phone.
        args += ['-DVulkan_GLSLC_EXECUTABLE=/usr/bin/glslc',
                 '-DVulkan_INCLUDE_DIR=/opt/vulkan-headers']
if engine == 'llama':
    executables = ['llama-server', 'llama-cli', 'llama-tts', 'llama-quantize']
    args += ['-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_TOOLS=ON',
             '-DLLAMA_BUILD_SERVER=ON', '-DLLAMA_BUILD_APP=OFF', '-DLLAMA_BUILD_UI=ON',
             '-DLLAMA_USE_PREBUILT_UI=OFF', '-DLLAMA_OPENSSL=OFF', '-DLLAMA_SUBPROCESS=ON']
    if target_os == 'android':
        args += ['-DCMAKE_PROJECT_INCLUDE=' + str(inputs / 'termux.cmake')]
else:
    executables = ['whisper-server', 'whisper-cli', 'parakeet-cli', 'parakeet-quantize', 'taskarian-vad']
    subprocess.run([sys.executable, str(inputs / 'vad/verify.py')], check=True)
    vad = json.loads((inputs / 'vad/SOURCE.json').read_text())
    args += ['-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_EXAMPLES=ON',
             '-DWHISPER_BUILD_SERVER=ON', '-DWHISPER_CURL=OFF',
             '-DCMAKE_PROJECT_INCLUDE=' + str(inputs / 'vad.cmake')]
subprocess.run(args, check=True)
commands = subprocess.check_output(['ninja', '-C', str(build), '-t', 'commands', *executables], text=True)
(evidence / 'commands.txt').write_text(commands)
shutil.copy2(build / 'CMakeCache.txt', evidence / 'CMakeCache.txt')
capabilities = {'cpu': True, 'executionBackends': ['cpu', backend]}
if engine == 'whisper':
    capabilities['streamingVad'] = True
    (payload / 'models').mkdir()
    shutil.copy2(inputs / 'vad' / vad['model']['file'], payload / vad['model']['file'])
    shutil.copy2(inputs / 'vad/SOURCE.json', payload / 'models/VAD-SOURCE.json')
if engine == 'llama':
    # Upstream disables this on Android by default. Termux can spawn native API
    # 28 processes; its persistent router must be able to start model children.
    assert 'LLAMA_SUBPROCESS:BOOL=ON' in (build / 'CMakeCache.txt').read_text().splitlines(), 'Router subprocess support is required'
    if target_os == 'android':
        assert '-DSUBPROCESS_SPAWN_VIA_FORK=1' in (build / 'build.ninja').read_text(), 'Termux needs the supported fork/exec implementation'
    capabilities.update(subprocess=True, router=True,
                        subprocessImplementation='fork-exec' if target_os == 'android' else 'posix-spawn')
# Keep object/compiler caches, but relink the current target graph so removed
# upstream libraries do not survive source updates in bin/.
if (build / 'bin').exists():
    for previous in (build / 'bin').iterdir():
        if (previous.is_file() or previous.is_symlink()) and (previous.name in executables or '.so' in previous.name or previous.name.endswith('.native-link-map')):
            previous.unlink()
subprocess.run(['cmake', '--build', str(build), '--parallel', str(jobs), '--target', *executables], check=True)
for filename in (build / 'bin').iterdir():
    if filename.is_file() and (filename.name in executables or re.fullmatch(r'.*\.so(?:\.\d+)*', filename.name)):
        shutil.copy2(filename.resolve(), payload / 'bin' / filename.name)
for executable in executables: assert (payload / 'bin' / executable).is_file(), executable
assert (payload / 'bin' / ('libggml-' + backend + '.so')).is_file()
assert list((payload / 'bin').glob('libggml-cpu*.so')), 'Every archive must include a CPU backend'
cuda_runtime = None
cuda_notices = []
if backend == 'cuda':
    import cuda
    cuda_sources, cuda_notices = cuda.prepare(inputs, evidence, arch)
    source_dependencies['cuda']['installed'] = cuda_sources
    cuda_runtime = cuda.bundle(payload / 'bin', arch)
    # Match the managed launcher; private unmodified cuBLAS dependencies must
    # resolve without a host CUDA toolkit during the existing startup checks.
    os.environ['LD_LIBRARY_PATH'] = str(payload / 'bin')
if target_os == 'android':
    triple = 'x86_64-linux-android' if arch == 'amd64' else 'aarch64-linux-android'
    shutil.copy2(ndk / 'toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib' / triple / 'libc++_shared.so', payload / 'bin')
    readelf = ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'
    dependencies = {p.name: subprocess.check_output([str(readelf), '-d', str(p)], text=True)
                    for p in sorted((payload / 'bin').iterdir())}
    for filename in (payload / 'bin').iterdir():
        with filename.open('rb') as file:
            header = struct.unpack('<16sHHIQQQIHHHHHH', file.read(64))
            assert header[0][:6] == b'\x7fELF\x02\x01' and header[2] == (62 if arch == 'amd64' else 183), filename
            assert header[9] == 56 and header[10] > 0, filename
            file.seek(header[5])
            loads = [segment for _ in range(header[10]) if (segment := struct.unpack('<IIQQQQQQ', file.read(56)))[0] == 1]
            assert loads and all(segment[7] >= 16384 and (segment[3] - segment[2]) % 16384 == 0 for segment in loads), f'Android ELF needs 16 KiB load alignment: {filename}'
    shutil.copy2(ndk / 'NOTICE', payload / 'ANDROID-NDK-NOTICE.txt')
else:
    dependencies = {p.name: subprocess.check_output(['ldd', str(p)], text=True)
                    for p in sorted((payload / 'bin').iterdir())}
    for executable in executables:
        result = subprocess.run([str(payload / 'bin' / executable), '--help'], capture_output=True, timeout=60)
        expected = 1 if executable.endswith('-quantize') else 0
        if result.returncode != expected:
            raise RuntimeError(f'{executable} startup failed: {result.stderr.decode(errors="replace")}')
    if engine == 'whisper':
        command = [str(payload / 'bin/taskarian-vad'), str(payload / vad['model']['file'])]
        result = subprocess.run(command, input=bytes(2048), capture_output=True, timeout=60)
        assert result.returncode == 0 and result.stdout[:6] == b'READY\n' and len(result.stdout) == 14, 'VAD streaming protocol failed'
        assert all(0 <= p <= 1 for p in struct.unpack('<ff', result.stdout[6:])), 'Invalid VAD probability'
        partial = subprocess.run(command, input=b'\x00', capture_output=True, timeout=60)
        assert partial.returncode != 0, 'VAD must reject a partial PCM frame'
record = {'version': 1, 'engine': engine, 'upstreamVersion': os.environ['UPSTREAM_VERSION'], 'sourceCommit': source,
          'os': target_os, 'arch': arch, 'backend': backend, 'release': release,
          'packageRevision': revision, 'upstreamRelease': upstream_release,
          'cmake': args, 'builderCommit': build_commit,
          'buildRepository': 'https://github.com/openresearchtools/Taskarian', 'executables': executables,
          'capabilities': capabilities,
          'recipeSHA256': {str(p.relative_to(inputs)): sha256(p) for p in inputs.rglob('*') if p.is_file() or p.is_symlink()},
          'externalLibraries': dependencies, 'retainedSources': source_dependencies, 'minimumGlibc': '2.39' if target_os == 'linux' else None,
          'minimumAndroidApi': 28 if target_os == 'android' else None,
          'systemPackages': (['libc6', 'libstdc++6', 'libgcc-s1', 'libgomp1'] + (['libvulkan1'] if backend == 'vulkan' else [])) if target_os == 'linux' else [],
          'cudaRequirements': cuda_runtime}
if engine == 'whisper':
    record['vad'] = {key: vad[key] for key in ('silero', 'converter', 'model')}
(payload / 'build.json').write_text(json.dumps(record, indent=2) + '\n')
(payload / 'SOURCE.json').write_text(json.dumps({'repository': 'https://github.com/ggml-org/' + engine + '.cpp', 'commit': source,
    'upstreamRelease': upstream_release,
    'release': f'https://github.com/{release_repository}/releases/tag/{release}',
    'build': 'https://github.com/openresearchtools/Taskarian/tree/' + build_commit + '/agent/localai'}, indent=2) + '\n')
if not (root / 'LICENSE').is_file(): raise RuntimeError('Upstream license is missing')
notices = ['===== Taskarian build integration (MIT) =====\n' + (inputs / 'LICENSE').read_text(),
           '===== Taskarian application (AGPL-3.0-only) =====\n' + (inputs / 'LICENSE.Taskarian').read_text(),
           '===== MIT build recipe provenance =====\n' + (inputs / 'DONOR-LICENSE').read_text()]
for filename in sorted(root.rglob('*')):
    if '.git' in filename.parts or not filename.is_file(): continue
    if filename.name.lower().startswith(('license', 'licence', 'copying', 'notice', 'copyright')):
        try: content = filename.read_text()
        except UnicodeDecodeError: continue
        notices.append('===== ' + str(filename.relative_to(root)) + ' =====\n' + content)
for filename in sorted(root.rglob('*.h')):
    if '.git' in filename.parts or not filename.is_file(): continue
    for notice in re.findall(r'/\*[\s\S]*?\*/', filename.read_text(errors='replace')):
        if 'Permission is hereby granted' in notice: notices.append('===== ' + str(filename.relative_to(root)) + ' =====\n' + notice)
if engine == 'whisper':
    for name in ('SILERO-LICENSE', 'upstream/whisper/LICENSE'):
        notices.append('===== VAD ' + name + ' =====\n' + (inputs / 'vad' / name).read_text())
notices.extend(native_notices(inputs, source_dependencies))
notices.extend(cuda_notices)
(payload / 'LICENSES.txt').write_text('\n\n'.join(notices))
(payload / 'BUILD-PACKAGES.txt').write_text(subprocess.check_output(['dpkg-query', '-W', '-f=${Package}\t${Version}\n'], text=True))
base = f'{engine}-{pin["version"]}-r{revision}-{target_os}-{arch}-{backend}'
archive = output / (base + '.tar.gz')
with tarfile.open(archive, 'w:gz') as tar:
    for child in sorted(payload.iterdir()): tar.add(child, arcname=child.name)
source_archive = output / (base + '-source.tar.gz')
with tarfile.open(source_archive, 'w:gz') as tar:
    tar.add(root, arcname='source', filter=lambda info: None if '/.git/' in info.name or info.name.endswith('/.git') else info)
    tar.add(inputs, arcname='build')
    tar.add(evidence, arcname='build-evidence')
sha = sha256(archive)
entry = {key: record[key] for key in ('engine', 'os', 'arch', 'backend', 'sourceCommit', 'upstreamRelease', 'packageRevision')}
entry.update(file=archive.name, sha256=sha, size=archive.stat().st_size,
             executable=engine + '-server', executables=executables,
             release=release, upstreamVersion=record['upstreamVersion'],
             url=f'https://github.com/{release_repository}/releases/download/{release}/{archive.name}',
             minimumAndroidApi=record['minimumAndroidApi'], capabilities=capabilities,
             cudaRequirements=cuda_runtime,
             sourceFile=source_archive.name, sourceSHA256=sha256(source_archive), sourceSize=source_archive.stat().st_size,
             sourceURL=f'https://github.com/{release_repository}/releases/download/{release}/{source_archive.name}')
if engine == 'whisper':
    entry['vad'] = record['vad']
(output / (base + '.json')).write_text(json.dumps(entry, indent=2) + '\n')
print(json.dumps(entry))
