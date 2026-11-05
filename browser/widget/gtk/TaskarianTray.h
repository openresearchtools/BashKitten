/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef TaskarianTray_h
#define TaskarianTray_h

#include "nsITaskarianTray.h"
#include "nsIObserver.h"
#include "nsCOMPtr.h"
#include "nsString.h"
#include "mozilla/RefPtr.h"
#include <gio/gio.h>
#include "DBusMenu.h"

class nsWindow;

class TaskarianTray final : public nsITaskarianTray {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSITASKARIANTRAY
  TaskarianTray();

 private:
  ~TaskarianTray();
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
