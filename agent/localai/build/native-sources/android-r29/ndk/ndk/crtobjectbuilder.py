#
# Copyright (C) 2023 The Android Open Source Project
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Helper class for building CRT objects."""
import shlex
import shutil
import subprocess
from pathlib import Path

import ndk.config
from ndk.platforms import ALL_API_LEVELS

from .abis import Abi, abi_to_triple, clang_target, iter_abis_for_api
from .paths import ANDROID_DIR, NDK_DIR


class CrtObjectBuilder:
    """Builder for NDK CRT objects."""

    PREBUILTS_PATH = ANDROID_DIR / "prebuilts/ndk/platform"

    def __init__(self, llvm_path: Path, build_dir: Path, build_id: int) -> None:
        self.llvm_path = llvm_path
        self.build_dir = build_dir
        self.build_id = build_id
        self.artifacts: list[tuple[Abi, int, Path]] = []

    def llvm_tool(self, tool: str) -> Path:
        """Returns the path to the given LLVM tool."""
        return self.llvm_path / "bin" / tool

    def get_build_cmd(
        self,
        dst: Path,
        srcs: list[Path],
        api: int,
        abi: Abi,
        build_number: int,
    ) -> list[str]:
        """Returns the build command for creating a CRT object."""
        libc_includes = ANDROID_DIR / "bionic/libc"
        arch_common_includes = libc_includes / "arch-common/bionic"

        cc = self.llvm_tool("clang")

        args = [
            str(cc),
            "-target",
            clang_target(abi, api),
            "--sysroot",
            str(self.PREBUILTS_PATH / "sysroot"),
            "-fuse-ld=lld",
            f"-I{libc_includes}",
            f"-I{arch_common_includes}",
            f"-DPLATFORM_SDK_VERSION={api}",
            f'-DABI_NDK_VERSION="{ndk.config.release}"',
            f'-DABI_NDK_BUILD_NUMBER="{build_number}"',
            "-O2",
            "-fpic",
            "-Wl,-r",
            "-no-pie",
            "-nostdlib",
            "-Wa,--noexecstack",
            "-Wl,-z,noexecstack",
            "-o",
            str(dst),
        ] + [str(src) for src in srcs]

        if abi == Abi("arm64-v8a"):
            args.append("-mbranch-protection=standard")

        if dst.name == "crtbegin_static.o":
            args.append("-DCRTBEGIN_STATIC")

        return args

    def check_elf_note(self, obj_file: Path) -> None:
        """Verifies that the object file contains the expected note."""
        # readelf is a cross platform tool, so arch doesn't matter.
        readelf = self.llvm_tool("llvm-readelf")
        out = subprocess.run(
            [readelf, "--notes", obj_file], check=True, text=True, capture_output=True
        ).stdout
        if "Android" not in out:
            raise RuntimeError(f"{obj_file} does not contain NDK ELF note")

    def build_crt_object(
        self,
        dst: Path,
        srcs: list[Path],
        api: int,
        abi: Abi,
        build_number: int,
        defines: list[str],
    ) -> None:
        cc_args = self.get_build_cmd(dst, srcs, api, abi, build_number)
        cc_args.extend(defines)

        print(f"Running: {shlex.join(cc_args)}")
        subprocess.check_call(cc_args)

    def build_crt_objects(
        self,
        dst_dir: Path,
        api: int,
        abi: Abi,
        build_number: int,
    ) -> None:
        src_dir = ANDROID_DIR / "bionic/libc/arch-common/bionic"
        crt_brand = NDK_DIR / "sources/crt/crtbrand.S"

        objects = {
            "crtbegin_dynamic.o": [
                src_dir / "crtbegin.c",
                crt_brand,
            ],
            "crtbegin_so.o": [
                src_dir / "crtbegin_so.c",
                crt_brand,
            ],
            "crtbegin_static.o": [
                src_dir / "crtbegin.c",
                crt_brand,
            ],
            "crtend_android.o": [
                src_dir / "crtend.S",
            ],
            "crtend_so.o": [
                src_dir / "crtend_so.S",
            ],
        }

        for name, srcs in objects.items():
            dst_path = dst_dir / name
            defs = []
            if name == "crtbegin_static.o":
                # libc.a is always the latest version, so ignore the API level
                # setting for crtbegin_static.
                defs.append("-D_FORCE_CRT_ATFORK")
            self.build_crt_object(dst_path, srcs, api, abi, build_number, defs)
            if name.startswith("crtbegin"):
                self.check_elf_note(dst_path)
            self.artifacts.append((abi, api, dst_path))

    def build(self) -> None:
        self.artifacts = []
        if self.build_dir.exists():
            shutil.rmtree(self.build_dir)

        for api in ALL_API_LEVELS:
            for abi in iter_abis_for_api(api):
                dst_dir = self.build_dir / abi_to_triple(abi) / str(api)
                dst_dir.mkdir(parents=True, exist_ok=True)
                self.build_crt_objects(dst_dir, api, abi, self.build_id)
