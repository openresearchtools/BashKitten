// SPDX-License-Identifier: AGPL-3.0-only

import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

// Thin adapters over BrowsingContext and the native desktop RDM owner. Never
// import the desktop DevTools client on Android.
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  require: "resource://devtools/shared/loader/Loader.sys.mjs",
});

const sessions = new WeakMap();
const PROPERTIES = {
  devicePixelRatio: "overrideDPPX",
  userAgent: "customUserAgent",
  touch: "touchEventsOverride",
  media: "mediumOverride",
  colorScheme: "prefersColorSchemeOverride",
  reducedMotion: "prefersReducedMotionOverride",
  forcedColors: "forcedColorsOverride",
  locale: "languageOverride",
  timezone: "timezoneOverride",
  offline: "forceOffline",
  cacheDisabled: "defaultLoadFlags",
  javascriptEnabled: "allowJavascript",
};
const FIELDS = [
  ...Object.keys(PROPERTIES),
  "orientation",
  "screen",
  "geolocation",
];
const RDM_PREFS = [
  "devtools.responsive.viewport.width",
  "devtools.responsive.viewport.height",
  "devtools.responsive.viewport.pixelRatio",
  "devtools.responsive.viewport.angle",
  "devtools.responsive.userAgent",
  "devtools.responsive.touchSimulation.enabled",
];
const DEVICE_STATE = "devtools.responsive.deviceState";
const ORIENTATIONS = [
  "portrait-primary",
  "portrait-secondary",
  "landscape-primary",
  "landscape-secondary",
];

function contextFor(session) {
  const context =
    session.browser?.browsingContext?.top || session.browsingContext;
  if (!context || context.isDiscarded) {
    throw new Error("The debugged browsing context is no longer available");
  }
  return context;
}

function stateFor(session) {
  let state = sessions.get(session);
  if (state?.resetValues) {
    throw new Error(
      "The previous environment reset failed; retry reset_environment first"
    );
  }
  if (!state) {
    state = { originals: new Map(), values: new Map(), rdm: null };
    sessions.set(session, state);
    const browserId = contextFor(session).browserId;
    state.observer = context => {
      if (
        context.parent ||
        context.browserId !== browserId ||
        context.isDiscarded
      ) {
        return;
      }
      // Apply early enough for the first script after a process/COOP change.
      // RDM's own target-configuration actor owns its RDM-specific settings.
      try {
        for (const [key, value] of state.values) {
          if (key !== "geolocation") {
            applyNative(state, context, key, value);
          }
        }
      } catch (error) {
        session.emit("environment_error", { message: error.message });
      }
    };
    Services.obs.addObserver(state.observer, "browsing-context-attached");
    session.addCleanup(() => resetEnvironment(session));
  }
  return state;
}

function capture(state, context, property) {
  let originals = state.originals.get(context);
  if (!originals) {
    originals = new Map();
    state.originals.set(context, originals);
  }
  if (!originals.has(property)) {
    originals.set(property, context[property]);
  }
}

function number(value, name, minimum, maximum = Infinity, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function oneOf(value, name, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function normalize(key, value) {
  switch (key) {
    case "devicePixelRatio":
      return value === null ? 0 : number(value, key, Number.MIN_VALUE);
    case "userAgent":
      if (value !== null && (typeof value !== "string" || !value)) {
        throw new Error("userAgent must be a nonempty string or null");
      }
      return value ?? "";
    case "touch":
      if (value !== null && typeof value !== "boolean") {
        throw new Error("touch must be a boolean or null");
      }
      return value === null ? "none" : value ? "enabled" : "disabled";
    case "media":
      return value === null ? "" : oneOf(value, key, ["screen", "print"]);
    case "colorScheme":
      return value === null ? "none" : oneOf(value, key, ["light", "dark"]);
    case "reducedMotion":
      return value === null
        ? "none"
        : oneOf(value, key, ["reduce", "no-preference"]);
    case "forcedColors":
      return value === null ? "none" : oneOf(value, key, ["active", "none"]);
    case "locale":
      if (value === null) {
        return "";
      }
      if (
        typeof value !== "string" ||
        !value ||
        !Intl.getCanonicalLocales(value).length
      ) {
        throw new Error("locale must be a valid BCP 47 language tag or null");
      }
      return value;
    case "timezone":
      if (value === null) {
        return "";
      }
      if (typeof value !== "string" || !value) {
        throw new Error("timezone must be a timezone ID, offset, or null");
      }
      if (
        /^[+-]\d\d:\d\d$/.test(value) &&
        ChromeUtils.isISOStyleDate(`2011-10-05T00:00${value}`)
      ) {
        return `GMT${value}`;
      }
      // The native setter accepts timezone IDs supported by ICU.
      new Intl.DateTimeFormat("en", { timeZone: value });
      return value;
    case "offline":
    case "cacheDisabled":
    case "javascriptEnabled":
      if (typeof value !== "boolean") {
        throw new Error(`${key} must be a boolean`);
      }
      return value;
    case "screen":
      if (value === null) {
        return null;
      }
      return {
        width: number(
          value?.width,
          "screen.width",
          1,
          Number.MAX_SAFE_INTEGER,
          true
        ),
        height: number(
          value?.height,
          "screen.height",
          1,
          Number.MAX_SAFE_INTEGER,
          true
        ),
      };
    case "orientation":
      if (value === null) {
        return null;
      }
      return {
        type: oneOf(value?.type, "orientation.type", ORIENTATIONS),
        angle: oneOf(value?.angle, "orientation.angle", [0, 90, 180, 270]),
      };
    case "geolocation": {
      if (value === null) {
        return null;
      }
      const coordinates = {
        latitude: number(value?.latitude, "geolocation.latitude", -90, 90),
        longitude: number(value?.longitude, "geolocation.longitude", -180, 180),
        accuracy: number(value?.accuracy ?? 1, "geolocation.accuracy", 0),
      };
      for (const name of ["altitude", "altitudeAccuracy", "heading", "speed"]) {
        const minimum = name === "altitude" ? -Infinity : 0;
        const maximum =
          name === "heading" ? 360 - Number.EPSILON * 360 : Infinity;
        coordinates[name] =
          value[name] == null
            ? null
            : number(value[name], `geolocation.${name}`, minimum, maximum);
      }
      if (
        coordinates.altitudeAccuracy !== null &&
        coordinates.altitude === null
      ) {
        throw new Error("geolocation.altitudeAccuracy requires altitude");
      }
      return coordinates;
    }
    default:
      throw new Error(`Unknown environment field: ${key}`);
  }
}

function applyNative(state, context, key, value) {
  if (!state.originals.has(context)) {
    state.originals.set(context, new Map());
  }
  if (key === "orientation") {
    if (value === null) {
      context.resetOrientationOverride();
    } else {
      context.setOrientationOverride(value.type, value.angle);
    }
  } else if (key === "screen") {
    if (value === null) {
      context.resetScreenAreaOverride();
    } else {
      context.setScreenAreaOverride(value.width, value.height);
    }
  } else {
    const property = PROPERTIES[key];
    capture(state, context, property);
    if (key === "cacheDisabled") {
      context[property] = value
        ? context[property] | Ci.nsIRequest.LOAD_BYPASS_CACHE
        : context[property] & ~Ci.nsIRequest.LOAD_BYPASS_CACHE;
    } else {
      context[property] = value;
    }
  }
}

function responsiveManager(session) {
  if (session.platform !== "linux" || !session.tab) {
    throw new Error(
      "Native responsive viewport and device profiles require desktop Linux"
    );
  }
  return lazy.require("resource://devtools/client/responsive/manager.js");
}

function responsiveWindow(session) {
  const window = session.window || session.tab?.ownerDocument?.defaultView;
  if (!window?.gBrowser) {
    throw new Error("The native responsive UI browser window is unavailable");
  }
  return window;
}

function activeUI(session) {
  return session.platform === "linux" && session.tab
    ? responsiveManager(session).getResponsiveUIForTab(session.tab)
    : null;
}

function savedPreferences() {
  return RDM_PREFS.map(name => {
    const type = Services.prefs.getPrefType(name);
    let value;
    if (type === Services.prefs.PREF_BOOL) {
      value = Services.prefs.getBoolPref(name);
    } else if (type === Services.prefs.PREF_INT) {
      value = Services.prefs.getIntPref(name);
    } else if (type === Services.prefs.PREF_STRING) {
      value = Services.prefs.getStringPref(name);
    }
    return { name, type, value, user: Services.prefs.prefHasUserValue(name) };
  });
}

function restorePreferences(preferences) {
  for (const { name, type, value, user } of preferences) {
    if (!user) {
      Services.prefs.clearUserPref(name);
    } else if (type === Services.prefs.PREF_BOOL) {
      Services.prefs.setBoolPref(name, value);
    } else if (type === Services.prefs.PREF_INT) {
      Services.prefs.setIntPref(name, value);
    } else if (type === Services.prefs.PREF_STRING) {
      Services.prefs.setStringPref(name, value);
    }
  }
}

async function awaitSavedDevice(ui, deviceState, signal) {
  if (!deviceState?.device) {
    return;
  }
  // Opening native RDM starts its saved-device restoration after initialize()
  // resolves. Wait for that owner's actual configuration before changing it.
  const { loadableState } = lazy.require(
    "resource://devtools/client/responsive/types.js"
  );
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (signal?.aborted || ui.destroying) {
      throw new Error("Native responsive UI initialization was interrupted");
    }
    const { devices, viewports } = ui.toolWindow.store.getState();
    if (devices.listState === loadableState.ERROR) {
      throw new Error(
        "Native responsive UI could not load its saved device catalog"
      );
    }
    if (devices.listState === loadableState.LOADED) {
      const device = devices[deviceState.deviceType]?.find(
        entry => entry.name === deviceState.device
      );
      if (!device) {
        return;
      }
      const configuration =
        ui.commands.targetConfigurationCommand.configuration;
      if (
        viewports[0]?.device === device.name &&
        Number(configuration.overrideDPPX) === Number(device.pixelRatio) &&
        configuration.customUserAgent === device.userAgent &&
        configuration.touchEventsOverride === (device.touch ? "enabled" : null)
      ) {
        return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(
    "Native responsive UI did not finish restoring its saved device"
  );
}

async function ensureResponsive(session, state) {
  const manager = responsiveManager(session);
  let ui = manager.getResponsiveUIForTab(session.tab);
  if (state.rdm && state.rdm.ui === ui && !ui?.destroying) {
    return ui;
  }
  if (state.rdm) {
    throw new Error(
      "The responsive UI changed during this debug session; reset the environment first"
    );
  }
  const context = contextFor(session);
  const native = new Map(
    Object.values(PROPERTIES).map(property => [property, context[property]])
  );
  const preferences = savedPreferences();
  const wasActive = !!ui;
  const storage = lazy.require("resource://devtools/shared/async-storage.js");
  const deviceState = await storage.getItem(DEVICE_STATE);
  // Preserve values changed implicitly by opening/closing native RDM as well.
  for (const property of native.keys()) {
    capture(state, context, property);
  }
  ui = await manager.openIfNeeded(responsiveWindow(session), session.tab, {
    trigger: "toolbox",
  });
  await ui.initialized;
  const { viewports, ui: controls } = ui.toolWindow.store.getState();
  const configuration = ui.commands.targetConfigurationCommand;
  await configuration.getFront();
  state.rdm = {
    ui,
    wasActive,
    native,
    preferences,
    viewport: { ...viewports[0] },
    controls: { ...controls },
    configuration: { ...configuration.configuration },
    deviceState,
  };
  await awaitSavedDevice(ui, deviceState, session.signal);
  // A user-owned RDM must return to the completed original state, rather than
  // an intermediate point in its asynchronous saved-profile restoration.
  if (wasActive) {
    const restored = ui.toolWindow.store.getState();
    state.rdm.viewport = { ...restored.viewports[0] };
    state.rdm.controls = { ...restored.ui };
    state.rdm.configuration = { ...configuration.configuration };
  }
  if (wasActive && !state.orientationBaseline) {
    state.orientationBaseline = state.rdm.configuration.rdmPaneOrientation;
  }
  return ui;
}

function updateResponsiveControls(ui, values) {
  const viewports = lazy.require(
    "resource://devtools/client/responsive/actions/viewports.js"
  );
  const controls = lazy.require(
    "resource://devtools/client/responsive/actions/ui.js"
  );
  const viewport = ui.toolWindow.store.getState().viewports[0];
  if ("devicePixelRatio" in values) {
    ui.toolWindow.dispatch(
      viewports.changePixelRatio(viewport.id, values.devicePixelRatio)
    );
  }
  if ("userAgent" in values) {
    ui.toolWindow.dispatch(controls.changeUserAgent(values.userAgent));
  }
  if ("touch" in values) {
    ui.toolWindow.dispatch(
      controls.toggleTouchSimulation(values.touch === "enabled")
    );
  }
  if (values.orientation) {
    ui.toolWindow.dispatch(
      viewports.changeViewportAngle(viewport.id, values.orientation.angle)
    );
  }
}

async function setEnvironment(session, args) {
  // Validate the whole request before any native state is changed.
  const values = Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, normalize(key, value)])
  );
  const state = stateFor(session);
  let ui = activeUI(session);
  if (session.platform === "linux" && "touch" in values) {
    ui = await ensureResponsive(session, state);
  } else if (
    ui &&
    Object.keys(values).some(key =>
      ["devicePixelRatio", "userAgent", "orientation"].includes(key)
    )
  ) {
    ui = await ensureResponsive(session, state);
  }
  const context = contextFor(session);
  const javascriptChanged =
    "javascriptEnabled" in values &&
    context.allowJavascript !== values.javascriptEnabled;
  for (const [key, value] of Object.entries(values)) {
    if (key === "geolocation") {
      await session.bidi("emulation", "setGeolocationOverride", {
        contexts: [session.contextId],
        coordinates: value,
      });
    } else if (
      ui &&
      ["devicePixelRatio", "userAgent", "touch", "orientation"].includes(key)
    ) {
      const property = PROPERTIES[key];
      if (property) {
        capture(state, context, property);
      }
      if (key === "devicePixelRatio") {
        await ui.updateDPPX(value);
      } else if (key === "userAgent") {
        await ui.updateUserAgent(value);
      } else if (key === "touch") {
        await ui.updateMaxTouchPointsEnabled(value === "enabled");
        await ui.updateTouchSimulation(value === "enabled", false);
        // Native RDM maps disabled to the default; retain explicit false too.
        context.touchEventsOverride = value;
      } else if (value === null) {
        context.resetOrientationOverride();
      } else {
        await ui.updateScreenOrientation(value.type, value.angle);
      }
    } else {
      applyNative(state, context, key, value);
    }
    state.values.set(key, value);
  }
  if (ui) {
    updateResponsiveControls(ui, values);
  }
  if (javascriptChanged) {
    context.reload(Ci.nsIWebNavigation.LOAD_FLAGS_NONE);
  }
  return getEnvironment(session);
}

async function getEnvironment(session) {
  const context = contextFor(session);
  const state = sessions.get(session);
  const overrides = Object.fromEntries(
    Object.entries(PROPERTIES).map(([key, property]) => [
      key,
      context[property],
    ])
  );
  overrides.cacheDisabled = !!(
    context.defaultLoadFlags & Ci.nsIRequest.LOAD_BYPASS_CACHE
  );
  for (const key of ["orientation", "screen", "geolocation"]) {
    overrides[key] = state?.values.get(key) ?? null;
  }
  const observed = await session.query("debug_environment", {
    operation: "observe",
  });
  return {
    platform: session.platform,
    fields: FIELDS,
    overrides,
    observed,
    sessionOnlyOverrideFields: ["orientation", "screen", "geolocation"],
    responsive: !!activeUI(session),
    deviceProfile: state?.rdm?.profile ?? null,
    touchMode:
      session.platform === "linux"
        ? "native-rdm-simulation"
        : "native-event-exposure",
    reset:
      "Restores saved scalar settings and prior RDM state; screen, orientation and geolocation overrides are cleared because native APIs expose no prior-override getter.",
  };
}

async function getViewport(session) {
  responsiveManager(session);
  const ui = activeUI(session);
  const observed = await session.query("debug_environment", {
    operation: "observe",
  });
  return {
    responsive: !!ui,
    viewport: ui
      ? ui.getViewportSize()
      : { width: observed.width, height: observed.height },
    observed,
  };
}

async function resetViewport(session) {
  const state = sessions.get(session);
  const saved = state?.rdm;
  if (!saved) {
    return;
  }
  const manager = responsiveManager(session);
  const ui = manager.getResponsiveUIForTab(session.tab);
  const current = contextFor(session);
  const native = new Map(
    Object.values(PROPERTIES).map(property => [property, current[property]])
  );
  // RDM owns these settings. Preserve independent environment changes made
  // while the responsive UI was open, including flags its actor clears on exit.
  for (const property of [
    "overrideDPPX",
    "customUserAgent",
    "touchEventsOverride",
  ]) {
    native.set(property, saved.native.get(property));
  }
  if (ui === saved.ui && !ui.destroying) {
    if (!saved.wasActive) {
      await manager.closeIfNeeded(responsiveWindow(session), session.tab, {
        trigger: "toolbox",
      });
    } else {
      await ui.setViewportSize(saved.viewport);
      const restore = { ...saved.configuration };
      for (const [key, value] of Object.entries({
        overrideDPPX: saved.native.get("overrideDPPX"),
        customUserAgent: saved.native.get("customUserAgent"),
        touchEventsOverride: saved.native.get("touchEventsOverride"),
        rdmPaneMaxTouchPoints: saved.controls.touchSimulationEnabled ? 1 : 0,
      })) {
        if (!(key in restore)) {
          restore[key] = value;
        }
      }
      await ui.commands.targetConfigurationCommand.updateConfiguration(restore);
      const actions = lazy.require(
        "resource://devtools/client/responsive/actions/viewports.js"
      );
      await ui.toolWindow.dispatch(
        actions.changeDevice(
          saved.viewport.id,
          saved.viewport.device,
          saved.viewport.deviceType
        )
      );
      updateResponsiveControls(ui, {
        devicePixelRatio: saved.viewport.pixelRatio,
        userAgent: saved.controls.userAgent,
        touch: saved.controls.touchSimulationEnabled ? "enabled" : "none",
        orientation: { angle: saved.viewport.angle },
      });
    }
  }
  const context = contextFor(session);
  for (const [property, value] of native) {
    context[property] = value;
  }
  const storage = lazy.require("resource://devtools/shared/async-storage.js");
  if (saved.deviceState == null) {
    await storage.removeItem(DEVICE_STATE);
  } else {
    await storage.setItem(DEVICE_STATE, saved.deviceState);
  }
  restorePreferences(saved.preferences);
  state.rdm = null;
  for (const key of ["devicePixelRatio", "userAgent", "touch", "orientation"]) {
    state.values.delete(key);
  }
}

/** Restore the native environment when a debug session detaches. */
export async function resetEnvironment(session) {
  const state = sessions.get(session);
  if (!state) {
    return;
  }
  if (state.observer) {
    Services.obs.removeObserver(state.observer, "browsing-context-attached");
    state.observer = null;
  }
  // Remove replay state before native RDM teardown can navigate the tab.
  const values = (state.resetValues ||= state.values);
  state.values = new Map();
  const errors = [];
  try {
    await resetViewport(session);
  } catch (error) {
    errors.push(error);
  }
  if (values.has("geolocation")) {
    try {
      await session.bidi("emulation", "setGeolocationOverride", {
        contexts: [session.contextId],
        coordinates: null,
      });
    } catch (error) {
      errors.push(error);
    }
  }
  for (const [context, originals] of state.originals) {
    if (context.isDiscarded) {
      continue;
    }
    try {
      const javascriptChanged =
        originals.has("allowJavascript") &&
        context.allowJavascript !== originals.get("allowJavascript");
      for (const [property, value] of originals) {
        context[property] = value;
      }
      if (values.has("screen")) {
        context.resetScreenAreaOverride();
      }
      if (values.has("orientation")) {
        if (state.orientationBaseline) {
          const { type, angle } = state.orientationBaseline;
          context.setOrientationOverride(type, angle);
        } else {
          context.resetOrientationOverride();
        }
      }
      if (javascriptChanged) {
        context.reload(Ci.nsIWebNavigation.LOAD_FLAGS_NONE);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      "Could not fully restore the native debug environment"
    );
  }
  sessions.delete(session);
}

export function environmentMethods(platform) {
  const common = ["get_environment", "set_environment", "reset_environment"];
  return platform === "linux"
    ? [
        ...common,
        "get_viewport",
        "set_viewport",
        "reset_viewport",
        "list_device_profiles",
        "set_device_profile",
      ]
    : common;
}

/** All arguments are session/tab scoped; no global prefs emulate web APIs. */
export async function executeEnvironment(session, method, args = {}) {
  if (!environmentMethods(session.platform).includes(method)) {
    throw new Error(
      `Environment method ${method} is unavailable on ${session.platform}`
    );
  }
  switch (method) {
    case "get_environment":
      return getEnvironment(session);
    case "set_environment":
      return setEnvironment(session, args);
    case "reset_environment":
      await resetEnvironment(session);
      return getEnvironment(session);
    case "get_viewport":
      return getViewport(session);
    case "set_viewport": {
      const size = {
        width: number(args.width, "width", 50, Number.MAX_SAFE_INTEGER, true),
        height: number(
          args.height,
          "height",
          50,
          Number.MAX_SAFE_INTEGER,
          true
        ),
      };
      const ui = await ensureResponsive(session, stateFor(session));
      await ui.setViewportSize(size);
      ui.toolWindow.clearDeviceAssociation();
      sessions.get(session).rdm.profile = null;
      return getViewport(session);
    }
    case "reset_viewport":
      await resetViewport(session);
      return getViewport(session);
    case "list_device_profiles": {
      const { getDevices } = lazy.require(
        "resource://devtools/client/shared/devices.js"
      );
      const devices = await getDevices();
      return {
        profiles: [...devices].flatMap(([type, list]) =>
          list.map(device => ({ ...device, type }))
        ),
      };
    }
    case "set_device_profile": {
      if (typeof args.name !== "string" || !args.name) {
        throw new Error("A native device profile name is required");
      }
      const { getDevices } = lazy.require(
        "resource://devtools/client/shared/devices.js"
      );
      const devices = await getDevices();
      const matches = [...devices].flatMap(([type, list]) =>
        list
          .filter(
            device =>
              device.name === args.name && (!args.type || args.type === type)
          )
          .map(device => ({ device, type }))
      );
      if (matches.length !== 1) {
        throw new Error(
          matches.length
            ? "Device name is ambiguous; provide type"
            : "Native device profile was not found"
        );
      }
      const { device, type } = matches[0];
      const state = stateFor(session);
      const ui = await ensureResponsive(session, state);
      await ui.setViewportSize(device);
      await ui.onChangeDevice({ data: { device, viewport: device } });
      const actions = lazy.require(
        "resource://devtools/client/responsive/actions/viewports.js"
      );
      const viewport = ui.toolWindow.store.getState().viewports[0];
      await ui.toolWindow.dispatch(
        actions.changeDevice(viewport.id, device.name, type)
      );
      updateResponsiveControls(ui, {
        devicePixelRatio: device.pixelRatio,
        userAgent: device.userAgent,
        touch: device.touch ? "enabled" : "none",
        orientation: { angle: 0 },
      });
      state.rdm.profile = { name: device.name, type };
      return getEnvironment(session);
    }
  }
  throw new Error(`Unknown environment method: ${method}`);
}
