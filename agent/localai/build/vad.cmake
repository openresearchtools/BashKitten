# Executed after upstream project() without changing its released source.
if(NOT TARGET taskarian-vad AND CMAKE_PROJECT_NAME STREQUAL "whisper.cpp")
    add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/vad" "${CMAKE_BINARY_DIR}/taskarian-vad")
endif()
