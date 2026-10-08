# File preview verification, 8 October 2026

The Android checks below used the installed BashKitten browser, controlled through
the desktop BashKitten browser's Cuttlefish web UI. The guest was Android 17 with
native KVM and graphics. Source documents were public project documentation,
branding, the published model catalogue and the system's shared MIME specification.
They remained outside the source repository and release artifacts.

The installed viewer implementation was `8114c8dc01`; the backend was subsequently
updated to `ab825a34e2`. These are manual feature checks, separate from compilation
and artifact-integrity checks. They do not establish physical-device coverage.

| Format or flow | Observed result |
| --- | --- |
| Markdown | One View click opened a normal private browser tab. Rendered headings, paragraphs, lists and code were present. Raw showed the original source; Rendered restored it. Wide tables scrolled horizontally without widening surrounding prose. |
| Markdown links | A genuine HTTPS source link opened the requested GitHub page in a separate ordinary tab. Closing the source preview removed its temporary file while the external page remained open. |
| Plain text | The complete guide opened in the text preview. The original Files-row download displayed Saved and matched the source SHA-256. |
| PDF | The normal Gecko PDF viewer displayed readable pages and its existing toolbar. Download failures found in this build are tracked separately below. |
| DOCX, ODT and PPTX | Files View ran the selected Termux host's LibreOffice conversion and opened its PDF result. Pages were visible; read-only inspection of the ODT/PPTX outputs also recovered the expected document/slide text. |
| XLSX | A 42-column catalogue opened in the read-only grid. Horizontal scrolling changed visible columns; switching worksheets displayed the second sheet's values. |
| CSV | The 42-row catalogue rendered. Scrolling reached rows in the next embedded page, including rows 32–41. |
| ODS | The catalogue opened with the expected headers and model values in the same grid. |
| PNG | The existing image overlay opened and zoomed to 125%. Its download arrow saved the original bytes, verified by SHA-256. |
| Preview cleanup | Closing the preview tab removed its private prepared file. All preview and external-link tabs used during these checks were closed afterwards. |
| Existing wide layout | A landscape display at least 600 dp wide kept Agent beside the ordinary Markdown preview tab. Portrait returned to the normal full-browser handoff. Original rotation settings were restored. |

The PDF viewer toolbar and the Files-row PDF attachment download both failed on
the original `8114c8dc01` APK. The toolbar passed a file URL to a download manager
which rejects that scheme; the Files route was subject to the existing preference
that opens PDF attachments inline. Source fixes `8bf082bbec` and `a7e0ed2c72`
preserve the PDF Blob download and honor explicit attachment downloads. Both
passed an actual installed `a7e0ed2c72` APK recheck: the Files row displayed
**Saved Shared MIME specification.pdf**; the PDF toolbar displayed **Download
completed** and the normal Downloads screen listed `document.pdf`. Both completed
MediaStore files contained all 146,453 bytes and matched the source SHA-256
`faa06a15d80b2a91a5c044712858cfe2929f8b37e35c6e9d1f79aa49a71dc018`.

Cancellation while conversion is still running remains unverified: the small
documents completed before the attempted cancellation. Desktop native Files
interaction also remains unverified because the available OS input path did not
activate its controls. Parser coverage for additional supported extensions is
not a claim that every extension has been opened manually.
