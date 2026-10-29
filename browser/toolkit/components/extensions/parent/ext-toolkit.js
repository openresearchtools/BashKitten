/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// These are defined on "global" which is used for the same scopes as the other
// ext-*.js files.
/* exported getCookieStoreIdForTab, getCookieStoreIdForContainer,
            getContainerForCookieStoreId,
            isValidCookieStoreId, isContainerCookieStoreId,
            EventManager, URL */

ChromeUtils.defineESModuleGetters(this, {
  ContextualIdentityService:
    "resource://gre/modules/ContextualIdentityService.sys.mjs",
});

XPCOMUtils.defineLazyGlobalGetters(this, ["URL", "TextEncoder", "TextDecoder"]);

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

var { ExtensionError } = ExtensionUtils;

global.EventEmitter = ExtensionCommon.EventEmitter;
global.EventManager = ExtensionCommon.EventManager;

global.DEFAULT_STORE = "firefox-default";
global.PRIVATE_STORE = "firefox-private";
global.CONTAINER_STORE = "firefox-container-";
// Named private sessions are distinct stores, just like named normal sessions.
const PRIVATE_CONTAINER_STORE = "firefox-private-container-";

// GeckoView's context IDs are strings, not desktop userContextIds. Match
// StorageController.createSafeSessionContextId/retrieveUnsafeSessionContextId,
// including Java BigInteger's signed, minimal-width UTF-8 representation.
function geckoViewContextId(contextId) {
  if (contextId === "") {
    return "gvctxempty";
  }
  // Java's UTF-8 encoder replaces unpaired UTF-16 surrogates with '?'.
  const bytes = new TextEncoder().encode(
    contextId.replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "?"
    )
  );
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  if (bytes[0] & 0x80) {
    value -= 1n << BigInt(bytes.length * 8);
  }
  return `gvctx${value.toString(16)}`;
}

function geckoViewUnsafeContextId(contextId) {
  if (contextId === "gvctxempty") {
    return "";
  }
  const match = /^gvctx(-?)([a-f0-9]+)$/.exec(contextId);
  if (!match) {
    throw new ExtensionError("Invalid GeckoView session context ID");
  }
  let value = BigInt(`0x${match[2]}`) * (match[1] ? -1n : 1n);
  const bytes = [];
  do {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  } while (
    (value !== 0n || bytes[0] & 0x80) &&
    (value !== -1n || !(bytes[0] & 0x80))
  );
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes));
}

global.getCookieStoreIdForTab = function (data, tab) {
  if (AppConstants.platform === "android" && tab.userContextId != null) {
    return (
      (data.incognito ? PRIVATE_CONTAINER_STORE : CONTAINER_STORE) +
      tab.userContextId
    );
  }
  if (data.incognito) {
    return PRIVATE_STORE;
  }

  if (tab.userContextId) {
    return getCookieStoreIdForContainer(tab.userContextId);
  }

  return DEFAULT_STORE;
};

global.getCookieStoreIdForOriginAttributes = function (originAttributes) {
  if (
    AppConstants.platform === "android" &&
    originAttributes.geckoViewSessionContextId
  ) {
    return (
      (originAttributes.privateBrowsingId
        ? PRIVATE_CONTAINER_STORE
        : CONTAINER_STORE) +
      geckoViewUnsafeContextId(originAttributes.geckoViewSessionContextId)
    );
  }
  if (originAttributes.privateBrowsingId) {
    return PRIVATE_STORE;
  }

  if (originAttributes.userContextId) {
    return getCookieStoreIdForContainer(originAttributes.userContextId);
  }

  return DEFAULT_STORE;
};

global.isPrivateCookieStoreId = function (storeId) {
  return (
    storeId == PRIVATE_STORE ||
    (AppConstants.platform === "android" &&
      typeof storeId === "string" &&
      storeId.startsWith(PRIVATE_CONTAINER_STORE))
  );
};

global.isDefaultCookieStoreId = function (storeId) {
  return storeId == DEFAULT_STORE;
};

global.isContainerCookieStoreId = function (storeId) {
  return storeId !== null && storeId.startsWith(CONTAINER_STORE);
};

global.getCookieStoreIdForContainer = function (containerId) {
  return CONTAINER_STORE + containerId;
};

global.getContainerForCookieStoreId = function (storeId) {
  if (!isContainerCookieStoreId(storeId)) {
    return null;
  }

  let containerId = storeId.substring(CONTAINER_STORE.length);

  if (AppConstants.platform === "android") {
    return parseInt(containerId, 10);
  } // TODO: Bug 1643740, support ContextualIdentityService on Android

  if (ContextualIdentityService.getPublicIdentityFromId(containerId)) {
    return parseInt(containerId, 10);
  }

  return null;
};

global.isValidCookieStoreId = function (storeId) {
  return (
    isDefaultCookieStoreId(storeId) ||
    isPrivateCookieStoreId(storeId) ||
    isContainerCookieStoreId(storeId)
  );
};

global.getOriginAttributesPatternForCookieStoreId = function (cookieStoreId) {
  if (AppConstants.platform === "android") {
    const isPrivate = isPrivateCookieStoreId(cookieStoreId);
    let contextId = "";
    if (isContainerCookieStoreId(cookieStoreId)) {
      contextId = geckoViewContextId(
        cookieStoreId.substring(CONTAINER_STORE.length)
      );
    } else if (isPrivate && cookieStoreId !== PRIVATE_STORE) {
      contextId = geckoViewContextId(
        cookieStoreId.substring(PRIVATE_CONTAINER_STORE.length)
      );
    } else if (!isDefaultCookieStoreId(cookieStoreId) && !isPrivate) {
      throw new ExtensionError("Invalid cookieStoreId");
    }
    return {
      userContextId: 0,
      privateBrowsingId: isPrivate ? 1 : 0,
      // Even a partition/FPI wildcard query must stay in this exact session.
      geckoViewSessionContextId: contextId,
    };
  }
  if (isDefaultCookieStoreId(cookieStoreId)) {
    return {
      userContextId: Ci.nsIScriptSecurityManager.DEFAULT_USER_CONTEXT_ID,
      privateBrowsingId:
        Ci.nsIScriptSecurityManager.DEFAULT_PRIVATE_BROWSING_ID,
    };
  }
  if (isPrivateCookieStoreId(cookieStoreId)) {
    return {
      userContextId: Ci.nsIScriptSecurityManager.DEFAULT_USER_CONTEXT_ID,
      privateBrowsingId: 1,
    };
  }
  if (isContainerCookieStoreId(cookieStoreId)) {
    let userContextId = getContainerForCookieStoreId(cookieStoreId);
    if (userContextId !== null) {
      return { userContextId };
    }
  }

  throw new ExtensionError("Invalid cookieStoreId");
};
