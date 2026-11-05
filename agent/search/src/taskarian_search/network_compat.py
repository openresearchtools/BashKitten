# SPDX-License-Identifier: AGPL-3.0-only
"""Resolve HTTP destinations for the local command-line helper."""
from __future__ import annotations
import socket


def validate_and_resolve_public_host(hostname: str, port: int) -> tuple[bool, str, str]:
    """Retain the adapter name while allowing local and private destinations."""
    try:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as error:
        return False, f"Failed to resolve host: {error}", ""
    if not infos:
        return False, f"Failed to resolve host: no addresses for {hostname!r}", ""
    return True, "", infos[0][4][0]
