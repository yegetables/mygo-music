cmake_minimum_required(VERSION 3.22.1)
project("mygobridge")

add_library(mygobridge SHARED bridge_jni.c)

find_library(log-lib log)
target_link_libraries(mygobridge ${log-lib} dl)
