/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef BashKittenDisplay_h
#define BashKittenDisplay_h
#include "nsIBashKittenDisplay.h"
#include "nsIObserver.h"
#include "nsIThread.h"
#include "mozilla/Atomics.h"
#include "mozilla/Mutex.h"
#include "mozilla/RefPtr.h"
#include "nsCOMPtr.h"
#include "nsString.h"
#include "nsTArray.h"
namespace mozilla { class VideoFrameContainer; }
class BashKittenDisplay final : public nsIBashKittenDisplay {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIBASHKITTENDISPLAY
  BashKittenDisplay();
 private:
  ~BashKittenDisplay();
  void Run(nsCString socket, nsCString executable);
  void Status(const nsCString& status);
  void Invalidate();
  mozilla::Mutex mMutex{"BashKittenDisplay"};
  nsTArray<nsCString> mInputs MOZ_GUARDED_BY(mMutex);
  mozilla::Atomic<bool> mClosed{false};
  mozilla::Atomic<uint64_t> mGeneration{1};
  mozilla::Atomic<bool> mVisible{true};
  mozilla::Atomic<bool> mInvalidationPending{false};
  RefPtr<mozilla::VideoFrameContainer> mFrames;
  nsCOMPtr<nsIObserver> mObserver;
  nsCOMPtr<nsIThread> mThread;
};
#endif
