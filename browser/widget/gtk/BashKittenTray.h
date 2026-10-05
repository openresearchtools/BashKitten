/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef BashKittenTray_h
#define BashKittenTray_h

#include "nsIBashKittenTray.h"
#include "nsIObserver.h"
#include "nsCOMPtr.h"
#include "nsString.h"
#include "mozilla/RefPtr.h"
#include <gio/gio.h>
#include "DBusMenu.h"

class nsWindow;

class BashKittenTray final : public nsIBashKittenTray {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIBASHKITTENTRAY
  BashKittenTray();

 private:
  ~BashKittenTray();
  void WatcherAppeared(const char* aOwner);
  void UpdateAvailable();
  void Notify(const char* aAction);
  void WatcherGone();
  static GVariant* Property(GDBusConnection*, const gchar*, const gchar*,
                            const gchar*, const gchar*, GError**, gpointer);
  static void Method(GDBusConnection*, const gchar*, const gchar*, const gchar*,
                     const gchar*, GVariant*, GDBusMethodInvocation*, gpointer);
  RefPtr<nsWindow> mWindow;
  nsCOMPtr<nsIObserver> mObserver;
  GDBusConnection* mBus = nullptr;
  GDBusProxy* mWatcher = nullptr;
  GCancellable* mCancel = nullptr;
  mozilla::widget::DbusmenuServer* mMenu = nullptr;
  mozilla::widget::DbusmenuMenuitem* mStatusItem = nullptr;
  nsCString mOwner;
  nsCString mStatus;
  guint mWatch = 0;
  guint mObject = 0;
  bool mRegistered = false;
  bool mAvailable = false;
  bool mHidden = false;
};
#endif
