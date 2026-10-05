/* SPDX-License-Identifier: AGPL-3.0-only */
#include "BashKittenTray.h"
#include "nsWindow.h"
#include "nsGTKToolkit.h"
#include "nsPIDOMWindow.h"
#include "WidgetUtils.h"
#include "mozilla/RefPtr.h"
#include "mozilla/dom/BindingDeclarations.h"
#include <cstring>

using namespace mozilla;
using namespace mozilla::widget;

NS_IMPL_ISUPPORTS(BashKittenTray, nsIBashKittenTray)

static constexpr char kWatcher[] = "org.kde.StatusNotifierWatcher";
static constexpr char kPath[] = "/StatusNotifierItem";
static constexpr char kInterface[] = "org.kde.StatusNotifierItem";
static constexpr char kMenu[] = "/org/bashkitten/TrayMenu";
static constexpr char kDescription[] = R"xml(
<node><interface name="org.kde.StatusNotifierItem">
 <property name="Category" type="s" access="read"/>
 <property name="Id" type="s" access="read"/>
 <property name="Title" type="s" access="read"/>
 <property name="Status" type="s" access="read"/>
 <property name="WindowId" type="i" access="read"/>
 <property name="IconThemePath" type="s" access="read"/>
 <property name="IconName" type="s" access="read"/>
 <property name="IconPixmap" type="a(iiay)" access="read"/>
 <property name="OverlayIconName" type="s" access="read"/>
 <property name="OverlayIconPixmap" type="a(iiay)" access="read"/>
 <property name="AttentionIconPixmap" type="a(iiay)" access="read"/>
 <property name="AttentionMovieName" type="s" access="read"/>
 <property name="AttentionIconName" type="s" access="read"/>
 <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
 <property name="ItemIsMenu" type="b" access="read"/>
 <property name="Menu" type="o" access="read"/>
 <method name="ProvideXdgActivationToken"><arg type="s" direction="in"/></method>
 <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
 <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
 <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
 <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
 <signal name="NewToolTip"/>
</interface></node>)xml";

BashKittenTray::BashKittenTray() = default;
BashKittenTray::~BashKittenTray() { Close(); }

NS_IMETHODIMP BashKittenTray::Init(mozIDOMWindowProxy* aWindow,
                                  nsIObserver* aObserver) {
  NS_ENSURE_ARG_POINTER(aWindow);
  NS_ENSURE_ARG_POINTER(aObserver);
  NS_ENSURE_FALSE(mWindow, NS_ERROR_ALREADY_INITIALIZED);
  RefPtr<nsIWidget> widget = WidgetUtils::DOMWindowToWidget(nsPIDOMWindowOuter::From(aWindow));
  mWindow = nsWindow::FromWidget(widget);
  NS_ENSURE_TRUE(mWindow, NS_ERROR_NOT_AVAILABLE);
  NS_ENSURE_TRUE(DBusMenuFunctions::Init(), NS_ERROR_NOT_AVAILABLE);
  mObserver = aObserver;
  mCancel = g_cancellable_new();
  RefPtr<BashKittenTray> self = this;
  g_bus_get(G_BUS_TYPE_SESSION, mCancel,
      [](GObject*, GAsyncResult* result, gpointer data) {
        RefPtr<BashKittenTray> self = dont_AddRef(static_cast<BashKittenTray*>(data));
        GError* error = nullptr;
        auto* bus = g_bus_get_finish(result, &error);
        if (error) g_error_free(error);
        if (!bus) return;
        if (!self->mObserver) { g_object_unref(bus); return; }
        self->mBus = bus;
        static const GDBusInterfaceVTable table = {Method, Property, nullptr, {0}};
        auto* description = g_dbus_node_info_new_for_xml(kDescription, nullptr);
        self->mObject = g_dbus_connection_register_object(bus, kPath,
            description->interfaces[0], &table, self.get(), nullptr, nullptr);
        g_dbus_node_info_unref(description);
        if (!self->mObject) return;
        self->mMenu = dbusmenu_server_new(kMenu);
        auto* root = dbusmenu_menuitem_new();
        dbusmenu_menuitem_set_root(root, true);
        for (const char* action : {"Open BashKitten", "Agent starting", "Quit"}) {
          auto* item = dbusmenu_menuitem_new();
          dbusmenu_menuitem_property_set(item, "label", action);
          dbusmenu_menuitem_property_set_bool(item, "visible", true);
          if (!strcmp(action, "Agent starting")) {
            self->mStatusItem = item;  // Owned by the menu root.
            dbusmenu_menuitem_property_set_bool(item, "enabled", false);
          } else {
            dbusmenu_menuitem_property_set_bool(item, "enabled", true);
            g_signal_connect(item, "item-activated", G_CALLBACK(+[](
                mozilla::widget::DbusmenuMenuitem* item, guint timestamp, gpointer data) {
              nsGTKToolkit::GetToolkit()->SetFocusTimestamp(timestamp);
              auto* self = static_cast<BashKittenTray*>(data);
              bool quit = !strcmp(dbusmenu_menuitem_property_get(item, "label"), "Quit");
              self->Notify(quit ? "quit" : "open");
            }), self.get());
          }
          dbusmenu_menuitem_child_append(root, item);
          g_object_unref(item);
        }
        dbusmenu_server_set_root(self->mMenu, root);
        g_object_unref(root);
        self->SetStatus(self->mStatus);
        self->mWatch = g_bus_watch_name_on_connection(bus, kWatcher,
            G_BUS_NAME_WATCHER_FLAGS_NONE,
            [](GDBusConnection*, const gchar*, const gchar* owner, gpointer data) {
              static_cast<BashKittenTray*>(data)->WatcherAppeared(owner);
            },
            [](GDBusConnection*, const gchar*, gpointer data) {
              static_cast<BashKittenTray*>(data)->WatcherGone();
            }, self.get(), nullptr);
      }, self.forget().take());
  return NS_OK;
}

void BashKittenTray::WatcherAppeared(const char* aOwner) {
  WatcherGone();
  mOwner.Assign(aOwner);
  RefPtr<BashKittenTray> self = this;
  g_dbus_proxy_new(mBus, G_DBUS_PROXY_FLAGS_DO_NOT_AUTO_START, nullptr,
      aOwner, "/StatusNotifierWatcher", kWatcher, mCancel,
      [](GObject*, GAsyncResult* result, gpointer data) {
        RefPtr<BashKittenTray> self = dont_AddRef(static_cast<BashKittenTray*>(data));
        GError* error = nullptr;
        auto* proxy = g_dbus_proxy_new_finish(result, &error);
        if (error) g_error_free(error);
        if (!proxy) return;
        if (!self->mObserver || !self->mOwner.Equals(g_dbus_proxy_get_name(proxy))) {
          g_object_unref(proxy); return;
        }
        self->mWatcher = proxy;
        g_signal_connect(proxy, "g-properties-changed", G_CALLBACK(+[](
            GDBusProxy*, GVariant*, const gchar* const*, gpointer data) {
          static_cast<BashKittenTray*>(data)->UpdateAvailable();
        }), self.get());
        g_signal_connect(proxy, "g-signal", G_CALLBACK(+[](
            GDBusProxy*, const gchar*, const gchar* signal, GVariant*, gpointer data) {
          auto* self = static_cast<BashKittenTray*>(data);
          if (!strcmp(signal, "StatusNotifierHostUnregistered")) {
            g_dbus_proxy_set_cached_property(self->mWatcher, "IsStatusNotifierHostRegistered", g_variant_new_boolean(false));
            self->UpdateAvailable();
          } else if (!strcmp(signal, "StatusNotifierHostRegistered")) {
            g_dbus_proxy_set_cached_property(self->mWatcher, "IsStatusNotifierHostRegistered", g_variant_new_boolean(true));
            self->UpdateAvailable();
          }
        }), self.get());
        auto* cancel = self->mCancel;
        g_dbus_proxy_call(proxy, "RegisterStatusNotifierItem",
            g_variant_new("(s)", kPath), G_DBUS_CALL_FLAGS_NONE, -1, cancel,
            [](GObject* source, GAsyncResult* result, gpointer data) {
              RefPtr<BashKittenTray> self = dont_AddRef(static_cast<BashKittenTray*>(data));
              GError* error = nullptr;
              auto* reply = g_dbus_proxy_call_finish(G_DBUS_PROXY(source), result, &error);
              if (reply) g_variant_unref(reply);
              bool registered = !error;
              if (error) g_error_free(error);
              if (self->mWatcher == G_DBUS_PROXY(source)) {
                self->mRegistered = registered;
                self->UpdateAvailable();
              }
            }, self.forget().take());
      }, self.forget().take());
}

void BashKittenTray::WatcherGone() {
  if (mWatcher) g_signal_handlers_disconnect_by_data(mWatcher, this);
  g_clear_object(&mWatcher);
  mOwner.Truncate();
  mRegistered = false;
  UpdateAvailable();
}

void BashKittenTray::UpdateAvailable() {
  GVariant* hosted = mWatcher ? g_dbus_proxy_get_cached_property(
      mWatcher, "IsStatusNotifierHostRegistered") : nullptr;
  bool ready = mRegistered && hosted && g_variant_is_of_type(hosted, G_VARIANT_TYPE_BOOLEAN)
      && g_variant_get_boolean(hosted);
  if (hosted) g_variant_unref(hosted);
  if (ready == mAvailable) return;
  mAvailable = ready;
  if (!ready && mHidden) Reveal();
  Notify("changed");
}

void BashKittenTray::Notify(const char* aAction) {
  if (!strcmp(aAction, "open")) Reveal();
  nsCOMPtr<nsIObserver> observer = mObserver;
  if (observer) observer->Observe(this, "bashkitten-tray", NS_ConvertASCIItoUTF16(aAction).get());
}

NS_IMETHODIMP BashKittenTray::GetAvailable(bool* aResult) {
  *aResult = mAvailable;
  return NS_OK;
}
NS_IMETHODIMP BashKittenTray::Hide(bool* aResult) {
  *aResult = mAvailable && mWindow;
  if (*aResult) { mWindow->Show(false); mHidden = true; }
  return NS_OK;
}
NS_IMETHODIMP BashKittenTray::Reveal() {
  if (mWindow && mHidden) { mWindow->Show(true); mHidden = false; }
  if (mWindow) mWindow->SetFocus(nsIWidget::Raise::Yes, mozilla::dom::CallerType::System);
  return NS_OK;
}
NS_IMETHODIMP BashKittenTray::SetStatus(const nsACString& aStatus) {
  mStatus = aStatus;
  if (mStatusItem) dbusmenu_menuitem_property_set(mStatusItem, "label", mStatus.get());
  if (mBus && mObject) g_dbus_connection_emit_signal(mBus, nullptr, kPath,
      kInterface, "NewToolTip", nullptr, nullptr);
  return NS_OK;
}
NS_IMETHODIMP BashKittenTray::Close() {
  Reveal();
  mObserver = nullptr;
  if (mCancel) g_cancellable_cancel(mCancel);
  if (mWatch) { g_bus_unwatch_name(mWatch); mWatch = 0; }
  WatcherGone();
  if (mBus && mObject) g_dbus_connection_unregister_object(mBus, mObject);
  mObject = 0;
  mStatusItem = nullptr;
  g_clear_object(&mMenu);
  g_clear_object(&mBus);
  g_clear_object(&mCancel);
  mWindow = nullptr;
  return NS_OK;
}

GVariant* BashKittenTray::Property(GDBusConnection*, const gchar*, const gchar*,
    const gchar*, const gchar* property, GError**, gpointer data) {
  auto* self = static_cast<BashKittenTray*>(data);
  if (!strcmp(property, "Category")) return g_variant_new_string("ApplicationStatus");
  if (!strcmp(property, "Id")) return g_variant_new_string("com.bashkitten");
  if (!strcmp(property, "Title")) return g_variant_new_string("BashKitten");
  if (!strcmp(property, "Status")) return g_variant_new_string("Active");
  if (!strcmp(property, "IconName")) return g_variant_new_string("com.bashkitten");
  if (!strcmp(property, "WindowId")) return g_variant_new_int32(0);
  if (!strcmp(property, "ItemIsMenu")) return g_variant_new_boolean(false);
  if (!strcmp(property, "Menu")) return g_variant_new_object_path(kMenu);
  if (!strcmp(property, "IconPixmap") || !strcmp(property, "OverlayIconPixmap") ||
      !strcmp(property, "AttentionIconPixmap")) return g_variant_new_array(G_VARIANT_TYPE("(iiay)"), nullptr, 0);
  if (!strcmp(property, "ToolTip")) return g_variant_new("(s@a(iiay)ss)", "com.bashkitten",
      g_variant_new_array(G_VARIANT_TYPE("(iiay)"), nullptr, 0), "BashKitten", self->mStatus.get());
  return g_variant_new_string("");
}
void BashKittenTray::Method(GDBusConnection*, const gchar*, const gchar*,
    const gchar*, const gchar* method, GVariant* parameters, GDBusMethodInvocation* call, gpointer data) {
  if (!strcmp(method, "ProvideXdgActivationToken")) {
    const gchar* token = nullptr;
    g_variant_get(parameters, "(&s)", &token);
    nsGTKToolkit::GetToolkit()->SetActivationToken(nsDependentCString(token));
  }
  if (!strcmp(method, "Activate") || !strcmp(method, "SecondaryActivate"))
    static_cast<BashKittenTray*>(data)->Notify("open");
  g_dbus_method_invocation_return_value(call, nullptr);
}
