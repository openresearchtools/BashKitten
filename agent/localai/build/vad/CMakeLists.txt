add_executable(taskarian-vad main.cpp)
target_include_directories(taskarian-vad PRIVATE "${CMAKE_SOURCE_DIR}/include")
target_link_libraries(taskarian-vad PRIVATE whisper)
set_target_properties(taskarian-vad PROPERTIES CXX_STANDARD 17 RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
