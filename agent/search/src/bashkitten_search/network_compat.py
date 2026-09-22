# SPDX-License-Identifier: AGPL-3.0-only

"""Narrow network compatibility fixes around the preserved Unsloth runtime."""

from __future__ import annotations

import ipaddress
import socket


_WELL_KNOWN_NAT64 = ipaddress.ip_network("64:ff9b::/96")


def _is_public_fetch_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Apply the upstream public-address policy with an RFC 6052 NAT64 exception.

    Python classifies the well-known NAT64 prefix as reserved even though it is
    specifically used to reach an embedded IPv4 destination.  It is safe to
    accept only when the embedded IPv4 address independently passes the same
    public-address checks.  Native private, loopback, link-local, multicast,
    reserved, and unspecified addresses remain blocked.
    """

    checked: ipaddress.IPv4Address | ipaddress.IPv6Address = address
    if isinstance(address, ipaddress.IPv6Address) and address in _WELL_KNOWN_NAT64:
        checked = ipaddress.IPv4Address(address.packed[-4:])
    return bool(
        checked.is_global
        and not checked.is_private
        and not checked.is_loopback
        and not checked.is_link_local
        and not checked.is_multicast
        and not checked.is_reserved
        and not checked.is_unspecified
    )


def validate_and_resolve_public_host(hostname: str, port: int) -> tuple[bool, str, str]:
    """Equivalent to Unsloth's resolver, plus safe well-known NAT64 support."""

    try:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as error:
        return False, f"Failed to resolve host: {error}", ""

    if not infos:
        return False, f"Failed to resolve host: no addresses for {hostname!r}", ""

    for *_, sockaddr in infos:
        address = ipaddress.ip_address(sockaddr[0])
        if not _is_public_fetch_address(address):
            return (
                False,
                f"Blocked: refusing to fetch non-public address {address}.",
                "",
            )

    return True, "", infos[0][4][0]
