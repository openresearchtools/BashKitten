# SPDX-License-Identifier: AGPL-3.0-only

"""The same single-request command for stock Pi on Linux and Termux."""

from __future__ import annotations

import contextlib
import json
import signal
import sys

from .service import execute, validate


class Interrupted(BaseException):
    def __init__(self, message: str, code: str, exit_code: int):
        self.message, self.code, self.exit_code = message, code, exit_code


def _cancel(number: int, _frame: object) -> None:
    if number == signal.SIGALRM:
        raise Interrupted("Search/read timed out", "timeout", 124)
    raise Interrupted("Search/read cancelled", "cancelled", 128 + number)


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"Duplicate input field: {key}")
        value[key] = item
    return value


def main() -> int:
    exit_code = 0
    try:
        if len(sys.argv) != 1:
            raise ValueError('Use JSON on stdin: {"query":"…"} or {"url":"https://…"}')
        signal.signal(signal.SIGTERM, _cancel)
        signal.signal(signal.SIGINT, _cancel)
        signal.signal(signal.SIGALRM, _cancel)
        raw = sys.stdin.buffer.read()
        request = validate(json.loads(raw, object_pairs_hook=_unique_object))
        signal.setitimer(signal.ITIMER_REAL, request["timeoutSeconds"] or 0)
        # Some converter libraries print progress on stdout; JSON remains the
        # only stdout contract and their diagnostics go to the ordinary log.
        with contextlib.redirect_stdout(sys.stderr):
            result = execute(request)
    except Interrupted as error:
        result = {"ok": False, "content": "", "error": {"code": error.code, "message": error.message}}
        exit_code = error.exit_code
    except (ValueError, UnicodeError) as error:
        result = {"ok": False, "content": "", "error": {"code": "invalid_request", "message": str(error)}}
        exit_code = 2
    except Exception as error:
        result = {"ok": False, "content": "", "error": {"code": "request_failed", "message": str(error) or type(error).__name__}}
        exit_code = 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return exit_code
