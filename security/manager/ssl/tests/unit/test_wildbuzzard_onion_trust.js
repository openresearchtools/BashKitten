// SPDX-License-Identifier: AGPL-3.0-or-later
"use strict";

add_task(function trust_is_bound_to_context_and_exact_onion_identity() {
  const service = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
  const onion = "a".repeat(56) + ".onion";
  const other = "b".repeat(56) + ".onion";
  service.setAuthenticatedOnion("tor-tab", onion, true);
  registerCleanupFunction(() => service.setAuthenticatedOnion("tor-tab", onion, false));
  Assert.ok(service.isAuthenticatedOnion("tor-tab", onion));
  Assert.ok(service.isAuthenticatedOnion("tor-tab", "www." + onion));
  for (const host of [other, "example.com", onion + ".evil.example", "x" + onion]) {
    Assert.ok(!service.isAuthenticatedOnion("tor-tab", host), host);
  }
  Assert.ok(!service.isAuthenticatedOnion("another-tab", onion));
  Assert.ok(!service.isAuthenticatedOnion("", onion));
  service.setAuthenticatedOnion("tor-tab", onion, false);
  Assert.ok(!service.isAuthenticatedOnion("tor-tab", onion));
});

add_task(function enrollment_rejects_invalid_scope() {
  const service = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
  const onion = "a".repeat(56) + ".onion";
  for (const context of ["", "a|b", "a".repeat(257)]) {
    Assert.throws(() => service.setAuthenticatedOnion(context, onion, true), /NS_ERROR_INVALID_ARG/);
  }
  for (const host of ["example.com", "a".repeat(16) + ".onion", "sub." + onion, "0".repeat(56) + ".onion"]) {
    Assert.throws(() => service.setAuthenticatedOnion("tor-tab", host, true), /NS_ERROR_INVALID_ARG/);
  }
});
