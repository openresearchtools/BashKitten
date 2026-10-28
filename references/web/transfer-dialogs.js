// SPDX-License-Identifier: AGPL-3.0-only
// The pinned native translators own format conversion and option defaults.
// This ordinary web dialog adapts their exportOptions controls to an explicit
// project and selected item set; it does not implement a citation file format.
import { node, button, field, human, dialog } from "./common.js";
import { uploadFile } from "./uploads.js";

const pastedByteLimit = 256 * 1024;

export function importReferences({ scope, target = null, onJob }) {
  const d = dialog("Import references"),
    controller = new AbortController(),
    file = node("input", { type: "file" }),
    encoding = node("select"),
    text = node("textarea", {
      rows: 5,
      maxlength: pastedByteLimit,
      placeholder: "Or paste reference data",
    }),
    progress = node("progress", { max: 1, value: 0, hidden: true });
  const requestId = crypto.randomUUID();
  text.addEventListener("paste", (event) => {
    const pasted = event.clipboardData?.getData("text/plain");
    if (pasted === undefined) return;
    const length =
      text.value.length -
      (text.selectionEnd - text.selectionStart) +
      pasted.length;
    // Reject an oversized paste before maxlength could silently truncate a
    // reference record. Byte validation below also covers non-ASCII text.
    if (length > pastedByteLimit) {
      event.preventDefault();
      d.notice.textContent =
        "Use a reference file for more than 256 KiB of text.";
    }
  });
  for (const [value, label] of [
    ["utf-8", "UTF-8"],
    ["utf-16le", "UTF-16 little endian"],
    ["utf-16be", "UTF-16 big endian"],
    ["windows-1252", "Western Windows"],
    ["iso-8859-1", "Latin-1"],
  ])
    encoding.append(node("option", { value }, label));
  d.body.append(
    node("p", {}, "Destination: " + (target?.data?.name || "All references")),
    node(
      "p",
      { class: "notice" },
      "The file format is detected automatically. Choose a file up to 32 MiB or paste up to 256 KiB of text. Import progress and partial results appear in Jobs.",
    ),
    field("Reference file", file),
    field("File encoding", encoding),
    field("Reference data", text),
    progress,
  );
  let submitted = false;
  const submit = button(
    "Import",
    async () => {
      submit.disabled = true;
      file.disabled = encoding.disabled = text.disabled = true;
      d.notice.textContent = "Submitting import…";
      try {
        const selected = file.files[0];
        if (text.value.length > pastedByteLimit)
          throw Error("Use a reference file for more than 256 KiB of text.");
        if (selected && text.value.trim())
          throw Error("Choose a file or pasted data for this import.");
        if (selected?.size > 32 * 1024 * 1024)
          throw Error("Choose a reference file of at most 32 MiB.");
        let job;
        if (selected) {
          if (!selected.size) throw Error("Choose a nonempty reference file.");
          job = await uploadFile({
            scope,
            file: selected,
            body: {
              method: "import",
              requestId,
              encoding: encoding.value,
              queryString: new URLSearchParams({
                sessionID: requestId,
                summary: "true",
                target: target?.key || "",
              }).toString(),
            },
            signal: controller.signal,
            onProgress({ loaded, total }) {
              progress.hidden = false;
              progress.value = loaded / total;
              d.notice.textContent =
                loaded === total
                  ? "Starting native import…"
                  : "Uploading · " + Math.round(progress.value * 100) + "%";
            },
          });
        } else {
          const content = text.value;
          if (!content.trim())
            throw Error("Choose a reference file or paste reference data.");
          if (new TextEncoder().encode(content).byteLength > pastedByteLimit)
            throw Error(
              "Use a reference file for more than 256 KiB of UTF-8 text.",
            );
          job = await scope.request("import", {
            method: "POST",
            body: {
              text: content,
              target: target?.key || null,
              requestId,
              summary: true,
            },
            signal: controller.signal,
          });
        }
        controller.signal.throwIfAborted();
        submitted = true;
        onJob(job);
        d.el.close();
      } catch (error) {
        if (!controller.signal.aborted) d.notice.textContent = error.message;
      } finally {
        submit.disabled = false;
        file.disabled = encoding.disabled = text.disabled = false;
      }
    },
    { class: "primary" },
  );
  d.actions.append(
    button("Cancel", () => d.el.close()),
    submit,
  );
  d.el.addEventListener(
    "close",
    () => {
      controller.abort();
      if (!submitted) file.value = "";
    },
    { once: true },
  );
  d.open();
}

export async function exportReferences({ scope, keys }) {
  const d = dialog("Export selected references"),
    controller = new AbortController(),
    format = node("select", { "aria-label": "Export format" }),
    options = node("div", { class: "field-grid" }),
    download = node("a", { hidden: true }, "Download file");
  let translators = [],
    fields = new Map(),
    objectURL;
  const clearDownload = () => {
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    download.hidden = true;
    download.removeAttribute("href");
  };
  const updateOptions = () => {
    clearDownload();
    fields.clear();
    options.replaceChildren();
    const translator = translators.find((item) => item.id === format.value);
    for (const [name, value] of Object.entries(
      translator?.displayOptions || {},
    )) {
      // File bytes are saved through the existing attachment download route.
      // This endpoint exports metadata, notes and attachment URLs only.
      if (name === "exportFileData") continue;
      if (typeof value === "boolean") {
        const input = node("input", { type: "checkbox", checked: value });
        fields.set(name, input);
        options.append(field(human(name), input));
      }
    }
  };
  format.addEventListener("change", updateOptions);
  options.addEventListener("change", clearDownload);
  d.body.append(
    node(
      "p",
      {},
      keys.length +
        " selected references. Metadata and notes use the selected format; attachment files remain available through their download links.",
    ),
    field("Format", format),
    options,
    download,
  );
  const submit = button(
    "Export",
    async () => {
      submit.disabled = true;
      format.disabled = true;
      d.notice.textContent = "Exporting…";
      clearDownload();
      try {
        const translator = translators.find((item) => item.id === format.value);
        const values = { ...translator.displayOptions, exportFileData: false };
        for (const [name, input] of fields) values[name] = input.checked;
        const result = await scope.request("items/export", {
          method: "POST",
          body: { keys, translatorID: translator.id, options: values },
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        objectURL = URL.createObjectURL(
          new Blob([result.text], {
            type: result.contentType || "text/plain;charset=utf-8",
          }),
        );
        download.href = objectURL;
        download.download =
          "references." +
          (/^[a-z0-9]+$/i.test(result.extension) ? result.extension : "txt");
        download.hidden = false;
        d.notice.textContent = "Export ready.";
        download.focus();
      } catch (error) {
        if (!controller.signal.aborted) d.notice.textContent = error.message;
      } finally {
        submit.disabled = false;
        format.disabled = false;
      }
    },
    { class: "primary", disabled: true },
  );
  d.actions.append(
    button("Close", () => d.el.close()),
    submit,
  );
  d.el.addEventListener(
    "close",
    () => {
      controller.abort();
      clearDownload();
    },
    { once: true },
  );
  d.open();
  if (!keys.length || keys.length > 1000) {
    d.notice.textContent =
      "Select between 1 and 1,000 references for one export.";
    return;
  }
  try {
    const result = await scope.request("translators/export", {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    translators = result.items;
    format.append(
      ...translators.map((item) =>
        node("option", { value: item.id }, item.label),
      ),
    );
    updateOptions();
    submit.disabled = !translators.length;
    if (!translators.length)
      d.notice.textContent = "No export formats are available.";
  } catch (error) {
    if (!controller.signal.aborted) d.notice.textContent = error.message;
  }
}
