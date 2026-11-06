// SPDX-License-Identifier: MIT
// One process per utterance. stdin: PCM16LE 16kHz, 512 samples/frame.
// stdout: READY newline, then one little-endian float probability per frame.
#include "whisper.h"
#include "ggml-backend.h"
#include <array>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <cstdint>

int main(int argc, char **argv) {
    if (argc == 2 && std::strcmp(argv[1], "--help") == 0) {
        std::puts("taskarian-vad MODEL: PCM16LE 16kHz stdin, float32LE probabilities stdout");
        return 0;
    }
    if (argc != 2) return 2;
    std::atomic_bool inference_error{false};
    whisper_log_set([](enum ggml_log_level level, const char *text, void *opaque) {
        if (level == GGML_LOG_LEVEL_ERROR) static_cast<std::atomic_bool *>(opaque)->store(true);
        if (level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR) std::fputs(text, stderr);
    }, &inference_error);
    // The package uses dynamic ggml backends, exactly like whisper-cli.
    // Optional GPU loader failures do not change this helper's CPU-only role.
    ggml_backend_load_all();
    inference_error.store(false);
    auto params = whisper_vad_default_context_params();
    params.use_gpu = false; params.n_threads = 1;
    auto *ctx = whisper_vad_init_from_file_with_params(argv[1], params);
    if (!ctx) return 1;
    if (inference_error.load()) { whisper_vad_free(ctx); return 1; }
    whisper_vad_reset_state(ctx);
    std::puts("READY"); std::fflush(stdout);
    std::array<unsigned char, 1024> bytes{};
    std::array<float, 512> samples{};
    int status = 0;
    for (;;) {
        const auto count = std::fread(bytes.data(), 1, bytes.size(), stdin);
        if (!count && std::feof(stdin)) break;
        if (count != bytes.size()) { status = 1; break; }
        for (size_t i = 0; i < samples.size(); ++i) {
            const auto value = int16_t(uint16_t(bytes[2*i]) | (uint16_t(bytes[2*i+1]) << 8));
            samples[i] = value / 32768.0f;
        }
        if (!whisper_vad_detect_speech_no_reset(ctx, samples.data(), samples.size()) || inference_error.load() || whisper_vad_n_probs(ctx) != 1) { status = 1; break; }
        const float probability = whisper_vad_probs(ctx)[whisper_vad_n_probs(ctx)-1];
        if (!std::isfinite(probability) || probability < 0 || probability > 1) { status = 1; break; }
        uint32_t bits; std::memcpy(&bits, &probability, sizeof(bits));
        const unsigned char output[4] = {uint8_t(bits), uint8_t(bits>>8), uint8_t(bits>>16), uint8_t(bits>>24)};
        if (std::fwrite(output,1,4,stdout) != 4 || std::fflush(stdout)) { status = 1; break; }
    }
    bytes.fill(0); samples.fill(0);
    whisper_vad_reset_state(ctx); whisper_vad_free(ctx);
    return status;
}
