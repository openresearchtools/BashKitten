/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef taskarian_blocker_xpcom_h
#define taskarian_blocker_xpcom_h

#include "mozilla/content_classifier_ffi.h"
#include "nsCOMPtr.h"
#include "nsIContentPolicy.h"
#include "nsISupportsImpl.h"
#include "nsITaskarianBlocker.h"

extern "C" nsresult taskarian_blocker_xpcom_constructor(REFNSIID aIID,
                                                       void** aResult);

/**
 * Content policy that checks every resource load against the blocker,
 * including loads served from internal caches. Delegates decisions to the
 * JS service bridge so bypass and exception logic stays in one place.
 */
class TaskarianBlockerContentPolicy final : public nsIContentPolicy {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSICONTENTPOLICY

  TaskarianBlockerContentPolicy();

 private:
  ~TaskarianBlockerContentPolicy();

  nsITaskarianBlockerContentPolicyBridge* GetBridge();

  nsCOMPtr<nsITaskarianBlockerContentPolicyBridge> mBridge;
};

/**
 * Implements nsITaskarianBlockerEngine directly on the content classifier
 * FFI, bridging JS callers and the Rust adblock engine.
 */
class TaskarianBlockerXPCOM final : public nsITaskarianBlockerEngine {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSITASKARIANBLOCKERENGINE

  TaskarianBlockerXPCOM();

 private:
  ~TaskarianBlockerXPCOM();

  void ResetEngine(ContentClassifierFFIEngine* aEngine);

  ContentClassifierFFIEngine* mEngine = nullptr;
};

#endif  // taskarian_blocker_xpcom_h
