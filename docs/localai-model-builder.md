# LocalAI router model configuration

LocalAI uses the same private controller on Linux and Android/Termux. Native
**Add / edit router models** browses the backend filesystem, edits the selected
llama.cpp router INI and keeps the manual INI editor available. Android never
uses the APK filesystem to select a Termux model.

Each model has a name, model path, optional projector, context length, device,
fit setting, KV offload, flash attention and additional INI parameters. New
models start explicitly on CPU. Selecting a GPU fills supported defaults:
all layers, KV offload and automatic flash attention. Android's simple selector
uses CPU or all GPU layers; desktop additionally exposes a layer count.
Existing expert INI values remain editable manually. Unspecified existing
settings retain the engine defaults, rather than adopting the new-model defaults.
New router profiles and downloaded-model presets use 32,768 context tokens.
Stock Pi reserves 4,096 tokens for output safety and keeps 20,000 recent tokens
for compaction; an 8,192-token context left only one output token after the
observed 4.5k-token tool prompt. Existing context choices are preserved and remain
editable in the model form.
GPU choices come from the actual selected runtime's `--list-devices`. Discovery
failure is shown and does not prevent an explicit CPU preset.

The launcher retains its executable, port, INI path, working directory, command
and environment. The default command does not put global device/layer/context
options ahead of the per-model INI. An explicit custom command or environment
can override presets according to upstream precedence; it is not rewritten.
Runtime downloads select a Vulkan package on Android, and Vulkan or CUDA on Linux.
These packages also implement CPU execution. No separate CPU archive is selected.
The runtime metadata identifies the exact official upstream release tag, peeled
commit and package revision. Model weights remain separate downloads.

**Unload after inactivity** means time since the model's last use. Zero minutes
maps to upstream `sleep-idle-seconds = -1` (disabled); positive minutes become
seconds. The engine rejects zero seconds. The upper supported bound is 2,147,483
seconds because the released implementation converts an integer second value to
milliseconds. Sleeping unloads model/context memory and its RAM KV cache; there
is no separate KV-cache time-to-live setting. Router capacity can still evict an
idle model even when its inactivity timeout is disabled.

Saving checks the INI revision before publishing atomically. Untouched lines,
comments, aliases and unknown parameters are retained. Changed typed options
are normalized to upstream names, including negative boolean aliases. Engine
default cannot override an explicit `[*]` device; edit that global setting or
choose a concrete device. The helper requires readable absolute model paths;
other upstream layouts remain available through the manual INI editor.

**Save and test load** starts an isolated temporary router with the saved
launcher settings, the actual selected INI section and `[*]` defaults. It uses a
private empty model cache so unrelated cached models cannot autoload. It refuses
an already-active regular router model, global model-source overrides (including upstream system/user configuration), and a
pre-section default model layout. The latter can be moved to an explicit section
through the manual editor. The check loads through upstream `/models/load` and
requires the selected model's `/models` state to become `loaded`.

On success, failure, cancellation, view pause/close or an expired visible-view
lease, the check stops its own runtime guard and waits for that guard to reap
all owned descendants. Only confirmed load followed by confirmed process-tree
exit yields **Check passed; model unloaded**. This does not unload any regular
chat's model. Status requests renew a 30-second lease only while the native
editor is visible. Engine diagnostics remain in memory; no check transcript or
log file is retained.

The private commands are `localai-browse`, `localai-router-models`,
`localai-router-model-save`, `localai-router-model-test`,
`localai-router-model-test-status` and `localai-router-model-test-cancel`.
They are not remote HTTP management endpoints. Test status/cancellation bypass
the ordinary mutation queue so a slow unrelated command cannot prevent cleanup.

Source contract: [llama.cpp v0.6.0 server model presets](https://github.com/ggml-org/llama.cpp/blob/d81235049384534c167caea52b85a694f6103d14/tools/server/README.md#model-presets),
[INI parser](https://github.com/ggml-org/llama.cpp/blob/d81235049384534c167caea52b85a694f6103d14/common/preset.cpp),
[argument definitions](https://github.com/ggml-org/llama.cpp/blob/d81235049384534c167caea52b85a694f6103d14/common/arg.cpp).

On 8 October, the installed Android editor passed actual interaction through the
BashKitten desktop browser's Cuttlefish UI: opening the existing Qwen3.5 0.8B
Q4_0 preset, selecting explicit CPU, saving and retaining the global 8192 context
setting. Backend file browsing selected a downloaded Pocket model from Termux's
home directory. The normal Check/Download actions installed Android llama
`v0.6.0-r1` (peeled commit `d81235049384534c167caea52b85a694f6103d14`)
and Whisper `v1.9.5-r1` as Vulkan packages, with CPU execution selected.

**Save and test load** then loaded that Qwen preset and displayed **Check passed;
model unloaded**. A separate read-only process inspection found no remaining
llama router/model process. This verifies the successful check path in Cuttlefish;
close/cancel/failure cleanup, inactivity unloading and physical-device GPU
execution remain separate acceptance cases.

A subsequent ordinary Android composer request used the installed r1 router and
that saved CPU preset through stock Pi. The response was “Two plus two is four.”
The UI reported 2.9k input tokens, 47 output tokens and 1m 47s total during a
concurrent browser build. While inference ran, the native overlay showed
57.75–58.86% owned-workload CPU and 3.40–3.42 / 16.75 GB system RAM; Close
dismissed it normally. GPU remained unavailable on this Cuttlefish device. The
model emitted thinking despite the effective Pi reasoning selector showing Off.
The generated-provider discovery fix is `ab825a34e2`. A subsequent warm native
picker check found that choosing Off reselected the same cold model definition
and returned to Medium. Backend `a47c6f2115` keeps the discovered model for a
thinking-only change. Its installed recheck selected Off, retained Off after
readiness, and completed an ordinary request with Off still selected. The tiny
Qwen model emitted literal empty `<think></think>` tags and answered with the
previous request's word; no reasoning text appeared. The selection fix passed,
while that model-output behavior remains distinct from the selection state.

The native Models → Use Pocket action selected its matching projector. Saving
CPU synthesis with the public upstream JFK reference, entering a sentence/output
path and clicking Generate speech produced a 2.56-second, mono PCM16 24 kHz WAV.
Read-only transcription of that output recovered the exact entered sentence.
This synthesis used the already-installed earlier runtime before the r1 update;
no captured microphone audio or user speech was used for that check.

The same native Speech synthesis flow was subsequently repeated with the managed
`v0.6.0-r1` runtime in explicit CPU mode. **Generate speech** accepted the public
reference and entered sentence, and the panel displayed **complete** with the
requested new WAV path. This is an actual r1 UI check, separate from stock engine
CLI validation. Read-only inspection found a non-silent, mono 24 kHz WAV lasting
3.2 seconds; stock Whisper recovered exactly the sentence entered in the UI.

A bounded composer dictation check on APK `a7e0ed2c72` and backend `0f493ab6ff`
approved the native per-recording microphone prompt, displayed the red recording
state, and stopped with the same microphone button. A public JFK audio sample was
played through a temporary host virtual input. Whisper returned `[BLANK_AUDIO]`
twice into the composer with the saved automatic-send option Off. The unsent draft
was cleared, the temporary audio source stopped and the original automatic host
input restored. Recording/stop/transcription handling ran, but successful speech
dictation remains unverified. The point where silence entered was not measured;
the cause is unconfirmed. No microphone recording was retained.

A subsequent multi-tool check found that the original 8,192-token context was
too small for stock Pi's output budgeting: its 4,096-token safety reserve plus
the roughly 4.5k-token prompt clamped the requested output to one token. Native
history recorded `stopReason: length`; these one-word endings were not evidence
of a model refusing to use tools. Pi and its budgeting were left unchanged.
The native editor saved 32,768 context tokens and `threads=2` for the downloaded
Qwen3.5 2B Q4_0 preset, then the normal confirmed Reload restarted the router.
The model child's actual arguments contained both settings, and the chat showed
the discovered 33k context. An ordinary arithmetic request completed with
Reasoning Off, followed by the [subagent delivery check](pi-tools.md).
New configuration/model defaults use 32,768 tokens; existing saved choices
remain unchanged by upgrades. Only this disposable acceptance profile's old
global 8k preset was explicitly aligned through its native INI editor.
