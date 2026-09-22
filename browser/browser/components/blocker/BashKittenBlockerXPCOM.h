/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef bashkitten_blocker_xpcom_h
#define bashkitten_blocker_xpcom_h

#include "mozilla/content_classifier_ffi.h"
#include "nsCOMPtr.h"
#include "nsIContentPolicy.h"
#include "nsISupportsImpl.h"
#include "nsIBashKittenBlocker.h"

extern "C" nsresult bashkitten_blocker_xpcom_constructor(REFNSIID aIID,
                                                       void** aResult);

/**
 * Content policy that checks every resource load against the blocker,
 * including loads served from internal caches. Delegates decisions to the
 * JS service bridge so bypass and exception logic stays in one place.
 */
class BashKittenBlockerContentPolicy final : public nsIContentPolicy {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSICONTENTPOLICY

  BashKittenBlockerContentPolicy();

 private:
  ~BashKittenBlockerContentPolicy();

  nsIBashKittenBlockerContentPolicyBridge* GetBridge();

  nsCOMPtr<nsIBashKittenBlockerContentPolicyBridge> mBridge;
};

/**
 * Implements nsIBashKittenBlockerEngine directly on the content classifier
 * FFI, bridging JS callers and the Rust adblock engine.
 */
class BashKittenBlockerXPCOM final : public nsIBashKittenBlockerEngine {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIBASHKITTENBLOCKERENGINE

  BashKittenBlockerXPCOM();

 private:
  ~BashKittenBlockerXPCOM();

  void ResetEngine(ContentClassifierFFIEngine* aEngine);

  ContentClassifierFFIEngine* mEngine = nullptr;
};

#endif  // bashkitten_blocker_xpcom_h
