// SPDX-License-Identifier: AGPL-3.0-only

// This adapter only uses the tab's existing native DevTools commands. In
// particular, it does not implement a transport, toolbox, or debugger engine.
// GeckoView packages the DevTools server, but not the client/fronts required
// by CommandsFactory. Do not advertise these methods on Android.
const METHODS = Object.freeze([
  "debugger",
  "resources",
  "network",
  "css",
  "accessibility",
  "trace",
  "memory",
]);
const RESOURCE_TYPES = new Set([
  "console-message",
  "error-message",
  "document-event",
  "network-event",
  "network-event-stacktrace",
  "websocket",
  "server-sent-event",
  "reflow",
  "css-change",
  "source",
  "thread-state",
  "jstracer-trace",
  "jstracer-state",
]);
const THREAD_OPTIONS = new Set([
  "pauseOnExceptions",
  "ignoreCaughtExceptions",
  "shouldPauseOnDebuggerStatement",
  "skipBreakpoints",
  "shouldIncludeAsyncLiveFrames",
  "shouldIncludeSavedFrames",
]);
const states = new WeakMap();

export function diagnosticsMethods(platform) {
  return platform === "linux" ? [...METHODS] : [];
}

function nativeModule(path) {
  const { require } = ChromeUtils.importESModule(
    "resource://devtools/shared/loader/Loader.sys.mjs"
  );
  return require(`resource://devtools/${path}`);
}

function text(value, name) {
  if (typeof value !== "string" || !value.length) {
    throw new Error(`${name} must be a nonempty string`);
  }
  return value;
}

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

function boolean(value, name) {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function checkSignal(session) {
  if (session.signal?.aborted) {
    throw new Error("Browser debugging operation was aborted");
  }
}

function targetInfo(target) {
  return {
    targetId: target.actorID,
    type: target.targetType,
    url: target.url,
    browsingContextId: target.browsingContextID,
    isTopLevel: target.isTopLevel,
  };
}

// Fronts are live protocol objects, not JSON. Return their native forms/grips
// without traversing connections, pools, or references to other tabs.
function protocolValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    return typeof value === "function" ? undefined : value;
  }
  if (seen.has(value)) {
    return value.actorID ? { actor: value.actorID } : null;
  }
  seen.add(value);
  try {
    if (value.actorID && typeof value.getParent === "function") {
      if (typeof value.getGrip === "function") {
        return protocolValue(value.getGrip(), seen);
      }
      if (value.typeName === "frame") {
        return protocolValue({ ...value.data, actor: value.actorID }, seen);
      }
      if (value.typeName === "domstylerule") {
        return protocolValue(
          {
            actor: value.actorID,
            type: value.type,
            href: value.href,
            line: value.line,
            column: value.column,
            cssText: value.cssText,
            authoredText: value.authoredText,
            declarations: value.declarations,
            selectors: value.selectors,
            selectorsSpecificity: value.selectorsSpecificity,
            ancestorData: value.ancestorData,
          },
          seen
        );
      }
      if (value.typeName === "accessible") {
        return protocolValue(
          {
            actor: value.actorID,
            role: value.role,
            name: value.name,
            value: value.value,
            description: value.description,
            states: value.states,
            attributes: value.attributes,
            checks: value.checks,
          },
          seen
        );
      }
      return { actor: value.actorID, type: value.typeName };
    }
    if (Array.isArray(value)) {
      return value.map(item => protocolValue(item, seen));
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "targetFront") {
        result.target = entry ? targetInfo(entry) : null;
      } else {
        result[key] = protocolValue(entry, seen);
      }
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

async function stateFor(session) {
  let state = states.get(session);
  if (!state) {
    state = {
      commands: await session.commands(),
      watches: new Map(),
      memory: new Map(),
      traces: new Map(),
      overrides: new Set(),
      threadListeners: new Map(),
      resumingThreads: new Map(),
      resumeErrors: [],
      ending: session.closed,
      active: true,
    };
    states.set(session, state);
    session.addCleanup(() => resetDiagnostics(session));
  }
  checkSignal(session);
  return state;
}

function targets(state) {
  const command = state.commands.targetCommand;
  return command.getAllTargets(command.ALL_TYPES);
}

function targetFor(state, args) {
  const target = args.targetId
    ? targets(state).find(item => item.actorID === args.targetId)
    : state.commands.targetCommand.targetFront;
  if (!target || target.isDestroyed()) {
    throw new Error(
      "Target is no longer available in this tab; list targets again"
    );
  }
  return target;
}

async function resumeOwnedThread(state, thread) {
  if (!thread || thread.isDestroyed() || !thread.paused) return;
  if (state.resumingThreads.has(thread))
    return state.resumingThreads.get(thread);
  const operation = thread.request({ type: "resume", resumeLimit: null });
  state.resumingThreads.set(thread, operation);
  try {
    await operation;
  } finally {
    state.resumingThreads.delete(thread);
  }
}

export async function prepareDiagnosticsForReset(session) {
  const state = states.get(session);
  if (!state) return;
  state.ending = true;
  // Pending native input/replay operations may be waiting on paused page JS.
  // Stop new breakpoint pauses, then release existing owned pauses before the
  // root waits for those operations. Keep watchers alive for late pause events.
  await state.commands.threadConfigurationCommand.updateConfiguration({
    skipBreakpoints: true,
  });
  for (const target of targets(state)) {
    await resumeOwnedThread(state, target.threadFront);
  }
}

async function watch(session, state, types, owner) {
  const key = `${owner}:${types.join(",")}`;
  if (state.watches.has(key)) {
    return;
  }
  const emitResources = async (kind, resources) => {
    for (const item of resources) {
      const resource = item.resource || item;
      if (
        state.ending &&
        resource.resourceType === "thread-state" &&
        resource.state === "paused"
      ) {
        try {
          await resumeOwnedThread(state, resource.targetFront?.threadFront);
        } catch (error) {
          state.resumeErrors.push(String(error));
        }
      }
      let data = protocolValue(item);
      // The native WebSocket and SSE watchers use long-string actors even for
      // short messages. Resolve them through the client while actors are live.
      if (
        ["websocket", "server-sent-event"].includes(resource.resourceType) &&
        resource.data?.payload
      ) {
        try {
          const { getLongStringFullText } = nativeModule(
            "client/shared/string-utils.js"
          );
          data = {
            ...data,
            data: {
              ...data.data,
              payload: await getLongStringFullText(
                state.commands.client,
                resource.data.payload
              ),
            },
          };
        } catch (error) {
          data.payloadError = String(error);
        }
      }
      if (state.active) {
        session.emit(`resource.${kind}`, {
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          target: resource.targetFront
            ? targetInfo(resource.targetFront)
            : null,
          resource: data,
        });
      }
    }
  };
  const options = {
    onAvailable: resources => emitResources("available", resources),
    onUpdated: resources => emitResources("updated", resources),
    onDestroyed: resources => emitResources("destroyed", resources),
  };
  state.watches.set(key, { types, options, owner });
  try {
    await state.commands.resourceCommand.watchResources(types, options);
  } catch (error) {
    state.commands.resourceCommand.unwatchResources(types, options);
    state.watches.delete(key);
    throw error;
  }
}

async function resources(session, state, args) {
  const types = args.types;
  if (
    !Array.isArray(types) ||
    !types.length ||
    types.some(type => !RESOURCE_TYPES.has(type))
  ) {
    throw new Error(
      `types must contain supported resources: ${[...RESOURCE_TYPES].join(", ")}`
    );
  }
  const selected = [...new Set(types)].sort();
  if (args.action === "watch") {
    for (const type of selected) {
      await watch(session, state, [type], "resources");
    }
  } else if (args.action === "unwatch") {
    for (const [key, registration] of state.watches) {
      if (registration.owner !== "resources") {
        continue;
      }
      const removed = registration.types.filter(type =>
        selected.includes(type)
      );
      if (!removed.length) {
        continue;
      }
      state.commands.resourceCommand.unwatchResources(
        removed,
        registration.options
      );
      registration.types = registration.types.filter(
        type => !selected.includes(type)
      );
      state.watches.delete(key);
      if (registration.types.length) {
        state.watches.set(
          `resources:${registration.types.join(",")}`,
          registration
        );
      }
    }
  } else {
    throw new Error("resources action must be watch or unwatch");
  }
  return { action: args.action, types: selected };
}

function watchInterruptState(session, state, target, thread) {
  if (state.threadListeners.has(thread)) {
    return;
  }
  let interrupted = false;
  const emit = (status, packet = {}) => {
    if (!state.active) {
      return;
    }
    const resource = protocolValue({
      resourceType: "thread-state",
      state: status,
      ...packet,
      targetFront: target,
    });
    session.emit("resource.available", {
      resourceType: "thread-state",
      target: targetInfo(target),
      resource,
    });
  };
  const onPaused = packet => {
    if (state.ending) {
      void resumeOwnedThread(state, thread).catch(error => {
        state.resumeErrors.push(String(error));
      });
      return;
    }
    // The native THREAD_STATE resource watcher deliberately suppresses immediate
    // interrupts and their matching resumes. Forward those native ThreadFront
    // packets so explicit pause has the same observable lifecycle as breakpoints.
    if (packet.why?.type === "interrupted" && !packet.why.onNext) {
      interrupted = true;
      emit("paused", packet);
    }
  };
  const onResumed = () => {
    if (interrupted) {
      interrupted = false;
      emit("resumed");
    }
  };
  thread.on("paused", onPaused);
  thread.on("resumed", onResumed);
  state.threadListeners.set(thread, { onPaused, onResumed });
}

async function pauseThread(session, target, thread) {
  if (thread.paused) {
    return;
  }
  // interrupt's acknowledgement is sent before the paused packet. Wait for the
  // packet too, so the returned state/frame is already usable by frames/scopes.
  let onPaused;
  let onDestroyed;
  let onAbort;
  const paused = new Promise((resolve, reject) => {
    onPaused = resolve;
    onDestroyed = () =>
      reject(new Error("Debugger target was destroyed while pausing"));
    onAbort = () => reject(new Error("Debugger pause was aborted"));
    thread.on("paused", onPaused);
    target.on("target-destroyed", onDestroyed);
    session.signal?.addEventListener("abort", onAbort, { once: true });
    if (session.signal?.aborted) {
      onAbort();
    }
  });
  try {
    await Promise.all([paused, thread.interrupt()]);
  } finally {
    thread.off("paused", onPaused);
    target.off("target-destroyed", onDestroyed);
    session.signal?.removeEventListener("abort", onAbort);
  }
}

async function debuggerCommand(session, state, args) {
  const { commands } = state;
  await watch(session, state, ["thread-state"], "debugger");
  if (args.action === "targets") {
    return { targets: targets(state).map(targetInfo) };
  }
  const target = targetFor(state, args);
  const thread = await target.getFront("thread");
  watchInterruptState(session, state, target, thread);
  const requirePaused = () => {
    if (!thread.paused) {
      throw new Error(
        "The selected thread is not paused; pause it and read its thread-state event first"
      );
    }
  };
  const frameFor = () => {
    requirePaused();
    const frame = thread.getActorByID(text(args.frameId, "frameId"));
    if (!frame || frame.typeName !== "frame") {
      throw new Error(
        "Frame is stale or belongs to another thread; request frames again"
      );
    }
    return frame;
  };
  switch (args.action) {
    case "sources":
      return { target: targetInfo(target), sources: await thread.sources() };
    case "source":
    case "positions": {
      const sourceId = text(args.sourceId, "sourceId");
      const source = (await thread.sources()).find(
        item => item.actor === sourceId
      );
      if (!source) {
        throw new Error(
          "Source is stale or belongs to another target; request sources again"
        );
      }
      const front = thread.source(source);
      return args.action === "source"
        ? front.source()
        : {
            lines: await front.getBreakableLines(),
            positions: await front.getBreakpointPositionsCompressed(
              args.range || null
            ),
          };
    }
    case "breakpoint":
    case "remove_breakpoint": {
      const location = {
        sourceUrl: text(args.sourceUrl, "sourceUrl"),
        line: integer(args.line, "line", 1),
      };
      if (args.column !== undefined) {
        location.column = integer(args.column, "column");
      }
      const options = {};
      if (args.condition !== undefined) {
        options.condition = text(args.condition, "condition");
      }
      const method =
        args.action === "breakpoint" ? "setBreakpoint" : "removeBreakpoint";
      const front = await commands.watcherFront.getBreakpointListActor();
      await front[method](location, options);
      // Dedicated workers still use the native legacy target watcher.
      for (const worker of targets(state)) {
        if (
          !commands.targetCommand.hasTargetWatcherSupport(worker.targetType)
        ) {
          const workerThread = await worker.getFront("thread");
          await workerThread[method](location, options);
        }
      }
      return { action: args.action, location, options };
    }
    case "configure": {
      const options = args.options;
      if (
        !options ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        Object.keys(options).some(key => !THREAD_OPTIONS.has(key))
      ) {
        throw new Error(
          `options must contain native thread settings: ${[...THREAD_OPTIONS].join(", ")}`
        );
      }
      for (const [key, value] of Object.entries(options)) {
        boolean(value, key);
      }
      await commands.threadConfigurationCommand.updateConfiguration(options);
      return { options };
    }
    case "pause":
      await pauseThread(session, target, thread);
      break;
    case "resume":
      requirePaused();
      // The convenience ThreadFront.resume wrapper swallows server errors.
      // Queue the native packet on its managed Front: DevToolsClient.request
      // cannot receive responses that are routed to an existing Front.
      // Front.request preserves native protocol errors without _doResume's
      // swallowed rejection; native events still update the thread state.
      await thread.request({
        type: "resume",
        resumeLimit: null,
      });
      break;
    case "step": {
      requirePaused();
      const type = { in: "step", over: "next", out: "finish" }[args.mode];
      if (!type) {
        throw new Error("step mode must be in, over or out");
      }
      const frame = args.frameId ? frameFor() : null;
      await thread.request({
        type: "resume",
        resumeLimit: { type },
        frameActorID: frame?.actorID,
      });
      break;
    }
    case "frames":
      requirePaused();
      return thread.getFrames(
        integer(args.start ?? 0, "start"),
        integer(args.count ?? 20, "count", 1)
      );
    case "scopes":
      return frameFor().getEnvironment();
    case "evaluate": {
      const frame = frameFor();
      return commands.scriptCommand.execute(
        text(args.expression, "expression"),
        {
          frameActor: frame.actorID,
          selectedTargetFront: target,
          disableBreaks: true,
        }
      );
    }
    default:
      throw new Error(`Unknown debugger action: ${args.action}`);
  }
  return {
    requested: args.action,
    target: targetInfo(target),
    state: thread.state,
    ...(args.action === "pause" ? { pause: thread.getLastPausePacket() } : {}),
  };
}

async function networkFront(session, state) {
  await watch(session, state, ["network-event"], "network");
  const front = await state.commands.watcherFront.getNetworkParentActor();
  if (!state.network) {
    state.network = front;
    state.initialThrottle = await front.getNetworkThrottling();
    state.initialBlocked = await front.getBlockedUrls();
    await front.setSaveRequestAndResponseBodies(true);
  }
  return front;
}

function networkItems(state) {
  return state.commands.resourceCommand.getAllResources("network-event");
}

function networkProvider(state) {
  if (!state.provider) {
    const FirefoxDataProvider = nativeModule(
      "client/netmonitor/src/connector/firefox-data-provider.js"
    );
    state.provider = new FirefoxDataProvider({ commands: state.commands });
  }
  return state.provider;
}

async function network(session, state, args) {
  const front = await networkFront(session, state);
  switch (args.action) {
    case "throttle": {
      if (args.options !== null) {
        for (const key of [
          "latency",
          "downloadThroughput",
          "uploadThroughput",
        ]) {
          if (!Number.isFinite(args.options?.[key]) || args.options[key] < 0) {
            throw new Error(
              `${key} must be a nonnegative number (latency in ms; throughput in bytes/s)`
            );
          }
        }
      }
      await front.setNetworkThrottling(args.options);
      return { options: await front.getNetworkThrottling() };
    }
    case "block":
      await front.blockRequest({ url: text(args.url, "url") });
      return { urls: await front.getBlockedUrls() };
    case "unblock":
      await front.unblockRequest({ url: text(args.url, "url") });
      return { urls: await front.getBlockedUrls() };
    case "blocked":
      return { urls: await front.getBlockedUrls() };
    case "override": {
      text(args.url, "url");
      const path = await session.resolvePath(text(args.path, "path"));
      await front.override(args.url, path);
      state.overrides.add(args.url);
      return { url: args.url, path };
    }
    case "remove_override":
      await front.removeOverride(text(args.url, "url"));
      state.overrides.delete(args.url);
      return { url: args.url };
    case "replay": {
      const item = networkItems(state).find(
        resource => String(resource.resourceId) === String(args.requestId)
      );
      if (!item) {
        throw new Error(
          "Request is no longer captured in this tab; watch network-event resources before reproducing it"
        );
      }
      if (!/^https?:\/\//i.test(item.url)) {
        throw new Error(
          "Only captured HTTP and HTTPS requests can be replayed"
        );
      }
      const provider = networkProvider(state);
      let headers = args.headers;
      if (headers === undefined) {
        ({ headers } = await provider.requestData(
          item.actor,
          "requestHeaders"
        ));
      }
      if (
        !Array.isArray(headers) ||
        headers.some(
          header =>
            typeof header?.name !== "string" ||
            typeof header?.value !== "string" ||
            /[\r\n]/.test(header.name + header.value)
        )
      ) {
        throw new Error(
          "headers must be an array of {name, value} strings without newlines"
        );
      }
      let body = args.body;
      if (body === undefined && item.requestPostDataAvailable) {
        const data = await provider.requestData(item.actor, "requestPostData");
        body = data?.postData?.text;
      }
      if (body !== undefined && typeof body !== "string") {
        throw new Error("body must be a string");
      }
      const method =
        args.method === undefined ? item.method : text(args.method, "method");
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method) ||
        method.toUpperCase() === "CONNECT"
      ) {
        throw new Error("Invalid or unsupported HTTP method");
      }
      const result = await state.commands.networkCommand.sendHTTPRequest({
        url: item.url,
        method,
        headers,
        body,
        cause: { type: item.cause?.type || "xhr" },
      });
      return { ...result, replayedRequestId: item.resourceId };
    }
    case "har": {
      const { HarExporter } = nativeModule(
        "client/netmonitor/src/har/har-exporter.js"
      );
      const provider = networkProvider(state);
      const items = networkItems(state).map(item => ({
        ...item,
        id: item.actor,
      }));
      const connector = {
        currentTarget: state.commands.targetCommand.targetFront,
        enableActions: enabled => provider.enableActions(enabled),
        requestData: (actor, method) => provider.requestData(actor, method),
        getLongString: grip => provider.getLongString(grip),
      };
      try {
        const har = await HarExporter.buildHarData({
          connector,
          items,
          id: String(session.tabId),
          includeResponseBodies:
            args.includeResponseBodies === undefined
              ? false
              : boolean(args.includeResponseBodies, "includeResponseBodies"),
          supportsMultiplePages: false,
        });
        return {
          har,
          capturedRequests: items.length,
          exportedRequests: har.log.entries.length,
          omittedRequests: items.length - har.log.entries.length,
        };
      } finally {
        provider.enableActions(true);
      }
    }
    default:
      throw new Error(`Unknown network action: ${args.action}`);
  }
}

async function inspectorNode(state, args) {
  const target = targetFor(state, args);
  const inspector = await target.getFront("inspector");
  const root = await inspector.walker.getRootNode();
  const node = await inspector.walker.querySelector(
    root,
    text(args.selector, "selector")
  );
  if (!node) {
    throw new Error("No element matches selector in the selected target");
  }
  return { target, inspector, node };
}

async function css(state, args) {
  if (
    args.properties !== undefined &&
    (!Array.isArray(args.properties) ||
      args.properties.some(property => typeof property !== "string"))
  ) {
    throw new Error("properties must be an array of CSS property names");
  }
  const { target, inspector, node } = await inspectorNode(state, args);
  const options = { inherited: true, matchedSelectors: true };
  const rules = await inspector.pageStyle.getApplied(node, options);
  const computed = await inspector.pageStyle.getComputed(node, {
    markMatched: true,
    filterProperties: args.properties || null,
  });
  return {
    target: targetInfo(target),
    selector: args.selector,
    rules,
    computed,
  };
}

async function accessibilityFront(session, target) {
  const front = await target.getFront("accessibility");
  if (!front.enabled) {
    // Service activation reaches content asynchronously. Waiting for the native
    // actor avoids missing the document's initial accessibility events.
    const { signal } = session;
    await new Promise((resolve, reject) => {
      const finish = error => {
        front.off("init", onReady);
        target.off("target-destroyed", onDestroyed);
        signal?.removeEventListener("abort", onAbort);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onReady = () => finish();
      const onDestroyed = () =>
        finish(new Error("Accessibility target was destroyed"));
      const onAbort = () =>
        finish(new Error("Accessibility initialization was aborted"));
      front.on("init", onReady);
      target.on("target-destroyed", onDestroyed);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
      } else if (front.enabled) {
        onReady();
      }
    });
  }
  return front;
}

async function accessibility(session, state, args) {
  const types = args.types || ["CONTRAST", "KEYBOARD", "TEXT_LABEL"];
  if (
    !Array.isArray(types) ||
    !types.length ||
    types.some(type => !["CONTRAST", "KEYBOARD", "TEXT_LABEL"].includes(type))
  ) {
    throw new Error("types must contain CONTRAST, KEYBOARD or TEXT_LABEL");
  }
  if (Services.prefs.getIntPref("accessibility.force_disabled", 0) >= 1) {
    throw new Error(
      "Native accessibility is disabled by the browser preference"
    );
  }
  // Retain only our XPCOM service reference. ParentAccessibilityActor.disable
  // toggles a browser-wide preference, so it is inappropriate for tab cleanup.
  state.accessibilityService ||= Cc[
    "@mozilla.org/accessibilityService;1"
  ].getService(Ci.nsIAccessibilityService);
  if (args.selector) {
    const { target, node } = await inspectorNode(state, args);
    const front = await accessibilityFront(session, target);
    const accessible = await front.accessibleWalkerFront.getAccessibleFor(node);
    if (!accessible) {
      throw new Error("The selected element has no native accessible object");
    }
    return {
      target: targetInfo(target),
      accessible,
      audit: await accessible.audit({ types }),
    };
  }
  const selected = args.targetId
    ? [targetFor(state, args)]
    : targets(state).filter(target => target.targetType === "frame");
  const reports = [];
  for (const target of selected) {
    checkSignal(session);
    const front = await accessibilityFront(session, target);
    const report = await front.accessibleWalkerFront.audit({
      types,
      retrieveAncestries: false,
      onProgress: progress =>
        session.emit("accessibility.progress", {
          target: targetInfo(target),
          progress,
        }),
    });
    if (report.error) {
      throw new Error(
        `Native accessibility audit failed for target ${target.actorID}`
      );
    }
    reports.push({ target: targetInfo(target), ...report });
  }
  return { types, reports };
}

async function trace(session, state, args) {
  const target = targetFor(state, args);
  if (args.action === "start") {
    if (state.traces.has(target.actorID)) {
      throw new Error(
        "A trace is already active for this target; stop it first"
      );
    }
    if (target.targetType.endsWith("worker")) {
      // The pinned ResourceCommand skips tracer resources on worker targets.
      throw new Error(
        "Native trace resource delivery is unavailable for worker targets"
      );
    }
    if (target.targetType === "frame" && !target.isTopLevel) {
      const parent = await target.getParentTarget();
      if (parent && parent.processID === target.processID) {
        throw new Error(
          "Native tracing starts on the process-root frame; select its parent target"
        );
      }
    }
    await watch(session, state, ["jstracer-trace", "jstracer-state"], "trace");
    const front = await target.getFront("tracer");
    const mutations = args.traceDOMMutations ?? null;
    if (
      mutations !== null &&
      (!Array.isArray(mutations) ||
        mutations.some(type => !["add", "attributes", "remove"].includes(type)))
    ) {
      throw new Error(
        "traceDOMMutations must contain add, attributes or remove"
      );
    }
    await front.startTracing({
      logMethod: "debugger-sidebar",
      traceValues:
        args.traceValues === undefined
          ? false
          : boolean(args.traceValues, "traceValues"),
      traceOnNextInteraction:
        args.traceOnNextInteraction === undefined
          ? false
          : boolean(args.traceOnNextInteraction, "traceOnNextInteraction"),
      traceDOMMutations: mutations,
    });
    state.traces.set(target.actorID, front);
  } else if (args.action === "stop") {
    const front = state.traces.get(target.actorID);
    if (!front) {
      throw new Error("No trace was started for this target in this session");
    }
    await front.stopTracing();
    state.traces.delete(target.actorID);
  } else {
    throw new Error("trace action must be start or stop");
  }
  return {
    action: args.action,
    target: targetInfo(target),
    lifetime: "current target; restart after navigation",
  };
}

async function memory(state, args) {
  const target = targetFor(state, args);
  let entry = state.memory.get(target.actorID);
  if (!entry) {
    const front = await target.getFront("memory");
    await front.attach();
    entry = { front, recording: false };
    state.memory.set(target.actorID, entry);
  }
  const { front } = entry;
  switch (args.action) {
    case "census":
      return { target: targetInfo(target), census: await front.takeCensus() };
    case "allocations_start": {
      const options = {};
      if (args.probability !== undefined) {
        if (
          !Number.isFinite(args.probability) ||
          args.probability < 0 ||
          args.probability > 1
        ) {
          throw new Error("probability must be between 0 and 1");
        }
        options.probability = args.probability;
      }
      if (args.maxLogLength !== undefined) {
        options.maxLogLength = integer(args.maxLogLength, "maxLogLength", 1);
        if (options.maxLogLength > 0x7fffffff) {
          throw new Error("maxLogLength must fit a signed 32-bit integer");
        }
      }
      const started = await front.startRecordingAllocations(options);
      entry.recording = true;
      return {
        target: targetInfo(target),
        started,
        settings: await front.getAllocationsSettings(),
      };
    }
    case "allocations":
      if (!entry.recording) {
        throw new Error("Start allocation recording for this target first");
      }
      return {
        target: targetInfo(target),
        allocations: await front.getAllocations(),
      };
    case "allocations_stop": {
      if (!entry.recording) {
        throw new Error("No allocation recording is active for this target");
      }
      const allocations = await front.getAllocations();
      const stopped = await front.stopRecordingAllocations();
      entry.recording = false;
      return { target: targetInfo(target), stopped, allocations };
    }
    default:
      throw new Error(`Unknown memory action: ${args.action}`);
  }
}

export async function executeDiagnostics(session, method, args = {}) {
  if (!diagnosticsMethods(session.platform).includes(method)) {
    throw new Error(
      `Native diagnostics method is unavailable on ${session.platform}: ${method}`
    );
  }
  const state = await stateFor(session);
  let result;
  switch (method) {
    case "debugger":
      result = await debuggerCommand(session, state, args);
      break;
    case "resources":
      result = await resources(session, state, args);
      break;
    case "network":
      result = await network(session, state, args);
      break;
    case "css":
      result = await css(state, args);
      break;
    case "accessibility":
      result = await accessibility(session, state, args);
      break;
    case "trace":
      result = await trace(session, state, args);
      break;
    case "memory":
      result = await memory(state, args);
      break;
  }
  checkSignal(session);
  return protocolValue(result);
}

// The root session destroys Commands after this hook. Native Watcher teardown
// owns restoration of breakpoints and thread settings.
export async function resetDiagnostics(session) {
  const state = states.get(session);
  if (!state) {
    return;
  }
  states.delete(session);
  state.active = false;
  const failures = [];
  const cleanup = async operation => {
    try {
      await operation();
    } catch (error) {
      failures.push(String(error));
    }
  };
  for (const front of state.traces.values()) {
    if (!front.isDestroyed()) {
      await cleanup(() => front.stopTracing());
    }
  }
  for (const { front, recording } of state.memory.values()) {
    if (!front.isDestroyed()) {
      if (recording) {
        await cleanup(() => front.stopRecordingAllocations());
      }
      await cleanup(() => front.detach());
    }
  }
  if (state.network && !state.network.isDestroyed()) {
    for (const url of state.overrides) {
      await cleanup(() => state.network.removeOverride(url));
    }
    await cleanup(() => state.network.setBlockedUrls(state.initialBlocked));
    await cleanup(() =>
      state.network.setNetworkThrottling(state.initialThrottle)
    );
  }
  let remainingTargets = [];
  await cleanup(() => {
    remainingTargets = targets(state);
  });
  for (const target of remainingTargets) {
    if (target.threadFront?.paused) {
      await cleanup(() => resumeOwnedThread(state, target.threadFront));
    }
  }
  await Promise.allSettled([...state.resumingThreads.values()]);
  failures.push(...state.resumeErrors);
  for (const [thread, { onPaused, onResumed }] of state.threadListeners) {
    thread.off("paused", onPaused);
    thread.off("resumed", onResumed);
  }
  for (const { types, options } of state.watches.values()) {
    await cleanup(() =>
      state.commands.resourceCommand.unwatchResources(types, options)
    );
  }
  state.provider?.destroy();
  state.accessibilityService = null;
  if (failures.length) {
    throw new Error(`Native diagnostic cleanup: ${failures.join("; ")}`);
  }
}
