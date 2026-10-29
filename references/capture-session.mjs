// SPDX-License-Identifier: AGPL-3.0-or-later
// Host adapter for pinned SaveSession item/tag/note updates. No destination inference.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const nativeUpdateNote = require("./runtime/session-note-native.js");

export async function updateCaptureSession(p, sessionID, body, call, signal) {
  const session = await call(
    p,
    "record",
    { id: "capture:" + sessionID },
    signal,
  );
  if (!session)
    throw Object.assign(Error("Capture session unavailable"), { status: 404 });
  if (body.target && body.target !== "L" + p.id)
    throw Object.assign(Error("Collections are no longer supported. Select a References project."), { status: 410 });
  const parents = new Map();
  for (const key of Object.values(session.items || {})) {
    let item;
    try {
      item = await call(p, "get", { key }, signal);
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
    if (item.data.parentItem)
      item = await call(p, "get", { key: item.data.parentItem }, signal);
    if (!item.data.deleted) parents.set(item.key, item);
  }
  session.userAddedNotes ||= {};
  const state = {
    _currentNote: body.note,
    _userAddedNotes: session.userAddedNotes,
  };
  class Note {
    constructor(record) {
      this.record = record && typeof record === "object" ? record : null;
      this.id = this.record?.key;
    }
    setNote(note) {
      this.note = note;
    }
    async saveTx() {
      const key = createHash("sha256")
        .update("capture-note:" + sessionID + ":" + this.parentID)
        .digest("hex")
        .slice(0, 16)
        .toUpperCase();
      let current = this.record;
      if (!current) {
        try {
          current = await call(p, "get", { key }, signal);
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
      if (
        current &&
        (current.data.itemType !== "note" ||
          current.data.provenance?.captureSession !== sessionID ||
          current.data.parentItem !== this.parentID)
      )
        throw Object.assign(
          Error("This note does not belong to the capture session"),
          { status: 403 },
        );
      const data = {
        itemType: "note",
        note: this.note,
        parentItem: this.parentID,
        provenance: { captureSession: sessionID },
      };
      const saved = await call(
        p,
        "put",
        {
          value: current
            ? { key: current.key, data }
            : { createKey: key, data },
          expected: current?.version,
        },
        signal,
      );
      this.id = saved.key;
    }
    async eraseTx() {
      await call(
        p,
        "eraseSessionNote",
        { key: this.id, expected: this.record.version, sessionID },
        signal,
      );
    }
  }
  for (let item of parents.values()) {
    const data = { ...item.data };
    if (body.tags !== undefined) {
      const tags = (
        Array.isArray(body.tags) ? body.tags : String(body.tags).split(",")
      )
        .map((tag) => String(tag).trim())
        .filter(Boolean);
      // Native SaveSession keeps translator-created automatic tags.
      data.tags = (item.data.tags || [])
        .filter((tag) => tag.type === 1)
        .concat(tags.map((tag) => ({ tag, type: 0 })));
    }
    if (body.tags !== undefined)
      item = await call(
        p,
        "put",
        { value: { key: item.key, data }, expected: item.version },
        signal,
      );
    if (Object.hasOwn(body, "note")) {
      const key =
        session.userAddedNotes[item.key] ||
        createHash("sha256")
          .update("capture-note:" + sessionID + ":" + item.key)
          .digest("hex")
          .slice(0, 16)
          .toUpperCase();
      let note;
      try {
        const record = await call(p, "get", { key }, signal);
        if (
          record.data.itemType !== "note" ||
          record.data.provenance?.captureSession !== sessionID ||
          record.data.parentItem !== item.key
        )
          throw Object.assign(
            Error("This note does not belong to the capture session"),
            { status: 403 },
          );
        note = new Note(record);
        session.userAddedNotes[item.key] = key;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      const updateNote = nativeUpdateNote({
        Item: Note,
        Items: { get: (id) => (id === key ? note : undefined) },
      });
      await updateNote.call(state, { id: item.key, libraryID: p.id });
      await call(
        p,
        "record",
        { id: "capture:" + sessionID, data: session },
        signal,
      );
    }
  }
  await call(
    p,
    "record",
    { id: "capture:" + sessionID, data: session },
    signal,
  );
  return {};
}
