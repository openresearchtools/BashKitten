# Native runtime corresponding source

This directory retains source for runtime/header code incorporated by the
packaged engines. It is copied into each matching `*-source.tar.gz`, together
with the exact engine, build recipe, compiler commands and per-target linker maps.
Nothing here is built as an AI engine on the workstation.

`android-r29/` is a pristine selected-source import, before the packaging changes:

* NDK r29 (29.0.14206865), Clang 21.0.0 / r563880c, ships the retained
  `clang_source_info.md` and `manifest_13989888.xml`. These identify LLVM base
  `386af4a5c64ab75eaee2448dc38f2e34a40bfed0`, Android patch/build commit
  `1dab3288f660d43a6cb2479107e2b54b3ab0a2a1`, and Google's corresponding patched
  LLVM checkout `5e96669f06077099aa41290cdb4c5e6fa0f59349`.
* Complete libc++, libc++abi, libunwind, compiler-rt, runtimes, CMake support,
  LLVM include and Clang builtin-header directories are retained from that
  exact LLVM base. The complete Android patch/build repository is retained
  separately, so the imported sources are not anonymously patched.
* Exact NDK r29 release-tag source (`196e0661200bad5361340700fea67be12e1f1684`)
  and Bionic (`a63b21091ada240d92f8ceadb1cabbdedaaab81b`) include the build
  recipes and CRT source incorporated into Android executables/DSOs. The
  toolchain-utils source referenced by Google's compiler manifest is retained.
* `SOURCE.json` records official archive URLs, full commits, archive SHA256s,
  source selection and the two shipped libc++ binary hashes. `SHA256SUMS`
  inventories every retained source/provenance file. Symlinks are inventoried
  by link text and never followed; upstream tooling links remain pristine.
  The complete NDK notices and compiler provenance are retained verbatim.

`ubuntu-24.04/` retains the exact original and Debian source-package archives
for the installed GCC 14 runtime/headers, glibc CRT/headers, Vulkan headers and
SPIRV headers. These are the release-tested compiler/package cohort used by
this builder, not independently upgraded runtime libraries. The original
signed `.dsc` files enumerate the archive SHA256s; `SOURCE.json` pins the same
files and versions. GCC's original source archive contains the complete GCC
and newlib source tarballs. Vulkan-Loader's distribution source includes the
matching complete Vulkan-Headers tree. The `*-LICENSES.txt` files collect full
license/notice files from these archives, including nested source archives.

`cuda-12.9/` pins the official CUDA 12.9 Update 2 packages for AMD64
and ARM64 SBSA. CUDA 12.9.86 nvcc, 12.9.79 cudart, 12.9.2.10 cuBLAS and
CCCL 2.8.2 retain their official versions. Exact package URLs, checksums and
full NVIDIA EULA are committed. The build retains actual installed headers,
notices and libdevice input fingerprints in the matching source archive.
The original complete CCCL archive and Ubuntu source-package archives are
hydrated from the external Taskarian source cache before the build; they are
included in the published source archive and remain outside Git.

Runtime packages include engine/ggml libraries and Android libc++. Linux glibc,
libstdc++, libgcc, OpenMP and Vulkan remain system libraries. CUDA runtimes also
include unmodified cudart, cuBLAS and cuBLASLt redistributables with their full
original package notices. The NVIDIA driver and libcuda.so.1 remain external;
a host CUDA toolkit is not required. Proprietary NVIDIA implementation source
is unavailable; the source archive identifies those binary inputs honestly.

The recipe, pristine retained source, pins and full notices migrated from the
original MIT integration recorded in ../../ORIGIN.json. Builds and publication
run in the four Taskarian architecture builders; that historical repository is
not a build or download dependency.
