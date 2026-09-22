/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  createFactory,
  PureComponent,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const dom = require("resource://devtools/client/shared/vendor/react-dom-factories.js");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.mjs");

const FluentReact = require("resource://devtools/client/shared/vendor/fluent-react.js");
const Localized = createFactory(FluentReact.Localized);

const {
  ICON_LABEL_LEVEL,
  PAGE_TYPES,
  RUNTIMES,
} = require("resource://devtools/client/aboutdebugging/src/constants.js");
const Types = require("resource://devtools/client/aboutdebugging/src/types/index.js");
loader.lazyRequireGetter(
  this,
  "ADB_ADDON_STATES",
  "resource://devtools/client/shared/remote-debugging/adb/adb-addon.js",
  true
);

const IconLabel = createFactory(
  require("resource://devtools/client/aboutdebugging/src/components/shared/IconLabel.js")
);
const SidebarItem = createFactory(
  require("resource://devtools/client/aboutdebugging/src/components/sidebar/SidebarItem.js")
);
const SidebarFixedItem = createFactory(
  require("resource://devtools/client/aboutdebugging/src/components/sidebar/SidebarFixedItem.js")
);
const SidebarRuntimeItem = createFactory(
  require("resource://devtools/client/aboutdebugging/src/components/sidebar/SidebarRuntimeItem.js")
);
const RefreshDevicesButton = createFactory(
  require("resource://devtools/client/aboutdebugging/src/components/sidebar/RefreshDevicesButton.js")
);
const BROWSER_ICON = "chrome://branding/content/icon32.png";
const CONNECT_ICON = "chrome://devtools/skin/images/settings.svg";
const GLOBE_ICON =
  "chrome://devtools/skin/images/aboutdebugging-globe-icon.svg";
const USB_ICON =
  "chrome://devtools/skin/images/aboutdebugging-connect-icon.svg";

class Sidebar extends PureComponent {
  static get propTypes() {
    return {
      adbAddonStatus: Types.adbAddonStatus,
      className: PropTypes.string,
      dispatch: PropTypes.func.isRequired,
      isAdbReady: PropTypes.bool.isRequired,
      isScanningUsb: PropTypes.bool.isRequired,
      networkRuntimes: PropTypes.arrayOf(Types.runtime).isRequired,
      selectedPage: Types.page,
      selectedRuntimeId: PropTypes.string,
      usbRuntimes: PropTypes.arrayOf(Types.runtime).isRequired,
    };
  }

  renderAdbStatus() {
    const isUsbEnabled =
      this.props.isAdbReady &&
      this.props.adbAddonStatus === ADB_ADDON_STATES.INSTALLED;
    const localizationId = isUsbEnabled
      ? "about-debugging-sidebar-usb-enabled"
      : "about-debugging-sidebar-usb-disabled";
    return IconLabel(
      {
        level: isUsbEnabled ? ICON_LABEL_LEVEL.OK : ICON_LABEL_LEVEL.INFO,
      },
      Localized(
        {
          id: localizationId,
        },
        dom.span(
          {
            className: "qa-sidebar-usb-status",
          },
          localizationId
        )
      )
    );
  }

  renderDevicesEmpty() {
    return SidebarItem(
      {},
      Localized(
        {
          id: "about-debugging-sidebar-no-devices",
        },
        dom.aside(
          {
            className: "sidebar__label qa-sidebar-no-devices",
          },
          "No devices discovered"
        )
      )
    );
  }

  renderDevices() {
    const { networkRuntimes, usbRuntimes } = this.props;

    // render a "no devices" messages when the lists are empty
    if (!networkRuntimes.length && !usbRuntimes.length) {
      return this.renderDevicesEmpty();
    }
    // render all devices otherwise
    return [
      ...this.renderRuntimeItems(GLOBE_ICON, networkRuntimes),
      ...this.renderRuntimeItems(USB_ICON, usbRuntimes),
    ];
  }

  renderRuntimeItems(icon, runtimes) {
    const { dispatch, selectedPage, selectedRuntimeId } = this.props;

    return runtimes.map(runtime => {
      const keyId = `${runtime.type}-${runtime.id}`;
      const runtimeHasDetails = !!runtime.runtimeDetails;
      const isSelected =
        selectedPage === PAGE_TYPES.RUNTIME && runtime.id === selectedRuntimeId;

      let name = runtime.name;
      if (runtime.type === RUNTIMES.USB && runtimeHasDetails) {
        // Update the name to be same to the runtime page.
        name = runtime.runtimeDetails.info.name;
      }

      return SidebarRuntimeItem({
        deviceName: runtime.extra.deviceName,
        dispatch,
        icon,
        key: keyId,
        isConnected: runtimeHasDetails,
        isConnecting: runtime.isConnecting,
        isConnectionFailed: runtime.isConnectionFailed,
        isConnectionNotResponding: runtime.isConnectionNotResponding,
        isConnectionTimeout: runtime.isConnectionTimeout,
        isSelected,
        isUnavailable: runtime.isUnavailable,
        isUnplugged: runtime.isUnplugged,
        name,
        runtimeId: runtime.id,
      });
    });
  }

  render() {
    const { dispatch, selectedPage, selectedRuntimeId, isScanningUsb, isAdbReady } =
      this.props;
    const showUsbControls = isAdbReady || Boolean(
      Services.prefs.getStringPref("devtools.remote.adb.extensionURL", "")
    );

    return dom.aside(
      {
        className: `sidebar ${this.props.className || ""}`,
      },
      dom.ul(
        {},
        Localized(
          { id: "about-debugging-sidebar-setup", attrs: { name: true } },
          SidebarFixedItem({
            dispatch,
            icon: CONNECT_ICON,
            isSelected: PAGE_TYPES.CONNECT === selectedPage,
            key: PAGE_TYPES.CONNECT,
            name: "Setup",
            to: "/setup",
          })
        ),
        Localized(
          { id: "about-debugging-sidebar-this-firefox", attrs: { name: true } },
          SidebarFixedItem({
            icon: BROWSER_ICON,
            isSelected:
              PAGE_TYPES.RUNTIME === selectedPage &&
              selectedRuntimeId === RUNTIMES.THIS_FIREFOX,
            key: RUNTIMES.THIS_FIREFOX,
            name: "This BashKitten",
            to: `/runtime/${RUNTIMES.THIS_FIREFOX}`,
          })
        ),
        showUsbControls && SidebarItem(
          {
            className: "sidebar__adb-status",
          },
          dom.hr({ className: "separator separator--breathe" }),
          this.renderAdbStatus()
        ),
        this.renderDevices(),
        showUsbControls && SidebarItem(
          {
            className: "sidebar-item--breathe sidebar__refresh-usb",
            key: "refresh-devices",
          },
          RefreshDevicesButton({
            dispatch,
            isScanning: isScanningUsb,
          })
        )
      )
    );
  }
}

module.exports = Sidebar;
