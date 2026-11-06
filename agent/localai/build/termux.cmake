# SPDX-License-Identifier: MIT
# API 28 supports native fork/exec, but not the addchdir posix_spawn extension.
# The pinned upstream subprocess.h explicitly supports this implementation switch.
# Keep working-directory support and exec failure reporting without a source patch.
if(NOT ANDROID)
    message(FATAL_ERROR "Termux subprocess configuration requires Android")
endif()
add_compile_definitions(SUBPROCESS_SPAWN_VIA_FORK=1)
