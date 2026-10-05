#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Query/init the managed Whisper build's public GGML device API, without a model."""
import ctypes as c
import json
import os
import sys

library = c.CDLL(os.path.join(sys.argv[1], 'libggml.so'), mode=c.RTLD_GLOBAL)
def function(name, result, *arguments):
    value = getattr(library, name)
    value.restype, value.argtypes = result, arguments
    return value

load = function('ggml_backend_load_all_from_path', None, c.c_char_p)
count = function('ggml_backend_dev_count', c.c_size_t)
get = function('ggml_backend_dev_get', c.c_void_p, c.c_size_t)
kind = function('ggml_backend_dev_type', c.c_int, c.c_void_p)
name = function('ggml_backend_dev_description', c.c_char_p, c.c_void_p)
registry = function('ggml_backend_dev_backend_reg', c.c_void_p, c.c_void_p)
backend = function('ggml_backend_reg_name', c.c_char_p, c.c_void_p)
initialize = function('ggml_backend_dev_init', c.c_void_p, c.c_void_p, c.c_char_p)
release = function('ggml_backend_free', None, c.c_void_p)
load(os.fsencode(sys.argv[1]))
devices, index = [], 0
for position in range(count()):
    device = get(position)
    if kind(device) not in (1, 2): continue
    handle = initialize(device, None)
    if handle:
        devices.append({'id': str(index), 'name': name(device).decode(), 'backend': backend(registry(device)).decode().lower()})
        release(handle)
    index += 1
print(json.dumps(devices))
