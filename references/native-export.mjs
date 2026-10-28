// SPDX-License-Identifier: AGPL-3.0-or-later
// Host the pinned IO.Write and unchanged Node ItemGetter, without format rewrites.
import { createRequire } from "node:module";
import {
  openSync, closeSync, readSync, writeSync, fstatSync, unlinkSync, constants,
} from "node:fs";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const iconv = require("iconv-lite");
const installNativeIO = require("./runtime/export-io-native.js");
const { FORMATS, CONTENT_TYPES } = require("./runtime/formats.js");
const outputState = Symbol("authorized-export-output");
const installed = new WeakSet();

export function exportMemoryNotice(translator) {
  const mode = translator.configOptions?.dataMode;
  if (["rdf", "rdf/xml", "rdf/n3"].includes(mode))
    return "This native format keeps its RDF graph in memory until serialization; large exports need memory proportional to their contents.";
  if (translator.translatorID === "bc03b4fe-436d-4a1f-ba59-de4d2d7a63f7")
    return "This native format builds the complete CSL JSON array in memory before writing it; large exports need memory proportional to their contents.";
  if (mode === "xml/dom" || translator.translatorID === "eb7059a4-35ec-4961-a915-3cf58eb9784b")
    return "This native format builds its XML document in memory before writing it; large exports need memory proportional to their contents.";
  if (translator.translatorID === "897a81c2-9f60-4bec-ae6b-85a5030b8be5")
    return "This native format builds its complete HTML document in memory before writing it; large exports need memory proportional to their contents.";
  return "";
}

function cancellation(signal, cancelBuffer) {
  const flag = cancelBuffer ? new Int32Array(cancelBuffer) : null;
  return () => {
    signal?.throwIfAborted();
    if (flag && Atomics.load(flag, 0))
      throw new DOMException("Cancelled", "AbortError");
  };
}

// Native ItemGetter uses only length and shift. One complete native record is
// materialized at a time; it, including its children, remains the native unit.
class ItemQueue {
  constructor({ input, items, prepare, check, progress }) {
    this.check = check;
    this.prepare = prepare;
    this.progress = progress;
    this.index = 0;
    this.offset = 0;
    this.chunk = Buffer.alloc(0);
    if (input) {
      if (typeof input.path !== "string" || !Number.isSafeInteger(input.count) || input.count < 0)
        throw Error("Invalid private export input");
      this.fd = openSync(input.path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW || 0));
      try {
        this.initialStat = fstatSync(this.fd);
        if (!this.initialStat.isFile()) throw Error("Export input is not a regular file");
      } catch (error) { this.close(); throw error; }
      this.total = input.count;
    } else {
      if (!Array.isArray(items)) throw Error("Export requires items or a private input spool");
      this.items = items;
      this.total = items.length;
    }
  }
  get length() {
    this.check();
    if (this.index === this.total && this.fd !== undefined) this.verifyEnd();
    return this.total - this.index;
  }
  readChunk() {
    this.check();
    const buffer = Buffer.allocUnsafe(65536);
    const count = readSync(this.fd, buffer, 0, buffer.length, null);
    this.chunk = buffer.subarray(0, count);
    this.offset = 0;
    return count;
  }
  readLine() {
    const parts = [];
    for (;;) {
      this.check();
      if (this.offset === this.chunk.length && !this.readChunk())
        throw Error("Export input ended before its declared item count");
      const end = this.chunk.indexOf(10, this.offset);
      parts.push(this.chunk.subarray(this.offset, end < 0 ? undefined : end));
      this.offset = end < 0 ? this.chunk.length : end + 1;
      if (end >= 0) return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
    }
  }
  verifyEnd() {
    if (this.verified) return;
    if (this.offset !== this.chunk.length || this.readChunk())
      throw Error("Export input exceeds its declared item count");
    const finalStat = fstatSync(this.fd);
    if (finalStat.size !== this.initialStat.size || finalStat.mtimeMs !== this.initialStat.mtimeMs)
      throw Error("Export input changed during translation");
    this.verified = true;
  }
  shift() {
    if (!this.length) return undefined;
    const item = this.fd === undefined ? structuredClone(this.items[this.index]) : JSON.parse(this.readLine());
    if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("Invalid native export item");
    this.check();
    const result = this.prepare(item);
    this.index++;
    this.progress(this.index, this.total);
    return result;
  }
  close() {
    if (this.fd !== undefined) { closeSync(this.fd); this.fd = undefined; }
  }
}

// The released IO.Write expects nsIFileOutputStream and
// nsIConverterOutputStream. These worker-local hosts replace only those streams.
class FileOutputStream {
  init(location) {
    const state = location?.[outputState];
    if (!state) throw Error("Export output requires an authorized private location");
    state.check();
    this.state = state;
    state.raw = this;
    this.fd = openSync(location.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    state.created = true;
  }
  write(data, count) {
    const bytes = Buffer.isBuffer(data) ? data.subarray(0, count) : Buffer.from(data.slice(0, count), "latin1");
    for (let offset = 0; offset < bytes.length;) {
      this.state.check();
      const written = writeSync(this.fd, bytes, offset, Math.min(65536, bytes.length - offset));
      if (!written) throw Error("Export output write made no progress");
      this.state.hash.update(bytes.subarray(offset, offset + written));
      this.state.byteLength += written;
      offset += written;
    }
    return bytes.length;
  }
  close() {
    if (this.fd === undefined) return;
    try { this.converter?.finish(); }
    finally { closeSync(this.fd); this.fd = undefined; }
  }
}
class ConverterOutputStream {
  init(raw, charset) {
    // iconv accepts punctuation/whitespace aliases, but this label also becomes
    // an unquoted Content-Type parameter. Require the HTTP token grammar.
    if (typeof charset !== "string" || !charset.length || /[^!#$%&'*+\-.^_`|~0-9A-Za-z]/.test(charset))
      throw Object.assign(Error("Invalid export character set"), { status: 400 });
    this.finish();
    if (!iconv.encodingExists(charset)) throw Error("Unsupported export character set: " + charset);
    this.raw = raw;
    raw.converter = this;
    this.encoder = iconv.getEncoder(charset, { addBOM: false });
    raw.state.charset = charset;
  }
  writeString(data) {
    data = String(data);
    for (let start = 0; start < data.length;) {
      this.raw.state.check();
      let end = Math.min(data.length, start + 16384);
      // Do not split a surrogate pair in encoders that consume each write alone.
      if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
      const bytes = this.encoder.write(data.slice(start, end));
      this.raw.write(bytes, bytes.length);
      start = end;
    }
  }
  finish() {
    if (!this.encoder) return;
    const encoder = this.encoder;
    this.encoder = null;
    const bytes = encoder.end();
    if (bytes?.length) this.raw.write(bytes, bytes.length);
  }
}

function installWriter(Z) {
  if (installed.has(Z)) return;
  Z.Translate.IO.maintainedInstances ||= [];
  const Write = installNativeIO(Z, {
    interfaces: { nsIFileOutputStream: FileOutputStream, nsIConverterOutputStream: ConverterOutputStream },
    classes: {
      "@mozilla.org/network/file-output-stream;1": { createInstance: () => new FileOutputStream() },
      "@mozilla.org/intl/converter-output-stream;1": { createInstance: () => new ConverterOutputStream() },
    },
  });
  const nativeClose = Write.prototype.close;
  // Native completion always closes the writer. Preserve its RDF serialization,
  // but avoid serializing a cancelled graph and surface close failures after the
  // native completion promise settles, rather than leaving that promise pending.
  Write.prototype.close = function () {
    if (this._hostClosed) return;
    this._hostClosed = true;
    const state = this._rawStream.state;
    try { state.check(); nativeClose.call(this); }
    catch (error) { state.error ||= error; }
    finally {
      try { this._rawStream.close(); } catch (error) { state.error ||= error; }
      const index = Z.Translate.IO.maintainedInstances.indexOf(this);
      if (index !== -1) Z.Translate.IO.maintainedInstances.splice(index, 1);
    }
  };
  installed.add(Z);
}

export async function runNativeExport(Z, { items, input, translatorID, options = {} }, {
  signal, outputFile, cancelBuffer, onProgress,
} = {}) {
  const check = cancellation(signal, cancelBuffer);
  check();
  if (options.exportFileData)
    throw Object.assign(Error("Metadata export does not copy attachment files; export their Bibliography folder through Files"), { status: 422 });
  const translator = Z.Translators.get(translatorID);
  if (!translator || !(translator.translatorType & 2))
    throw Object.assign(Error("Export translator is unavailable"), { status: 400 });
  if (input && !outputFile) throw Error("Private export input requires a private output file");
  const legacy = Z.Utilities.semverCompare("4.0.27", translator.minVersion) > 0;
  let lastProgress = 0;
  const progress = (completed, total) => {
    const now = Date.now();
    if (!completed || completed === total || now - lastProgress >= 100) {
      onProgress?.({ key: "export", phase: "translating", completed, total });
      lastProgress = now;
    }
  };
  const queue = new ItemQueue({ input, items, check, progress, prepare(item) {
    item.creators ||= [];
    item.tags ||= [];
    item.relations ||= {};
    item.uri ||= item.key;
    delete item.key;
    if (legacy)
      for (const field of ["dateAdded", "dateModified", "accessDate"])
        if (item[field]) item[field] = Z.Date.isoToSQL(item[field]);
    return item;
  } });
  const state = { check, hash: createHash("sha256"), byteLength: 0, charset: "UTF-8" };
  const translate = new Z.Translate.Export();
  let succeeded = false;
  try {
    if (outputFile) {
      installWriter(Z);
      translate.setLocation({ path: outputFile, [outputState]: state });
    }
    translate.setTranslator(translatorID);
    translate.setDisplayOptions({ ...options, exportFileData: false });
    translate.setItems(queue);
    progress(0, queue.total);
    await translate.translate({ libraryID: false });
    check();
    if (state.error) throw state.error;
    const format = Object.keys(FORMATS).find((name) => FORMATS[name] === translatorID);
    const metadata = {
      contentType: (CONTENT_TYPES[format] || "text/plain") + "; charset=" + state.charset.toLowerCase(),
      extension: /^[a-z0-9]+$/i.test(translator.target) ? translator.target : "txt",
      translatorID,
      memoryNotice: exportMemoryNotice(translator),
    };
    succeeded = true;
    if (outputFile) return { ...metadata, file: true, byteLength: state.byteLength, sha256: state.hash.digest("hex") };
    return { ...metadata, text: translate.string };
  } finally {
    try { queue.close(); }
    finally {
      try { state.raw?.close(); }
      finally {
        try {
          if (!succeeded && state.created) unlinkSync(outputFile);
        } finally {
          // A constructor failure can precede assignment to translate._io.
          Z.Translate.IO.maintainedInstances = (Z.Translate.IO.maintainedInstances || []).filter((io) => io._rawStream?.state !== state);
        }
      }
    }
  }
}
