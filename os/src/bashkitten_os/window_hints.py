# SPDX-License-Identifier: AGPL-3.0-only
import ctypes as C
import ctypes.util
import json,sys
from pathlib import Path
class SizeHints(C.Structure):
    _fields_ = [('flags', C.c_long)] + [(n, C.c_int) for n in
        ('x','y','width','height','min_width','min_height','max_width','max_height',
         'width_inc','height_inc','min_aspect_x','min_aspect_y','max_aspect_x','max_aspect_y',
         'base_width','base_height','win_gravity')]

def native_hints(xids):
    # Separate X connection on a worker: no blocking round trip on the GTK loop.
    # Termux installs an unversioned native library in its own prefix; looking
    # it up through Linux ldconfig/compiler heuristics is neither needed nor
    # reliable on a phone without a compiler installed.
    native=Path(__file__).resolve().parents[3]/'lib/libX11.so'
    library=str(native) if native.is_file() else ctypes.util.find_library('X11')
    if not library:raise RuntimeError('The owning native X11 library is unavailable')
    x = C.CDLL(library)
    x.XOpenDisplay.argtypes=[C.c_char_p]; x.XOpenDisplay.restype=C.c_void_p
    x.XCloseDisplay.argtypes=[C.c_void_p]
    x.XInternAtom.argtypes=[C.c_void_p,C.c_char_p,C.c_int]; x.XInternAtom.restype=C.c_ulong
    x.XGetWindowProperty.argtypes=[C.c_void_p,C.c_ulong,C.c_ulong,C.c_long,C.c_long,C.c_int,C.c_ulong,
        C.POINTER(C.c_ulong),C.POINTER(C.c_int),C.POINTER(C.c_ulong),C.POINTER(C.c_ulong),C.POINTER(C.c_void_p)]
    x.XFree.argtypes=[C.c_void_p]
    x.XGetWMNormalHints.argtypes=[C.c_void_p,C.c_ulong,C.POINTER(SizeHints),C.POINTER(C.c_long)]
    display = x.XOpenDisplay(None)
    if not display: raise RuntimeError('The owning X display is unavailable')
    try:
        result = {}
        for xid in xids:
            hint = SizeHints(); supplied = C.c_long()
            # WM_NORMAL_HINTS is optional. No property means unconstrained, not
            # that an otherwise normal window should escape the layout policy.
            x.XGetWMNormalHints(display, xid, C.byref(hint), C.byref(supplied))
            atom=x.XInternAtom(display,b'_NET_WM_STATE',False)
            modal=x.XInternAtom(display,b'_NET_WM_STATE_MODAL',False)
            actual=C.c_ulong(); fmt=C.c_int(); count=C.c_ulong(); after=C.c_ulong(); data=C.c_void_p()
            is_modal=False
            if x.XGetWindowProperty(display,xid,atom,0,1024,False,4,C.byref(actual),C.byref(fmt),C.byref(count),C.byref(after),C.byref(data))==0 and data:
                if fmt.value==32:
                    is_modal=modal in C.cast(data,C.POINTER(C.c_ulong*count.value)).contents
                x.XFree(data)
            result[xid] = {'modal':is_modal,'minw': max(1,hint.min_width) if hint.flags & 16 else 1,
                'minh':max(1,hint.min_height) if hint.flags & 16 else 1,
                'maxw':hint.max_width if hint.flags & 32 else 2147483647,
                'maxh':hint.max_height if hint.flags & 32 else 2147483647,
                'incw':max(1,hint.width_inc) if hint.flags & 64 else 1,
                'inch':max(1,hint.height_inc) if hint.flags & 64 else 1,
                'basew':hint.base_width if hint.flags & 256 else max(0,hint.min_width),
                'baseh':hint.base_height if hint.flags & 256 else max(0,hint.min_height)}
        return result
    finally: x.XCloseDisplay(display)


if __name__ == "__main__":
    print(json.dumps(native_hints([int(x) for x in sys.argv[1:]])))
