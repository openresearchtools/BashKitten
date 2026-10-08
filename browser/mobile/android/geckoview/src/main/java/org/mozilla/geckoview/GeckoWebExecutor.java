/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.geckoview;

import androidx.annotation.AnyThread;
import androidx.annotation.IntDef;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.io.IOException;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.net.InetAddress;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CancellationException;
import org.mozilla.gecko.GeckoThread;
import org.mozilla.gecko.annotation.WrapForJNI;
import org.mozilla.gecko.util.ThreadUtils;

/**
 * GeckoWebExecutor is responsible for fetching a {@link WebRequest} and delivering a {@link
 * WebResponse} to the caller via {@link #fetch(WebRequest)}. Example:
 *
 * <pre>
 *     final GeckoWebExecutor executor = new GeckoWebExecutor();
 *
 *     final GeckoResult&lt;WebResponse&gt; result = executor.fetch(
 *             new WebRequest.Builder("https://example.org/json")
 *             .header("Accept", "application/json")
 *             .build());
 *
 *     result.then(response -&gt; {
 *         // Do something with response
 *     });
 * </pre>
 */
@AnyThread
public class GeckoWebExecutor {
  // We don't use this right now because we access GeckoThread directly, but
  // it's future-proofing for a world where we allow multiple GeckoRuntimes.
  private final GeckoRuntime mRuntime;

  @WrapForJNI(dispatchTo = "gecko", stubName = "Fetch")
  private static native void nativeFetch(
      WebRequest request, int flags, GeckoResult<WebResponse> result);

  @WrapForJNI(dispatchTo = "gecko", stubName = "Resolve")
  private static native void nativeResolve(String host, GeckoResult<InetAddress[]> result);

  /** The cancellation signal settles on success/error too, releasing its native listener. */
  private static final class FetchResult extends GeckoResult<WebResponse> {
    final GeckoResult<Boolean> cancellation = new GeckoResult<>();
    boolean cancelled;

    FetchResult() {
      setCancellationDelegate(
          new CancellationDelegate() {
            @Override
            public GeckoResult<Boolean> cancel() {
              synchronized (FetchResult.this) {
                if (!cancelled) {
                  cancelled = true;
                  cancellation.complete(true);
                }
              }
              return GeckoResult.fromValue(true).withHandler(ThreadUtils.getUiHandler());
            }
          });
    }

    @Override
    public synchronized void complete(final @Nullable WebResponse response) {
      if (cancelled) {
        // Headers may win the race with native cancellation. Close the existing
        // body stream in that case instead of handing out an abandoned channel.
        try {
          if (response != null && response.body != null) {
            response.body.close();
          }
        } catch (final IOException ignored) {
        }
        return;
      }
      super.complete(response);
      cancellation.complete(false);
    }

    @Override
    public synchronized void completeExceptionally(final @NonNull Throwable error) {
      // GeckoResult.cancel() owns cancellation completion. The channel's later
      // OnStartRequest error must not complete that same result a second time.
      if (cancelled && !(error instanceof CancellationException)) {
        return;
      }
      super.completeExceptionally(error);
      if (!cancelled) {
        cancellation.complete(false);
      }
    }
  }

  @WrapForJNI(calledFrom = "gecko")
  private static boolean isFetchCancelled(final GeckoResult<WebResponse> result) {
    synchronized (result) {
      return result instanceof FetchResult && ((FetchResult) result).cancelled;
    }
  }

  @WrapForJNI(calledFrom = "gecko")
  private static @Nullable GeckoResult<Boolean> fetchCancellation(
      final GeckoResult<WebResponse> result) {
    return result instanceof FetchResult ? ((FetchResult) result).cancellation : null;
  }

  @WrapForJNI(calledFrom = "gecko", exceptionMode = "nsresult")
  private static ByteBuffer createByteBuffer(final int capacity) {
    return ByteBuffer.allocateDirect(capacity);
  }

  /** Fetch flag definitions for network request options. */
  @Retention(RetentionPolicy.SOURCE)
  @IntDef({
    FETCH_FLAGS_NONE,
    FETCH_FLAGS_ANONYMOUS,
    FETCH_FLAGS_NO_REDIRECTS,
    FETCH_FLAGS_PRIVATE,
    FETCH_FLAGS_STREAM_FAILURE_TEST,
    FETCH_FLAGS_OHTTP,
    FETCH_FLAGS_SAVE_AS_DOWNLOAD,
  })
  public @interface FetchFlags {}

  /** No special treatment. */
  public static final int FETCH_FLAGS_NONE = 0;

  /** Don't send cookies or other user data along with the request. */
  @WrapForJNI public static final int FETCH_FLAGS_ANONYMOUS = 1;

  /** Don't automatically follow redirects. */
  @WrapForJNI public static final int FETCH_FLAGS_NO_REDIRECTS = 1 << 1;

  // There was supposed to be another flag, which we then decided not to implement.
  // That's the reason there's no value 1 << 2, and it can absolutely be used :)

  /** Associates this download with the current private browsing session */
  @WrapForJNI public static final int FETCH_FLAGS_PRIVATE = 1 << 3;

  /** This flag causes a read error in the {@link WebResponse} body. Useful for testing. */
  @WrapForJNI public static final int FETCH_FLAGS_STREAM_FAILURE_TEST = 1 << 10;

  /** Use the OHTTP relay for this request. */
  @WrapForJNI public static final int FETCH_FLAGS_OHTTP = 1 << 11;

  /** Save a user-requested download using Gecko's Save As content policy. */
  @WrapForJNI public static final int FETCH_FLAGS_SAVE_AS_DOWNLOAD = 1 << 12;

  /**
   * Create a new GeckoWebExecutor instance.
   *
   * @param runtime A GeckoRuntime instance
   */
  public GeckoWebExecutor(final @NonNull GeckoRuntime runtime) {
    mRuntime = runtime;
  }

  /**
   * Send the given {@link WebRequest}.
   *
   * @param request A {@link WebRequest} instance
   * @return A {@link GeckoResult} which will be completed with a {@link WebResponse}. If the
   *     request fails to complete, the {@link GeckoResult} will be completed exceptionally with a
   *     {@link WebRequestError}.
   * @throws IllegalArgumentException if request is null or otherwise unusable.
   */
  public @NonNull GeckoResult<WebResponse> fetch(final @NonNull WebRequest request) {
    return fetch(request, FETCH_FLAGS_NONE);
  }

  /**
   * Send the given {@link WebRequest} with specified flags.
   *
   * @param request A {@link WebRequest} instance
   * @param flags The specified flags. One or more of the {@link #FETCH_FLAGS_NONE FETCH_*} flags.
   * @return A {@link GeckoResult} which will be completed with a {@link WebResponse}. If the
   *     request fails to complete, the {@link GeckoResult} will be completed exceptionally with a
   *     {@link WebRequestError}.
   * @throws IllegalArgumentException if request is null or otherwise unusable.
   */
  public @NonNull GeckoResult<WebResponse> fetch(
      final @NonNull WebRequest request, final @FetchFlags int flags) {
    if (request.body != null && !request.body.isDirect()) {
      throw new IllegalArgumentException("Request body must be a direct ByteBuffer");
    }

    if (request.cacheMode < WebRequest.CACHE_MODE_FIRST
        || request.cacheMode > WebRequest.CACHE_MODE_LAST) {
      throw new IllegalArgumentException("Unknown cache mode");
    }

    final String uri = request.uri.toLowerCase(Locale.ROOT);
    // We don't need to fully validate the URI here, just a sanity check
    if (!uri.startsWith("http") && !uri.startsWith("blob")) {
      throw new IllegalArgumentException(
          "Unsupported URI scheme: " + (uri.length() > 10 ? uri.substring(0, 10) : uri));
    }

    // OHTTP also owns a shared configuration fetch; retain its existing lifetime.
    final GeckoResult<WebResponse> result =
        (flags & FETCH_FLAGS_OHTTP) == 0 ? new FetchResult() : new GeckoResult<>();

    if (GeckoThread.isStateAtLeast(GeckoThread.State.PROFILE_READY)) {
      nativeFetch(request, flags, result);
    } else {
      GeckoThread.queueNativeCallUntil(
          GeckoThread.State.PROFILE_READY,
          this,
          "nativeFetch",
          WebRequest.class,
          request,
          flags,
          GeckoResult.class,
          result);
    }

    return result;
  }

  /**
   * Resolves the specified host name.
   *
   * @param host An Internet host name, e.g. mozilla.org.
   * @return A {@link GeckoResult} which will be fulfilled with a {@link List} of {@link
   *     InetAddress}. In case of failure, the {@link GeckoResult} will be completed exceptionally
   *     with a {@link java.net.UnknownHostException}.
   */
  public @NonNull GeckoResult<InetAddress[]> resolve(final @NonNull String host) {
    final GeckoResult<InetAddress[]> result = new GeckoResult<>();

    if (GeckoThread.isStateAtLeast(GeckoThread.State.PROFILE_READY)) {
      nativeResolve(host, result);
    } else {
      GeckoThread.queueNativeCallUntil(
          GeckoThread.State.PROFILE_READY,
          this,
          "nativeResolve",
          String.class,
          host,
          GeckoResult.class,
          result);
    }
    return result;
  }

  /**
   * This causes a speculative connection to be made to the host in the specified URI. This is
   * useful if an app thinks it may be making a request to that host in the near future. If no
   * request is made, the connection will be cleaned up after an unspecified amount of time.
   *
   * @param uri A URI String.
   */
  public void speculativeConnect(final @NonNull String uri) {
    GeckoThread.speculativeConnect(uri);
  }
}
