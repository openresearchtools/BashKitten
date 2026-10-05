/* SPDX-License-Identifier: AGPL-3.0-only */
import { IndexedDB } from "resource://gre/modules/IndexedDB.sys.mjs";

if (Services.appinfo.processType !== Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT) {
  throw new Error("Agent drafts belong to the native parent process.");
}

// This origin is never loaded. Using the protected connection's origin attributes
// lets its existing Forget/re-enrollment clear-data path remove this storage too.
const storageURI = Services.io.newURI("https://bashkitten-drafts.invalid");
async function access(requireEnrollment, draft) {
  const enrollment = await requireEnrollment();
  if (!/^[a-f0-9]{64}$/.test(enrollment.identity)) throw new Error("Enrolled Agent identity required.");
  const principal = Services.scriptSecurityManager.createContentPrincipal(storageURI, enrollment.attributes);
  const db = await IndexedDB.openForPrincipal(principal, "bashkitten-agent-draft", { version: 1 },
    database => database.createObjectStore("drafts"));
  try {
    const current = await requireEnrollment();
    if (current.identity !== enrollment.identity ||
        JSON.stringify(current.attributes) !== JSON.stringify(enrollment.attributes)) {
      throw new Error("The Agent connection changed.");
    }
    const transaction = db.transaction("drafts", draft === undefined ? "readonly" : "readwrite");
    const store = transaction.objectStore("drafts");
    const request = draft === undefined ? store.get(enrollment.identity) : store.put(draft, enrollment.identity);
    const [result] = await Promise.all([request, transaction.promiseComplete()]);
    return result;
  } finally { db.close(); }
}

export const BashKittenDrafts = {
  load: requireEnrollment => access(requireEnrollment),
  save: (requireEnrollment, draft) => access(requireEnrollment, draft),
};
