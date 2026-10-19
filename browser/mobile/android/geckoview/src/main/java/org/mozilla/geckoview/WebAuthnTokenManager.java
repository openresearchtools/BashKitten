/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.geckoview;

import java.nio.ByteBuffer;
import org.mozilla.gecko.WebAuthnCredentialManager;
import org.mozilla.gecko.annotation.WrapForJNI;
import org.mozilla.gecko.util.ThreadUtils;
import org.mozilla.gecko.util.WebAuthnUtils;

/** Android framework WebAuthn bridge. No SDK or alternate authenticator fallback. */
public class WebAuthnTokenManager {
  @WrapForJNI(calledFrom = "gecko")
  private static GeckoResult<WebAuthnUtils.MakeCredentialResponse> webAuthnMakeCredential(
      final long transactionId, final String origin, final ByteBuffer clientDataHash,
      final String requestJSON) {
    // The native ByteBuffer is only valid for this call, before dispatch to UI.
    final byte[] hash = new byte[clientDataHash.remaining()];
    clientDataHash.get(hash);
    final GeckoResult<WebAuthnUtils.MakeCredentialResponse> result = new GeckoResult<>();
    ThreadUtils.runOnUiThread(()
                                  -> result.completeFrom(WebAuthnCredentialManager.makeCredential(
                                      transactionId, origin, hash, requestJSON)));
    return result;
  }

  @WrapForJNI(calledFrom = "gecko")
  private static GeckoResult<WebAuthnUtils.GetAssertionResponse> webAuthnGetAssertion(
      final long transactionId, final String origin, final ByteBuffer clientDataHash,
      final String requestJSON) {
    final byte[] hash = new byte[clientDataHash.remaining()];
    clientDataHash.get(hash);
    final GeckoResult<WebAuthnUtils.GetAssertionResponse> result = new GeckoResult<>();
    ThreadUtils.runOnUiThread(()
                                  -> result.completeFrom(WebAuthnCredentialManager.getAssertion(
                                      transactionId, origin, hash, requestJSON)));
    return result;
  }

  @WrapForJNI(calledFrom = "gecko")
  private static void webAuthnCancel(final long transactionId) {
    ThreadUtils.runOnUiThread(() -> WebAuthnCredentialManager.cancel(transactionId));
  }

  @WrapForJNI(calledFrom = "gecko")
  private static GeckoResult<Boolean> webAuthnIsUserVerifyingPlatformAuthenticatorAvailable() {
    // Public Android APIs cannot enumerate enabled third-party providers. As in
    // Chromium's full Credential Manager mode, report framework capability here,
    // not a guarantee of an enabled provider, usable credential or browser trust.
    // The actual create/get operation returns the provider's result or error.
    final GeckoResult<Boolean> result = new GeckoResult<>();
    ThreadUtils.runOnUiThread(() -> {
      try {
        result.complete(WebAuthnCredentialManager.isAvailable());
      } catch (final RuntimeException e) {
        result.completeExceptionally(new WebAuthnUtils.Exception("UNKNOWN_ERR"));
      }
    });
    return result;
  }
}
