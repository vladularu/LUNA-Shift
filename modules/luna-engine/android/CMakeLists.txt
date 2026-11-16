cmake_minimum_required(VERSION 3.22.1)
project(luna_engine_jni LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_library(luna_engine SHARED IMPORTED)
set_target_properties(luna_engine PROPERTIES
  IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../.build/android/prebuilt/${ANDROID_ABI}/libluna_engine.so"
  IMPORTED_NO_SONAME TRUE)
add_library(luna_engine_jni SHARED src/main/cpp/LunaEngineJni.cpp ../ios/LunaEngineBridge.c)
target_include_directories(luna_engine_jni PRIVATE ../rust/include ../ios)
target_compile_options(luna_engine_jni PRIVATE -Wall -Wextra -Werror)
target_link_libraries(luna_engine_jni PRIVATE luna_engine)
target_link_options(luna_engine_jni PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")
