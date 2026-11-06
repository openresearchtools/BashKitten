# SPDX-License-Identifier: MIT
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 AS builder
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/ /usr/local/
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg git build-essential gcc-14 g++-14 cmake ninja-build pkg-config python3 ccache libgomp1 libvulkan-dev glslc spirv-headers xz-utils unzip && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
ARG TARGETOS=linux
ARG BACKEND=vulkan
ENV CC=gcc-14 CXX=g++-14 CUDAHOSTCXX=g++-14
COPY build/native-sources/cuda-12.9/SOURCE.json /tmp/cuda-sources.json
RUN if [ "$BACKEND" = cuda ]; then \
    case "$TARGETARCH" in amd64) cuda_arch=x86_64;; arm64) cuda_arch=sbsa;; *) exit 1;; esac; \
    cuda_repo="https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/$cuda_arch"; \
    curl -fLsS "$cuda_repo/3bf863cc.pub" | gpg --dearmor -o /usr/share/keyrings/nvidia-cuda.gpg; \
    printf 'deb [signed-by=/usr/share/keyrings/nvidia-cuda.gpg] %s /\n' "$cuda_repo" > /etc/apt/sources.list.d/cuda.list; \
    apt-get -o Acquire::https::No-Cache=true -o Acquire::Retries=3 update && \
    cuda_packages="$(python3 -c 'import json,os; print(" ".join(p["package"]+"="+p["version"] for p in json.load(open("/tmp/cuda-sources.json"))["platforms"][os.environ["TARGETARCH"]]["packages"].values()))')" && \
    apt-get install -y --no-install-recommends $cuda_packages && rm -rf /var/lib/apt/lists/*; fi
# Exact r29 archive checksum from Google's repository2-3.xml. Android builds use
# Bionic and API 28, never a glibc Linux binary relabelled as a Termux binary.
RUN if [ "$TARGETOS" = android ]; then \
    curl -fL --retry 3 https://dl.google.com/android/repository/android-ndk-r29-linux.zip -o /tmp/ndk.zip && \
    printf '87e2bb7e9be5d6a1c6cdf5ec40dd4e0c6d07c30b  /tmp/ndk.zip\n' | sha1sum -c - && \
    unzip -q /tmp/ndk.zip -d /opt && rm /tmp/ndk.zip && \
    mkdir /opt/vulkan-headers && cp -a /usr/include/vulkan /usr/include/vk_video /usr/include/spirv /opt/vulkan-headers/; fi
ENV PATH=/usr/local/cuda-12.9/bin:${PATH} CUDAToolkit_ROOT=/usr/local/cuda-12.9
ENV CCACHE_DIR=/cache/ccache CCACHE_MAXSIZE=0 CCACHE_COMPILERCHECK=content npm_config_cache=/cache/npm
FROM builder AS build
ARG ENGINE
ARG BACKEND
ARG SOURCE_COMMIT
ARG UPSTREAM_VERSION
ARG RELEASE_TAG
ARG BUILDER_COMMIT
ARG RELEASE_REPOSITORY
ARG PUBLISH_TAG
ARG TARGETOS=linux
ARG TARGETARCH
ARG BUILD_JOBS=8
WORKDIR /src
COPY src/ ./
COPY build/ /build-inputs/
COPY LICENSE upstreams.json models.json ORIGIN.json /build-inputs/
RUN --mount=type=cache,target=/cache python3 /build-inputs/package.py
FROM scratch AS artifact
COPY --from=build /out/ /
