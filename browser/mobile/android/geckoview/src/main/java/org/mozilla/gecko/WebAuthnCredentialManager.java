/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.gecko;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.credentials.CreateCredentialException;
import android.credentials.CreateCredentialRequest;
import android.credentials.CreateCredentialResponse;
import android.credentials.CredentialManager;
import android.credentials.CredentialOption;
import android.credentials.GetCredentialException;
import android.credentials.GetCredentialRequest;
import android.credentials.GetCredentialResponse;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.OutcomeReceiver;
import androidx.annotation.ChecksSdkIntAtLeast;
import androidx.annotation.UiThread;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.mozilla.gecko.util.ThreadUtils;
import org.mozilla.gecko.util.WebAuthnUtils;
import org.mozilla.geckoview.GeckoResult;

// Android 14+ framework Credential Manager implementation.
public class WebAuthnCredentialManager {
  // Wire keys shared with AndroidX credential providers.
  // https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:credentials/credentials/src/main/java/androidx/credentials/
  private static final String CM_PREFIX = "androidx.credentials.";
  private static final String TYPE_PUBLIC_KEY_CREDENTIAL = CM_PREFIX + "TYPE_PUBLIC_KEY_CREDENTIAL";
  private static final String BUNDLE_KEY_CLIENT_DATA_HASH =
      CM_PREFIX + "BUNDLE_KEY_CLIENT_DATA_HASH";
  private static final String BUNDLE_KEY_REGISTRATION_RESPONSE_JSON =
      CM_PREFIX + "BUNDLE_KEY_REGISTRATION_RESPONSE_JSON";
  private static final String BUNDLE_KEY_AUTHENTICATION_RESPONSE_JSON =
      CM_PREFIX + "BUNDLE_KEY_AUTHENTICATION_RESPONSE_JSON";
  private static final String BUNDLE_KEY_REQUEST_JSON = CM_PREFIX + "BUNDLE_KEY_REQUEST_JSON";
  private static final String BUNDLE_KEY_REQUEST_DISPLAY_INFO =
      CM_PREFIX + "BUNDLE_KEY_REQUEST_DISPLAY_INFO";
  private static final String BUNDLE_KEY_SUBTYPE = CM_PREFIX + "BUNDLE_KEY_SUBTYPE";
  private static final String BUNDLE_KEY_USER_DISPLAY_NAME =
      CM_PREFIX + "BUNDLE_KEY_USER_DISPLAY_NAME";
  private static final String BUNDLE_KEY_USER_ID = CM_PREFIX + "BUNDLE_KEY_USER_ID";
  private static final String BUNDLE_VALUE_SUBTYPE_CREATE_PUBLIC_KEY_CREDENTIAL_REQUEST =
      CM_PREFIX + "BUNDLE_VALUE_SUBTYPE_CREATE_PUBLIC_KEY_CREDENTIAL_REQUEST";
  private static final String BUNDLE_VALUE_SUBTYPE_GET_PUBLIC_KEY_CREDENTIAL_OPTION =
      CM_PREFIX + "BUNDLE_VALUE_SUBTYPE_GET_PUBLIC_KEY_CREDENTIAL_OPTION";
  private static final String BUNDLE_KEY_IS_AUTO_SELECT_ALLOWED =
      CM_PREFIX + "BUNDLE_KEY_IS_AUTO_SELECT_ALLOWED";
  private static final String BUNDLE_KEY_PREFER_IMMEDIATELY_AVAILABLE_CREDENTIALS =
      CM_PREFIX + "BUNDLE_KEY_PREFER_IMMEDIATELY_AVAILABLE_CREDENTIALS";

  private static Bundle getRequestBundle(final String requestJSON, final byte[] clientDataHash) {
    final Bundle requestBundle = new Bundle();
    requestBundle.putString(BUNDLE_KEY_REQUEST_JSON, requestJSON);
    requestBundle.putByteArray(BUNDLE_KEY_CLIENT_DATA_HASH, clientDataHash);

    return requestBundle;
  }

  private static Bundle getRequestBundleForMakeCredential(
      final byte[] clientDataHash, final String requestJSON) {
    final Bundle bundle = getRequestBundle(requestJSON, clientDataHash);
    final JSONObject json;
    try {
      json = new JSONObject(requestJSON);
    } catch (final JSONException e) {
      return null;
    }

    final JSONObject userField = json.optJSONObject("user");
    if (userField == null) {
      return null;
    }

    final Bundle displayInfoBundle = new Bundle();
    displayInfoBundle.putCharSequence(BUNDLE_KEY_USER_ID, userField.optString("name"));
    displayInfoBundle.putString(BUNDLE_KEY_USER_DISPLAY_NAME, userField.optString("displayName"));
    bundle.putBundle(BUNDLE_KEY_REQUEST_DISPLAY_INFO, displayInfoBundle);

    bundle.putString(BUNDLE_KEY_SUBTYPE, BUNDLE_VALUE_SUBTYPE_CREATE_PUBLIC_KEY_CREDENTIAL_REQUEST);
    return bundle;
  }

  private static Bundle getRequestBundleForGetAssertion(
      final byte[] clientDataHash, final String requestJSON) {
    final Bundle bundle = getRequestBundle(requestJSON, clientDataHash);
    final JSONObject json;
    try {
      json = new JSONObject(requestJSON);
    } catch (final JSONException e) {
      return null;
    }
    final JSONArray allowList = json.optJSONArray("allowCredentials");
    bundle.putBoolean(
        BUNDLE_KEY_IS_AUTO_SELECT_ALLOWED, allowList != null && allowList.length() > 0);

    bundle.putString(BUNDLE_KEY_SUBTYPE, BUNDLE_VALUE_SUBTYPE_GET_PUBLIC_KEY_CREDENTIAL_OPTION);
    return bundle;
  }

  // Owned exclusively by the Android UI thread. A stale cancel or provider callback
  // must never finish a successor transaction.
  private static Request<?> activeRequest;

  private static final class Request<T> {
    final long transactionId;
    final GeckoResult<T> result = new GeckoResult<>();
    final CancellationSignal cancellation = new CancellationSignal();
    boolean completed;

    Request(final long transactionId) {
      this.transactionId = transactionId;
      if (activeRequest != null) {
        activeRequest.cancel();
      }
      activeRequest = this;
    }

    boolean finish() {
      ThreadUtils.assertOnUiThread();
      if (completed) {
        return false;
      }
      completed = true;
      if (activeRequest == this) {
        activeRequest = null;
      }
      return true;
    }

    void resolve(final T value) {
      if (finish()) {
        result.complete(value);
      }
    }

    void reject(final String error) {
      if (finish()) {
        result.completeExceptionally(new WebAuthnUtils.Exception(error));
      }
    }

    void cancel() {
      // Settle before cancel(), which can synchronously deliver a callback.
      reject("ABORT_ERR");
      cancellation.cancel();
    }
  }

  @UiThread
  public static void cancel(final long transactionId) {
    ThreadUtils.assertOnUiThread();
    if (activeRequest != null && activeRequest.transactionId == transactionId) {
      activeRequest.cancel();
    }
  }

  @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  public static boolean isAvailable() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      return false;
    }
    final Context context = GeckoAppShell.getApplicationContext();
    return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CREDENTIALS)
        && context.getSystemService(Context.CREDENTIAL_SERVICE) != null;
  }

  // AndroidX public-key providers encode WebAuthn DOM errors in the framework
  // exception type. Preserve the recognized errors, including provider origin /
  // signing-identity rejection, instead of retrying with another authenticator.
  private static String providerError(final String type, final boolean create) {
    final String prefix = CM_PREFIX + "TYPE_" + (create ? "CREATE" : "GET")
        + "_PUBLIC_KEY_CREDENTIAL_DOM_EXCEPTION/" + CM_PREFIX + "TYPE_";
    if (!type.startsWith(prefix)) {
      return "UNKNOWN_ERR";
    }
    switch (type.substring(prefix.length())) {
      case "ABORT_ERROR":
        return "ABORT_ERR";
      case "CONSTRAINT_ERROR":
        return "CONSTRAINT_ERR";
      case "DATA_ERROR":
        return "DATA_ERR";
      case "ENCODING_ERROR":
        return "ENCODING_ERR";
      case "INVALID_STATE_ERROR":
        return "INVALID_STATE_ERR";
      case "NETWORK_ERROR":
        return "NETWORK_ERR";
      case "NOT_ALLOWED_ERROR":
        return "NOT_ALLOWED_ERR";
      case "NOT_SUPPORTED_ERROR":
        return "NOT_SUPPORTED_ERR";
      case "SECURITY_ERROR":
        return "SECURITY_ERR";
      case "TIMEOUT_ERROR":
        return "TIMEOUT_ERR";
      default:
        return "UNKNOWN_ERR";
    }
  }

  @UiThread
  @SuppressLint("MissingPermission")
  public static GeckoResult<WebAuthnUtils.MakeCredentialResponse> makeCredential(
      final long transactionId, final String origin, final byte[] clientDataHash,
      final String requestJSON) {
    ThreadUtils.assertOnUiThread();
    final Request<WebAuthnUtils.MakeCredentialResponse> operation = new Request<>(transactionId);
    try {
      if (!isAvailable()) {
        operation.reject("NOT_SUPPORTED_ERR");
        return operation.result;
      }
      final Context context = GeckoAppShell.getApplicationContext();
      final Bundle bundle = getRequestBundleForMakeCredential(clientDataHash, requestJSON);
      if (bundle == null) {
        operation.reject("DATA_ERR");
        return operation.result;
      }
      bundle.putBoolean(BUNDLE_KEY_PREFER_IMMEDIATELY_AVAILABLE_CREDENTIALS, false);
      bundle.putBoolean(BUNDLE_KEY_IS_AUTO_SELECT_ALLOWED, false);
      final CreateCredentialRequest request =
          new CreateCredentialRequest.Builder(TYPE_PUBLIC_KEY_CREDENTIAL, bundle, bundle)
              .setAlwaysSendAppInfoToProvider(true)
              .setOrigin(origin)
              .build();
      final CredentialManager manager = context.getSystemService(CredentialManager.class);
      manager.createCredential(context, request, operation.cancellation, context.getMainExecutor(),
          new OutcomeReceiver<CreateCredentialResponse, CreateCredentialException>() {
            @Override
            public void onResult(final CreateCredentialResponse response) {
              if (operation.completed) {
                return;
              }
              try {
                final String json =
                    response.getData().getString(BUNDLE_KEY_REGISTRATION_RESPONSE_JSON);
                if (json == null) {
                  operation.reject("DATA_ERR");
                  return;
                }
                operation.resolve(WebAuthnUtils.getMakeCredentialResponse(json));
              } catch (final JSONException | RuntimeException e) {
                operation.reject("DATA_ERR");
              }
            }

            @Override
            public void onError(final CreateCredentialException exception) {
              final String type = exception.getType();
              if (CreateCredentialException.TYPE_USER_CANCELED.equals(type)) {
                operation.reject("NOT_ALLOWED_ERR");
              } else if (CreateCredentialException.TYPE_INTERRUPTED.equals(type)) {
                operation.reject("ABORT_ERR");
              } else if (CreateCredentialException.TYPE_NO_CREATE_OPTIONS.equals(type)) {
                operation.reject("NOT_SUPPORTED_ERR");
              } else {
                operation.reject(providerError(type, true));
              }
            }
          });
    } catch (final SecurityException e) {
      operation.reject("SECURITY_ERR");
    } catch (final RuntimeException e) {
      operation.reject("UNKNOWN_ERR");
    }
    return operation.result;
  }

  @UiThread
  @SuppressLint("MissingPermission")
  public static GeckoResult<WebAuthnUtils.GetAssertionResponse> getAssertion(
      final long transactionId, final String origin, final byte[] clientDataHash,
      final String requestJSON) {
    ThreadUtils.assertOnUiThread();
    final Request<WebAuthnUtils.GetAssertionResponse> operation = new Request<>(transactionId);
    try {
      if (!isAvailable()) {
        operation.reject("NOT_SUPPORTED_ERR");
        return operation.result;
      }
      final Context context = GeckoAppShell.getApplicationContext();
      final Bundle bundle = getRequestBundleForGetAssertion(clientDataHash, requestJSON);
      if (bundle == null) {
        operation.reject("DATA_ERR");
        return operation.result;
      }
      final CredentialOption option =
          new CredentialOption.Builder(TYPE_PUBLIC_KEY_CREDENTIAL, bundle, bundle).build();
      final GetCredentialRequest request = new GetCredentialRequest.Builder(new Bundle())
                                               .addCredentialOption(option)
                                               .setAlwaysSendAppInfoToProvider(true)
                                               .setOrigin(origin)
                                               .build();
      final CredentialManager manager = context.getSystemService(CredentialManager.class);
      // Use the actual request, including locked-provider and remote options. A
      // prepare result with no local candidates is not proof of unavailability.
      manager.getCredential(context, request, operation.cancellation, context.getMainExecutor(),
          new OutcomeReceiver<GetCredentialResponse, GetCredentialException>() {
            @Override
            public void onResult(final GetCredentialResponse response) {
              if (operation.completed) {
                return;
              }
              try {
                if (!TYPE_PUBLIC_KEY_CREDENTIAL.equals(response.getCredential().getType())) {
                  operation.reject("DATA_ERR");
                  return;
                }
                final String json = response.getCredential().getData().getString(
                    BUNDLE_KEY_AUTHENTICATION_RESPONSE_JSON);
                if (json == null) {
                  operation.reject("DATA_ERR");
                  return;
                }
                operation.resolve(WebAuthnUtils.getGetAssertionResponse(json));
              } catch (final JSONException | RuntimeException e) {
                operation.reject("DATA_ERR");
              }
            }

            @Override
            public void onError(final GetCredentialException exception) {
              final String type = exception.getType();
              if (GetCredentialException.TYPE_USER_CANCELED.equals(type)
                  || GetCredentialException.TYPE_NO_CREDENTIAL.equals(type)) {
                operation.reject("NOT_ALLOWED_ERR");
              } else if (GetCredentialException.TYPE_INTERRUPTED.equals(type)) {
                operation.reject("ABORT_ERR");
              } else {
                operation.reject(providerError(type, false));
              }
            }
          });
    } catch (final SecurityException e) {
      operation.reject("SECURITY_ERR");
    } catch (final RuntimeException e) {
      operation.reject("UNKNOWN_ERR");
    }
    return operation.result;
  }
}
