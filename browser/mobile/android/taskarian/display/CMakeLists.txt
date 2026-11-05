# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.22)
project(TaskarianDisplay)
# Gradle prepares a build-directory copy before CMake; native recipes may apply
# upstream's own named Xorg patches to that copy, never the tracked source.
if(NOT DEFINED TASKARIAN_DISPLAY_SOURCE)
  set(TASKARIAN_DISPLAY_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/build/termux-x11")
endif()
add_subdirectory("${TASKARIAN_DISPLAY_SOURCE}/lorie/src/main/cpp" "${CMAKE_CURRENT_BINARY_DIR}/lorie")
