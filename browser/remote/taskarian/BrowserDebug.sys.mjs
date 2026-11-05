// SPDX-License-Identifier: AGPL-3.0-only

import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import {
  environmentMethods,
  executeEnvironment,
  resetEnvironment,
} from "chrome://remote/content/taskarian/BrowserDebugEnvironment.sys.mjs";
import {
  diagnosticsMethods,
  executeDiagnostics,
  prepareDiagnosticsForReset,
  resetDiagnostics,
} from "chrome://remote/content/taskarian/BrowserDebugDiagnostics.sys.mjs";

Cu.importGlobalProperties(["AbortController", "URL"]);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  RootMessageHandlerRegistry:
    "chrome://remote/content/shared/messagehandler/RootMessageHandlerRegistry.sys.mjs",
  NavigableManager: "chrome://remote/content/shared/NavigableManager.sys.mjs",
  UserContextManager:
    "chrome://remote/content/shared/UserContextManager.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  permissions: "chrome://remote/content/shared/Permissions.sys.mjs",
});

const COMMON = [
  "reset",
  "frames",
  "evaluate",
  "read",
  "wait",
  "input",
  "events",
  "subscribe",
  "unsubscribe",
  "cookies",
  "permissions",
  "network_intercept",
  "network_headers",
  "coverage",
];
const LEGACY = [
  "list_console_messages",
  "clear_console_messages",
  "enable_debugger",
  "list_scripts",
  "get_script_source",
  "set_logpoint",
  "remove_logpoint",
  "get_logpoint_results",
];
const DESKTOP = [
  "list_network_requests",
  "get_network_request",
  "downloads",
  "navigate",
  "devtools",
  "contexts",
];
const CHILD = {
  enable_debugger: "debuggerEnable",
  list_scripts: "debuggerListScripts",
  get_script_source: "debuggerGetScriptSource",
  set_logpoint: "debuggerSetLogpoint",
  remove_logpoint: "debuggerRemoveLogpoint",
  get_logpoint_results: "debuggerGetLogpointResults",
};
const EVENTS = [
  "network.beforeRequestSent",
  "network.responseStarted",
  "network.responseCompleted",
  "network.fetchError",
  "network.authRequired",
  "browsingContext.contextCreated",
  "browsingContext.contextDestroyed",
  "browsingContext.domContentLoaded",
  "browsingContext.load",
  "browsingContext.fragmentNavigated",
  "browsingContext.historyUpdated",
  "browsingContext.navigationStarted",
  "browsingContext.navigationCommitted",
  "browsingContext.navigationFailed",
];
const sessions = new Map();
const contexts = new Set();
const downloadIds = new WeakMap();
let nextDownload = 0;

function nativeModule(path) {
  const { require } = ChromeUtils.importESModule(
    "resource://devtools/shared/loader/Loader.sys.mjs"
  );
  return require(`resource://devtools/${path}`);
}
function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value;
}
function contextFor(session, frameId) {
  const context =
    frameId === undefined
      ? session.browser.browsingContext
      : BrowsingContext.get(Number(frameId));
  if (
    !context ||
    context.isDiscarded ||
    context.top !== session.browser.browsingContext.top
  )
    throw new Error("Frame is outside this tab");
  const global = context.currentWindowGlobal;
  const uri = global?.documentURI;
  if (
    !global ||
    global.documentPrincipal.isSystemPrincipal ||
    !(
      ["http", "https", "file", "blob", "data"].includes(uri?.scheme) ||
      uri?.spec === "about:blank"
    )
  )
    throw new Error("Only ordinary page frames can be debugged");
  return context;
}
function site(session) {
  const context = contextFor(session);
  const principal = context.currentWindowGlobal.documentPrincipal;
  if (!["http", "https"].includes(principal.URI?.scheme))
    throw new Error("This operation requires an HTTP or HTTPS site");
  return {
    host: principal.URI.host,
    origin: principal.originNoSuffix,
    context,
  };
}
function emit(session, type, data) {
  if (session.closed) return;
  const event = { cursor: ++session.cursor, type, data };
  session.events.push(event);
  // Diagnostic events are a bounded live buffer, rather than a background log.
  if (session.events.length > 1000) session.events.shift();
  for (const wake of session.waiters) wake();
}
function getSession(adapter) {
  const browser = adapter.browser;
  let session = sessions.get(browser);
  if (session) {
    session.adapter = adapter;
    session.signal = adapter.signal;
    return session;
  }
  session = {
    ...adapter,
    adapter,
    browsingContext: browser.browsingContext.top,
    contextId: lazy.NavigableManager.getIdForBrowsingContext(
      browser.browsingContext.top
    ),
    cursor: 0,
    events: [],
    waiters: new Set(),
    cleanups: [],
    pending: new Set(),
    pendingRequests: new Map(),
    teardownRequests: new Set(),
    teardownErrors: [],
    subscriptions: new Set(),
    intercepts: new Set(),
    inputContexts: new Set(),
    logpoints: new Map(),
    coverageFrames: new Set(),
    shutdown: new AbortController(),
    closed: false,
    ownsCommands: true,
    query(name, data = {}, frameId) {
      return this.adapter.query(name, data, frameId);
    },
    resolvePath(value) {
      return this.adapter.resolvePath(value);
    },
    addCleanup(fn) {
      this.cleanups.push(fn);
    },
    emit(type, data) {
      emit(this, type, data);
    },
    async commands() {
      this.commandsPromise ??= (async () => {
        const { CommandsFactory } = nativeModule(
          "shared/commands/commands-factory.js"
        );
        const commands = await CommandsFactory.forRemoteTab(
          this.browser.browserId
        );
        try {
          await commands.targetCommand.startListening();
          return commands;
        } catch (error) {
          await commands.destroy();
          throw error;
        }
      })();
      return this.commandsPromise;
    },
    async bidi(moduleName, commandName, params) {
      if (!this.handler) {
        this.handler =
          lazy.RootMessageHandlerRegistry.getOrCreateMessageHandler(
            Services.uuid.generateUUID().toString()
          );
        this.onProtocolEvent = (_name, event) => {
          if (
            event.name !== "browsingContext.contextDestroyed" &&
            event.data?.context &&
            event.data.context !== this.contextId
          ) {
            const context = lazy.NavigableManager.getBrowsingContextById(
              event.data.context
            );
            if (!context || context.top !== this.browser.browsingContext.top)
              return;
          }
          if (event.data?.isBlocked && event.data.request?.request) {
            const request = event.data.request.request;
            this.pendingRequests.set(request, event.name);
            if (this.closed) {
              const continuation = continueBlockedRequest(this, request);
              this.teardownRequests.add(continuation);
              continuation.then(
                () => this.teardownRequests.delete(continuation),
                error => {
                  this.teardownRequests.delete(continuation);
                  this.teardownErrors.push(error.message);
                }
              );
            }
          }
          this.emit(event.name, event.data);
        };
        this.handler.on("message-handler-protocol-event", this.onProtocolEvent);
      }
      const result = await this.handler.handleCommand({
        moduleName,
        commandName,
        params,
        destination: { type: "ROOT" },
      });
      return result === undefined ? {} : result;
    },
  };
  sessions.set(browser, session);
  return session;
}

async function readEvents(session, args) {
  const signal = session.signal;
  const action = args.action ?? "read";
  if (action === "clear") {
    session.events.length = 0;
    return { cursor: session.cursor };
  }
  if (!["read", "wait"].includes(action))
    throw new Error("Choose read, wait or clear");
  const cursor = args.cursor ?? 0;
  const limit = args.limit ?? 100;
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw new Error("cursor and limit must be positive integers");
  const select = () =>
    session.events.filter(event => event.cursor > cursor).slice(0, limit);
  if (action === "wait" && !select().length) {
    const timeout = args.timeout ?? 10000;
    if (!Number.isFinite(timeout) || timeout < 0)
      throw new Error("timeout must be nonnegative milliseconds");
    await new Promise((resolve, reject) => {
      let timer;
      const finish = error => {
        clearTimeout(timer);
        session.waiters.delete(wake);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      const wake = () => finish();
      const abort = () =>
        finish(signal.reason || new Error("Debugging cancelled"));
      session.waiters.add(wake);
      timer = setTimeout(wake, timeout);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  const events = select();
  return {
    events,
    cursor: events.at(-1)?.cursor ?? cursor,
    latestCursor: session.cursor,
    truncated: !!session.events.length && cursor < session.events[0].cursor - 1,
  };
}

async function cookies(session, args) {
  const { host, context } = site(session);
  const principal = context.currentWindowGlobal.documentStoragePrincipal;
  const originAttributes = principal.originAttributes;
  const filter = args.filter ?? {};
  if (args.filter?.domain && args.filter.domain.replace(/^\./, "") !== host)
    throw new Error("Cookies must belong to the current site's host");
  const sameSites = {
    none: Ci.nsICookie.SAMESITE_NONE,
    lax: Ci.nsICookie.SAMESITE_LAX,
    strict: Ci.nsICookie.SAMESITE_STRICT,
    default: Ci.nsICookie.SAMESITE_UNSET,
  };
  const all = Services.cookies
    .getCookiesFromHost(host, originAttributes)
    .filter(cookie => {
      const domain = cookie.host.replace(/^\./, "");
      return (
        (host === domain || host.endsWith(`.${domain}`)) &&
        (filter.name === undefined || filter.name === cookie.name) &&
        (filter.path === undefined || filter.path === cookie.path)
      );
    });
  const serialize = cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.host,
    path: cookie.path,
    secure: cookie.isSecure,
    httpOnly: cookie.isHttpOnly,
    session: cookie.isSession,
    expiry: cookie.isSession ? null : Math.floor(cookie.expiry / 1000),
    sameSite:
      Object.keys(sameSites).find(
        name => sameSites[name] === cookie.sameSite
      ) ?? "default",
    partitioned: cookie.isPartitioned,
  });
  switch (args.action ?? "get") {
    case "get":
      return { cookies: all.map(serialize) };
    case "delete": {
      for (const cookie of all)
        Services.cookies.remove(
          cookie.host,
          cookie.name,
          cookie.path,
          originAttributes
        );
      return { deleted: all.length };
    }
    case "set": {
      const cookie = {
        ...object(args.cookie, "cookie"),
        domain: args.cookie.domain ?? host,
      };
      if (cookie.domain.replace(/^\./, "") !== host)
        throw new Error("Cookies must belong to the current site's host");
      if (typeof cookie.name !== "string" || typeof cookie.value !== "string")
        throw new Error("Cookie name and value must be strings");
      if (
        cookie.sameSite !== undefined &&
        !Object.hasOwn(sameSites, cookie.sameSite)
      )
        throw new Error("Choose default, none, lax or strict SameSite");
      for (const key of ["secure", "httpOnly", "partitioned"])
        if (cookie[key] !== undefined && typeof cookie[key] !== "boolean")
          throw new Error(`${key} must be a boolean`);
      if (
        cookie.path !== undefined &&
        (typeof cookie.path !== "string" || !cookie.path.startsWith("/"))
      )
        throw new Error("Cookie path must start with /");
      if (
        cookie.expiry !== undefined &&
        (!Number.isSafeInteger(cookie.expiry) || cookie.expiry < 0)
      )
        throw new Error("expiry must be epoch seconds");
      if (
        cookie.expiry !== undefined &&
        cookie.expiry > Math.floor(Number.MAX_SAFE_INTEGER / 1000)
      )
        throw new Error("Cookie expiry is outside the native range");
      const validation = Services.cookies.add(
        cookie.domain,
        cookie.path ?? "/",
        cookie.name,
        cookie.value,
        cookie.secure ??
          context.currentWindowGlobal.documentURI.scheme === "https",
        cookie.httpOnly ?? false,
        cookie.expiry === undefined,
        cookie.expiry === undefined
          ? Number.MAX_SAFE_INTEGER
          : cookie.expiry * 1000,
        originAttributes,
        sameSites[cookie.sameSite ?? "default"],
        Ci.nsICookie.SCHEME_UNSET,
        cookie.partitioned ?? false
      );
      if (validation.result !== Ci.nsICookieValidation.eOK)
        throw new Error(validation.errorString);
      return { set: true };
    }
    default:
      throw new Error("Choose get, set or delete");
  }
}

async function permissions(session, args) {
  const { context } = site(session);
  if ((args.action ?? "list") === "list")
    return {
      permissions: Services.perms
        .getAllForPrincipal(context.currentWindowGlobal.documentPrincipal)
        .map(permission => ({
          type: permission.type,
          state:
            permission.capability === Services.perms.ALLOW_ACTION
              ? "granted"
              : permission.capability === Services.perms.DENY_ACTION
                ? "denied"
                : "prompt",
          expiry: permission.expireTime,
        })),
    };
  if (args.action !== "set") throw new Error("Choose list or set");
  const descriptor = object(args.descriptor, "descriptor");
  const principal = context.currentWindowGlobal.documentPrincipal;
  const innerWindowId = context.currentWindowGlobal.innerWindowId;
  lazy.permissions.validateDescriptor(descriptor);
  lazy.permissions.validateState(args.state);
  if (descriptor.name === "storage-access")
    throw new Error(
      "Storage-access permission overrides are unsupported by this native API"
    );
  const typed = await session.query("debug_permissions", {
    descriptor,
    state: args.state,
  });
  if (context.currentWindowGlobal?.innerWindowId !== innerWindowId)
    throw new Error(
      "Page changed before the permission update; inspect it again"
    );
  if (args.state === "prompt")
    Services.perms.removeFromPrincipal(principal, typed.type);
  else
    Services.perms.addFromPrincipal(
      principal,
      typed.type,
      args.state === "granted"
        ? Services.perms.ALLOW_ACTION
        : Services.perms.DENY_ACTION
    );
  return { state: args.state, descriptor };
}

async function continueBlockedRequest(session, request) {
  const phase = session.pendingRequests.get(request);
  if (!phase) return;
  session.pendingRequests.delete(request);
  try {
    await session.bidi(
      "network",
      phase === "network.responseStarted"
        ? "continueResponse"
        : phase === "network.authRequired"
          ? "continueWithAuth"
          : "continueRequest",
      {
        request,
        ...(phase === "network.authRequired" ? { action: "default" } : {}),
      }
    );
  } catch (error) {
    if (!session.pendingRequests.has(request))
      session.pendingRequests.set(request, phase);
    throw error;
  }
}

async function intercept(session, args) {
  const { action, ...params } = args;
  if (action === "add") {
    const subscription = await session.bidi("session", "subscribe", {
      contexts: [session.contextId],
      events: [
        "network.beforeRequestSent",
        "network.responseStarted",
        "network.authRequired",
      ],
    });
    session.subscriptions.add(subscription.subscription);
    const result = await session.bidi("network", "addIntercept", {
      contexts: [session.contextId],
      phases: params.phases ?? ["beforeRequestSent"],
      ...(params.urlPatterns ? { urlPatterns: params.urlPatterns } : {}),
    });
    session.intercepts.add(result.intercept);
    return result;
  }
  if (action === "remove") {
    if (!session.intercepts.has(params.intercept))
      throw new Error("Unknown intercept for this tab");
    const result = await session.bidi("network", "removeIntercept", {
      intercept: params.intercept,
    });
    session.intercepts.delete(params.intercept);
    return result;
  }
  if (!session.pendingRequests.has(params.request))
    throw new Error("Request is not blocked by this tab's debugging session");
  const command = {
    continue_request: "continueRequest",
    continue_response: "continueResponse",
    abort: "failRequest",
    respond: "provideResponse",
    continue_auth: "continueWithAuth",
  }[action];
  if (!command)
    throw new Error(
      "Choose add, remove, continue_request, continue_response, continue_auth, abort or respond"
    );
  if (action === "continue_auth") {
    params.action = params.authAction;
    delete params.authAction;
  }
  const phase = session.pendingRequests.get(params.request);
  session.pendingRequests.delete(params.request);
  try {
    return await session.bidi("network", command, params);
  } catch (error) {
    if (!session.pendingRequests.has(params.request))
      session.pendingRequests.set(params.request, phase);
    throw error;
  }
}

async function downloads(session, args) {
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  const all = (await list.getAll()).filter(download => {
    const context = BrowsingContext.get(download.source.browsingContextId);
    return context?.top === session.browser.browsingContext.top;
  });
  const record = download => {
    if (!downloadIds.has(download))
      downloadIds.set(download, `download-${++nextDownload}`);
    return {
      downloadId: downloadIds.get(download),
      url: download.source.url,
      filename: PathUtils.filename(download.target.path),
      stopped: download.stopped,
      succeeded: download.succeeded,
      canceled: download.canceled,
      currentBytes: download.currentBytes,
      totalBytes: download.totalBytes,
      hasPartialData: download.hasPartialData,
      error: download.error?.message ?? null,
    };
  };
  if ((args.action ?? "list") === "list") return all.map(record);
  const download = all.find(
    value => record(value).downloadId === args.downloadId
  );
  if (!download)
    throw new Error("Download is not associated with this open tab");
  if (args.action === "get") {
    if (!download.succeeded) throw new Error("Download is not complete");
    const directory = session.resolvePath(args.directory ?? ".");
    const info = await IOUtils.stat(directory);
    if (info.type !== "directory")
      throw new Error("Choose an existing download directory");
    const path = PathUtils.join(
      directory,
      `${Services.uuid.generateUUID().toString().slice(1, 9)}-${PathUtils.filename(download.target.path)}`
    );
    await IOUtils.copy(download.target.path, path, { noOverwrite: true });
    return { ...record(download), path };
  }
  if (args.action === "resume") await download.start();
  else if (["pause", "cancel"].includes(args.action)) await download.cancel();
  else throw new Error("Choose list, get, pause, resume or cancel");
  return record(download);
}

async function userContexts(session, args) {
  const action = args.action ?? "list";
  if ("proxy" in args || "acceptInsecureCerts" in args)
    throw new Error(
      "Test contexts retain the existing proxy and certificate policies"
    );
  if (action === "list") {
    for (const id of contexts)
      if (!lazy.UserContextManager.hasUserContextId(id)) contexts.delete(id);
    return { userContexts: [...contexts].map(contextId => ({ contextId })) };
  }
  if (action === "create") {
    const contextId = lazy.UserContextManager.createContext("taskarian-debug");
    contexts.add(contextId);
    return { contextId };
  }
  if (!contexts.has(args.contextId))
    throw new Error("Choose a context created by browser_debug");
  if (action === "open") {
    const url = args.url ?? "about:blank";
    if (!(url === "about:blank" || /^https?:\/\//i.test(url)))
      throw new Error("Test contexts support ordinary HTTP/HTTPS pages");
    if (url !== "about:blank" && new URL(url).hostname.endsWith(".onion"))
      throw new Error(
        "Use an ordinary Tor tab for onion sites; isolated test contexts do not provide Tor routing"
      );
    const result = await session.bidi("browsingContext", "create", {
      type: "tab",
      referenceContext: session.contextId,
      userContext: args.contextId,
      background: true,
    });
    if (url !== "about:blank")
      await session.adapter.navigateContext(result.context, url);
    return { contextId: args.contextId, browsingContext: result.context };
  }
  if (action === "remove") {
    // These contexts never install certificate or proxy overrides. Use the
    // native container owner directly, preserving Taskarian's certificate policy.
    lazy.UserContextManager.removeUserContext(args.contextId, {
      closeContextTabs: true,
    });
    contexts.delete(args.contextId);
    return { removed: true };
  }
  throw new Error("Choose list, create, open or remove");
}

export const BrowserDebug = {
  hasTab(tabId) {
    return [...sessions.values()].some(
      session => session.platform === "linux" && session.tabId === Number(tabId)
    );
  },

  capabilities(platform) {
    return {
      platform,
      methods: [
        ...COMMON,
        ...LEGACY,
        ...(platform === "linux" ? DESKTOP : []),
        ...environmentMethods(platform),
        ...diagnosticsMethods(platform),
      ],
      events: EVENTS,
      explicitTabIds: true,
      transport: "existing-browser-control",
      protectedAgent: true,
    };
  },

  async execute(method, args, adapter) {
    const operation = this.dispatch(method, args, adapter);
    if (method === "reset") return operation;
    const session = sessions.get(adapter.browser);
    const readOnly =
      [
        "frames",
        "evaluate",
        "read",
        "wait",
        "events",
        "get_environment",
        "get_viewport",
        "list_device_profiles",
        "list_console_messages",
        "list_network_requests",
        "get_network_request",
        "list_scripts",
        "get_script_source",
        "get_logpoint_results",
        "css",
        "accessibility",
      ].includes(method) ||
      (method === "cookies" && [undefined, "get"].includes(args.action)) ||
      (method === "permissions" && [undefined, "list"].includes(args.action)) ||
      (method === "debugger" &&
        [
          "sources",
          "source",
          "positions",
          "frames",
          "scopes",
          "evaluate",
        ].includes(args.action)) ||
      (method === "memory" && ["census", "allocations"].includes(args.action));
    if (session && !readOnly) {
      session.pending.add(operation);
      operation.then(
        () => session.pending.delete(operation),
        () => session.pending.delete(operation)
      );
    }
    const signals = [adapter.signal, session?.shutdown.signal].filter(Boolean);
    if (!signals.length) return operation;
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        for (const signal of signals)
          signal.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () =>
        finish(
          reject,
          signals.find(signal => signal.aborted)?.reason ||
            new Error("Debugging cancelled")
        );
      for (const signal of signals)
        signal.addEventListener("abort", abort, { once: true });
      operation.then(
        value => finish(resolve, value),
        error => finish(reject, error)
      );
      if (signals.some(signal => signal.aborted)) abort();
    });
  },

  async dispatch(method, args, adapter) {
    if (!this.capabilities(adapter.platform).methods.includes(method))
      throw new Error(
        `Unsupported debugging command on ${adapter.platform}: ${method}`
      );
    const session = getSession(adapter);
    if (method === "reset") {
      await this.release(adapter.browser);
      return { reset: true };
    }
    if (session.closed)
      throw new Error("Debugging cleanup is incomplete; retry reset");
    // Debugger frame IDs identify native paused-stack actors, not browsing
    // contexts. Diagnostics validates those actors against the selected tab's
    // ThreadFront; all other frame IDs still go through the document boundary.
    contextFor(session, method === "debugger" ? undefined : args.frameId);
    if (environmentMethods(adapter.platform).includes(method)) {
      const params = { ...args };
      delete params.frameId;
      return executeEnvironment(session, method, params);
    }
    if (diagnosticsMethods(adapter.platform).includes(method))
      return executeDiagnostics(session, method, args);
    if (["evaluate", "read", "wait"].includes(method)) {
      const { frameId, ...params } = args;
      return session.query(method, params, frameId);
    }
    if (method === "frames") {
      const result = [];
      const visit = context => {
        try {
          contextFor(session, context.id);
        } catch {
          return;
        }
        result.push({
          frameId: context.id,
          parentFrameId: context.parent?.id ?? null,
          url: context.currentWindowGlobal.documentURI.spec,
        });
        context.children.forEach(visit);
      };
      visit(session.browser.browsingContext);
      return result;
    }
    if (method === "input") {
      const context = contextFor(session, args.frameId);
      if (
        args.action !== "release" &&
        (!Array.isArray(args.actions) ||
          args.actions.some(source =>
            source.actions?.some(action => typeof action.origin === "object")
          ))
      )
        throw new Error(
          "Use native input sequences with viewport or pointer origins, not raw element handles"
        );
      const id = lazy.NavigableManager.getIdForBrowsingContext(context);
      session.inputContexts.add(id);
      return session.bidi(
        "input",
        args.action === "release" ? "releaseActions" : "performActions",
        {
          context: id,
          ...(args.action === "release" ? {} : { actions: args.actions }),
        }
      );
    }
    if (method === "events") return readEvents(session, args);
    if (method === "coverage") {
      const context = contextFor(session, args.frameId);
      const result = await session.query("debug_coverage", args, args.frameId);
      if (args.action === "start") session.coverageFrames.add(context.id);
      if (args.action === "stop") session.coverageFrames.delete(context.id);
      return result;
    }
    if (method === "subscribe") {
      if (
        !Array.isArray(args.events) ||
        !args.events.length ||
        args.events.some(name => !EVENTS.includes(name))
      )
        throw new Error(
          "Choose supported network or navigation events from debugging capabilities"
        );
      const result = await session.bidi("session", "subscribe", {
        events: args.events,
        contexts: [session.contextId],
      });
      session.subscriptions.add(result.subscription);
      return result;
    }
    if (method === "unsubscribe") {
      if (
        !Array.isArray(args.subscriptions) ||
        args.subscriptions.some(id => !session.subscriptions.has(id))
      )
        throw new Error("Choose subscriptions created for this tab");
      const result = await session.bidi("session", "unsubscribe", {
        subscriptions: args.subscriptions,
      });
      args.subscriptions.forEach(id => session.subscriptions.delete(id));
      return result;
    }
    if (method === "cookies") return cookies(session, args);
    if (method === "permissions") return permissions(session, args);
    if (method === "network_intercept") return intercept(session, args);
    if (method === "network_headers")
      return session.bidi("network", "setExtraHeaders", {
        contexts: [session.contextId],
        headers: args.headers ?? [],
      });
    if (method === "downloads") return downloads(session, args);
    if (method === "contexts") return userContexts(session, args);
    if (method === "navigate") {
      if (args.action !== "stop") throw new Error("Choose action stop");
      session.browser.stop();
      return { stopped: true };
    }
    if (method === "devtools") {
      const { gDevTools } = nativeModule("client/framework/devtools.js");
      if (args.action === "close") {
        await gDevTools.closeToolboxForTab(session.tab);
        return { closed: true };
      }
      const panel = args.panel ?? "webconsole";
      if (
        ![
          "inspector",
          "webconsole",
          "jsdebugger",
          "netmonitor",
          "accessibility",
          "styleeditor",
          "storage",
        ].includes(panel)
      )
        throw new Error("Choose an ordinary-tab DevTools panel");
      await gDevTools.showToolboxForTab(session.tab, { toolId: panel });
      return { opened: true, panel };
    }
    if (adapter.platform === "linux") {
      const result = await adapter.ordinary(method, args);
      if (method === "set_logpoint")
        session.logpoints.set(result.logpoint, args.frameId);
      if (method === "remove_logpoint") session.logpoints.delete(args.logpoint);
      return result;
    }
    if (method === "list_console_messages") return session.query("console", {});
    if (method === "clear_console_messages")
      return session.query("clearConsole", {});
    const params = { ...args };
    if (["remove_logpoint", "get_logpoint_results"].includes(method)) {
      params.id = params.logpoint;
      delete params.logpoint;
    }
    const result = await session.query(CHILD[method], params, args.frameId);
    if (method === "set_logpoint")
      session.logpoints.set(result.id, args.frameId);
    if (method === "remove_logpoint") session.logpoints.delete(args.logpoint);
    return result;
  },

  async release(browser) {
    const session = sessions.get(browser);
    if (!session) return;
    session.closed = true;
    session.shutdown.abort(new Error("Debugging session ended"));
    for (const wake of session.waiters) wake();
    const failures = [];
    const attempt = async work => {
      try {
        await work();
      } catch (error) {
        failures.push(error.message);
      }
    };
    // A native replay can await a request blocked by this session. Release
    // those channels before waiting for pending operations to finish. The
    // closed-session event handler continues any requests blocked meanwhile.
    if (session.handler) {
      for (const intercept of session.intercepts)
        await attempt(async () => {
          await session.bidi("network", "removeIntercept", { intercept });
          session.intercepts.delete(intercept);
        });
      for (const request of [...session.pendingRequests.keys()])
        await attempt(() => continueBlockedRequest(session, request));
    }
    await attempt(() => prepareDiagnosticsForReset(session));
    await Promise.allSettled([...session.pending]);
    await attempt(() => resetDiagnostics(session));
    if (session.commandsPromise)
      await attempt(async () => {
        await (await session.commandsPromise).destroy();
        session.commandsPromise = null;
      });
    await attempt(() => resetEnvironment(session));
    for (const frameId of session.coverageFrames)
      await attempt(async () => {
        const context = BrowsingContext.get(frameId);
        if (context && !context.isDiscarded)
          await session.query("debug_coverage", { action: "stop" }, frameId);
        session.coverageFrames.delete(frameId);
      });
    for (const [logpoint, frameId] of session.logpoints)
      await attempt(async () => {
        if (session.platform === "linux")
          await session.adapter.cleanupLogpoint(logpoint);
        else
          await session.query(
            "debuggerRemoveLogpoint",
            { id: logpoint },
            frameId
          );
        session.logpoints.delete(logpoint);
      });
    if (session.handler) {
      for (const intercept of session.intercepts)
        await attempt(async () => {
          await session.bidi("network", "removeIntercept", { intercept });
          session.intercepts.delete(intercept);
        });
      for (const request of [...session.pendingRequests.keys()])
        await attempt(() => continueBlockedRequest(session, request));
      for (const context of session.inputContexts)
        await attempt(async () => {
          await session.bidi("input", "releaseActions", { context });
          session.inputContexts.delete(context);
        });
      await Promise.allSettled([...session.teardownRequests]);
      failures.push(...session.teardownErrors.splice(0));
      session.handler.off(
        "message-handler-protocol-event",
        session.onProtocolEvent
      );
      await attempt(() => {
        session.handler.destroy();
        session.handler = null;
        session.pendingRequests.clear();
        session.intercepts.clear();
        session.inputContexts.clear();
        session.subscriptions.clear();
      });
    }
    while (session.cleanups.length) {
      const cleanup = session.cleanups.pop();
      await attempt(cleanup);
    }
    if (failures.length)
      throw new Error(`Debugging reset incomplete: ${failures.join("; ")}`);
    sessions.delete(browser);
  },

  async stop() {
    const results = await Promise.allSettled(
      [...sessions.keys()].map(browser => this.release(browser))
    );
    for (const result of results)
      if (result.status === "rejected") console.error(result.reason);
  },

  async resetTab(tabId) {
    const session = [...sessions.values()].find(
      value => value.platform === "linux" && value.tabId === tabId
    );
    if (session) await this.release(session.browser);
    return { reset: true };
  },
};
