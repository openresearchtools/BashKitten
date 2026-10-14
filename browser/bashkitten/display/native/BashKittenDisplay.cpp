/* SPDX-License-Identifier: AGPL-3.0-only */
#include "BashKittenDisplay.h"
#include "mozilla/dom/HTMLVideoElement.h"
#include "mozilla/dom/Document.h"
#include "VideoFrameContainer.h"
#include "ImageContainer.h"
#include "DMABUFSurfaceImage.h"
#include "mozilla/layers/LayersSurfaces.h"
#include "mozilla/widget/DMABufSurface.h"
#include "mozilla/gfx/2D.h"
#include "mozilla/gfx/gfxVars.h"
#include "mozilla/gfx/FileHandleWrapper.h"
#include "mozilla/ScopeExit.h"
#include "mozilla/UniquePtr.h"
#include "nsThreadUtils.h"
#include "nsContentUtils.h"
#include "mozilla/BasePrincipal.h"
#include "mozilla/Base64.h"
#include "nsXULAppAPI.h"
#include "base/linux_memfd_defs.h"
#include "json/json.h"
#include <sys/socket.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <poll.h>
#include <spawn.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <errno.h>
#include <array>
#include <vector>

using namespace mozilla;
using namespace mozilla::layers;
using namespace mozilla::gfx;

namespace {
constexpr size_t kMaxPacket = 65536;
constexpr uint32_t kARGB = 0x34325241, kXRGB = 0x34325258;
nsCString Encode(const Json::Value& v) {
  Json::StreamWriterBuilder builder; builder["indentation"] = "";
  return nsCString(Json::writeString(builder, v).c_str());
}
bool Send(int fd, const nsCString& bytes) {
  return send(fd, bytes.get(), bytes.Length(), MSG_DONTWAIT | MSG_NOSIGNAL) == ssize_t(bytes.Length());
}
struct Packet {
  Json::Value value;
  std::vector<int> fds;
  ~Packet() { for (int fd : fds) if (fd >= 0) close(fd); }
};
bool Receive(int fd, Packet& packet) {
  std::array<char, kMaxPacket> data;
  alignas(cmsghdr) char control[CMSG_SPACE(sizeof(int) * 4)]{};
  iovec io{data.data(), data.size()}; msghdr msg{};
  msg.msg_iov = &io; msg.msg_iovlen = 1;
  msg.msg_control = control; msg.msg_controllen = sizeof(control);
  ssize_t length = recvmsg(fd, &msg, MSG_CMSG_CLOEXEC | MSG_DONTWAIT);
  if (length <= 0) return false;
  for (auto* c = CMSG_FIRSTHDR(&msg); c; c = CMSG_NXTHDR(&msg, c)) {
    if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) {
      size_t count = (c->cmsg_len - CMSG_LEN(0)) / sizeof(int);
      int* fds = reinterpret_cast<int*>(CMSG_DATA(c));
      for (size_t i = 0; i < count; ++i) packet.fds.push_back(fds[i]);
    }
  }
  if (msg.msg_flags & (MSG_TRUNC | MSG_CTRUNC)) return false;
  Json::CharReaderBuilder builder; builder["failIfExtra"] = true;
  std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
  std::string error;
  return reader->parse(data.data(), data.data() + length, &packet.value, &error);
}
Json::Value ReleaseFrame(uint64_t id) {
  Json::Value value; value["type"] = "release"; value["id"] = Json::UInt64(id); return value;
}
struct Mapping { void* address; size_t length; };
void Unmap(void* p) { auto* map = static_cast<Mapping*>(p); munmap(map->address, map->length); delete map; }
struct Lease { uint64_t id; RefPtr<DMABufSurface> surface; };
}
NS_IMPL_ISUPPORTS(BashKittenDisplay, nsIBashKittenDisplay)
BashKittenDisplay::BashKittenDisplay() = default;
BashKittenDisplay::~BashKittenDisplay() = default;
NS_IMETHODIMP BashKittenDisplay::Attach(dom::Element* element, const nsACString& socket,
    const nsACString& executable, nsIObserver* observer) {
  MOZ_ASSERT(NS_IsMainThread());
  if (!XRE_IsParentProcess() || !element || !element->NodePrincipal()->IsSystemPrincipal() || mThread) {
    return NS_ERROR_DOM_SECURITY_ERR;
  }
  auto* video = dom::HTMLVideoElement::FromNodeOrNull(element);
  if (!video || socket.IsEmpty() || executable.IsEmpty() || socket[0] != '/' || executable[0] != '/') {
    return NS_ERROR_INVALID_ARG;
  }
  mFrames = video->GetVideoFrameContainer(); mObserver = observer;
  if (!mFrames) return NS_ERROR_NOT_AVAILABLE;
  RefPtr<BashKittenDisplay> self = this;
  return NS_NewNamedThread("BKDisplay", getter_AddRefs(mThread),
      NS_NewRunnableFunction("BashKittenDisplay::Run", [self, socket = nsCString(socket), executable = nsCString(executable)] {
        self->Run(socket, executable);
      }));
}
NS_IMETHODIMP BashKittenDisplay::GetCapabilities(nsACString& result) {
  Json::Value attach; attach["formats"] = Json::arrayValue;
  attach["drmRenderNode"] = gfxVars::DrmRenderDevice().get();
  for (uint64_t modifier : gfxVars::DMABufModifiersARGB()) {
    Json::Value f; f["fourcc"] = kARGB; f["modifier"] = std::to_string(modifier); attach["formats"].append(f);
  }
  for (uint64_t modifier : gfxVars::DMABufModifiersXRGB()) {
    Json::Value f; f["fourcc"] = kXRGB; f["modifier"] = std::to_string(modifier); attach["formats"].append(f);
  }
  result = Encode(attach); return NS_OK;
}
NS_IMETHODIMP BashKittenDisplay::Input(const nsACString& message) {
  MOZ_ASSERT(NS_IsMainThread());
  if (mClosed || !mThread) return NS_ERROR_NOT_AVAILABLE;
  if (message.Length() > kMaxPacket) return NS_ERROR_INVALID_ARG;
  Json::Value value; Json::Reader parser;
  if (!parser.parse(PromiseFlatCString(message).get(), value)) return NS_ERROR_INVALID_ARG;
  const auto type = value["type"].asString();
  if (type == "resize") mGeneration = value["generation"].asUInt64();
  if (type == "visible") mVisible = value["visible"].asBool();
  MutexAutoLock lock(mMutex);
  // Replace only the immediately preceding motion/resize. Ordered buttons and
  // key releases are never dropped or reordered around those boundaries.
  if (!mInputs.IsEmpty() && (type == "pointer" || type == "resize")) {
    Json::Value previous;
    if (parser.parse(mInputs.LastElement().get(), previous) && previous["type"].asString() == type) mInputs.RemoveLastElement();
  }
  if (mInputs.Length() >= 1024) return NS_ERROR_NOT_AVAILABLE;
  mInputs.AppendElement(message);
  return NS_OK;
}
NS_IMETHODIMP BashKittenDisplay::Close() {
  MOZ_ASSERT(NS_IsMainThread());
  mClosed = true;
  if (mFrames) mFrames->GetImageContainer()->ClearImagesFromImageBridge();
  if (mThread) { mThread->AsyncShutdown(); mThread = nullptr; }
  return NS_OK;
}
void BashKittenDisplay::Status(const nsCString& status) {
  RefPtr<BashKittenDisplay> self = this;
  NS_DispatchToMainThread(NS_NewRunnableFunction("BashKittenDisplay::Status", [self, status] {
    const bool stopped = status.EqualsLiteral("{\"type\":\"closed\"}");
    if (stopped && self->mThread) { self->mThread->AsyncShutdown(); self->mThread = nullptr; }
    if ((!self->mClosed || stopped) && self->mObserver) self->mObserver->Observe(self, "bashkitten-display", NS_ConvertUTF8toUTF16(status).get());
    if (stopped) self->mObserver = nullptr;
  }));
}
void BashKittenDisplay::Invalidate() {
  if (mInvalidationPending.exchange(true)) return;
  RefPtr<BashKittenDisplay> self = this;
  NS_DispatchToMainThread(NS_NewRunnableFunction("BashKittenDisplay::Invalidate", [self] {
    self->mInvalidationPending = false;
    if (!self->mClosed && self->mFrames) self->mFrames->Invalidate();
  }));
}
void BashKittenDisplay::Run(nsCString socket, nsCString executable) {
  // The toolbar enables a new renderer only after the old child and channel
  // have actually closed. Teardown and waiting remain on this worker thread.
  auto stopped = MakeScopeExit([&] { Status("{\"type\":\"closed\"}"_ns); });
  int channels[2];
  if (socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, channels)) {
    Status("{\"type\":\"error\",\"message\":\"Cannot create native display channel\"}"_ns); return;
  }
  auto cleanup = MakeScopeExit([&] { close(channels[0]); close(channels[1]); });
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, channels[1], 3);
  if (channels[0] != 3) posix_spawn_file_actions_addclose(&actions, channels[0]);
  char* argv[] = {executable.BeginWriting(), const_cast<char*>("renderer"), const_cast<char*>("--gateway"), socket.BeginWriting(), const_cast<char*>("--host-fd"), const_cast<char*>("3"), nullptr};
  pid_t child = -1;
  // A renderer receives only graphics/cache context, never inherited backend
  // authority, OAuth tokens, remote connection state or host display addresses.
  std::vector<std::string> environment{"LANG=C.UTF-8", "PATH=/usr/bin:/bin"};
  for (const char* key : {"HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "LIBGL_DRIVERS_PATH", "__EGL_VENDOR_LIBRARY_FILENAMES"}) {
    if (const char* value = getenv(key)) environment.emplace_back(std::string(key) + "=" + value);
  }
  std::vector<char*> env;
  for (auto& value : environment) env.push_back(value.data());
  env.push_back(nullptr);
  int error = posix_spawn(&child, executable.get(), &actions, nullptr, argv, env.data());
  posix_spawn_file_actions_destroy(&actions);
  close(channels[1]); channels[1] = -1;
  if (error) { Status("{\"type\":\"error\",\"message\":\"Cannot launch packaged native display renderer\"}"_ns); return; }
  auto reap = MakeScopeExit([&] { kill(child, SIGTERM); while (waitpid(child, nullptr, 0) < 0 && errno == EINTR) {} });
  nsCString capabilities; GetCapabilities(capabilities);
  Json::Value attach; Json::Reader reader;
  reader.parse(capabilities.get(), attach);
  attach["type"] = "attach"; attach["version"] = 1;
  if (!Send(channels[0], Encode(attach))) return;
  std::vector<Lease> leases;
  auto clearFrames = MakeScopeExit([&] { mFrames->GetImageContainer()->ClearImagesFromImageBridge(); });
  bool firstFrame = true;
  const auto started = TimeStamp::Now();
  auto lastReply=started, lastPing=started;
  auto waitingSince=started;
  while (!mClosed) {
    if (!mVisible) waitingSince=TimeStamp::Now();
    if (mVisible && firstFrame && (TimeStamp::Now() - waitingSince).ToSeconds() > 15) {
      Status("{\"type\":\"error\",\"message\":\"The desktop has not produced a frame. Check its display status, then reopen Display.\"}"_ns); break;
    }
    if (mVisible && (TimeStamp::Now()-lastPing).ToSeconds()>2) {
      if ((TimeStamp::Now()-lastReply).ToSeconds()>10) {
        Status("{\"type\":\"error\",\"message\":\"Display renderer is not responding; reopen Display to reconnect.\"}"_ns); break;
      }
      Send(channels[0], "{\"type\":\"ping\"}"_ns); lastPing=TimeStamp::Now();
    } else if (!mVisible) lastReply=TimeStamp::Now();
    {
      nsTArray<nsCString> inputs;
      { MutexAutoLock lock(mMutex); inputs.SwapElements(mInputs); }
      for (const auto& message : inputs) {
        if (!Send(channels[0], message)) { Status("{\"type\":\"error\",\"message\":\"Native display input channel stalled\"}"_ns); return; }
      }
    }
    for (auto it = leases.begin(); it != leases.end();) {
      if (!it->surface->IsGlobalRefSet()) { Send(channels[0], Encode(ReleaseFrame(it->id))); it = leases.erase(it); }
      else ++it;
    }
    pollfd p{channels[0], POLLIN, 0};
    if (poll(&p, 1, 16) < 0 && errno != EINTR) break;
    if (p.revents & (POLLHUP | POLLERR)) { Status("{\"type\":\"error\",\"message\":\"Display renderer stopped; reopen Display to reconnect\"}"_ns); break; }
    if (!(p.revents & POLLIN)) continue;
    Packet packet;
    if (!Receive(channels[0], packet)) { Status("{\"type\":\"error\",\"message\":\"Invalid native display frame\"}"_ns); break; }
    lastReply=TimeStamp::Now();
    auto& v = packet.value;
    if (v["type"].asString()=="pong") continue;
    if (v["type"].asString() == "cursor") {
      struct stat st;
      if (packet.fds.size() != 1 || !v["png"].asBool() || fstat(packet.fds[0], &st) || st.st_size <= 0 || st.st_size > 2 * 1024 * 1024) break;
      nsCString png; png.SetLength(st.st_size);
      if (pread(packet.fds[0], png.BeginWriting(), png.Length(), 0) != ssize_t(png.Length())) break;
      nsCString encoded;
      if (NS_FAILED(Base64Encode(png, encoded))) break;
      v["image"] = std::string("data:image/png;base64,") + encoded.get();
      Status(Encode(v)); continue;
    }
    if (v["type"].asString() != "frame") { Status(Encode(v)); continue; }
    uint32_t width = v["width"].asUInt(), height = v["height"].asUInt(), fourcc = v["fourcc"].asUInt();
    uint64_t id = v["id"].asUInt64();
    if (mClosed || !mVisible || v["generation"].asUInt64() != mGeneration) {
      Send(channels[0], Encode(ReleaseFrame(id))); continue;
    }
    if (!width || !height || width > INT32_MAX / 4 || height > INT32_MAX ||
        (fourcc != kARGB && fourcc != kXRGB) || packet.fds.empty() || packet.fds.size() > 4 ||
        packet.fds.size() != v["strides"].size() || packet.fds.size() != v["offsets"].size()) break;
    RefPtr<Image> image;
    if (v["shm"].asBool()) {
      if (packet.fds.size() != 1 || v["strides"][0].asUInt() != width * 4 || v["offsets"][0].asUInt()) break;
      uint64_t length = uint64_t(width) * height * 4;
      struct stat st;
      int seals = fcntl(packet.fds[0], F_GET_SEALS);
      if (length > SIZE_MAX || fstat(packet.fds[0], &st) || uint64_t(st.st_size) != length ||
          (seals & (F_SEAL_WRITE | F_SEAL_GROW | F_SEAL_SHRINK)) != (F_SEAL_WRITE | F_SEAL_GROW | F_SEAL_SHRINK)) break;
      void* memory = mmap(nullptr, size_t(length), PROT_READ, MAP_SHARED, packet.fds[0], 0);
      if (memory == MAP_FAILED) break;
      auto* mapping = new Mapping{memory, size_t(length)};
      RefPtr<DataSourceSurface> surface = Factory::CreateWrappingDataSourceSurface(
          static_cast<uint8_t*>(memory), width * 4, IntSize(width, height), SurfaceFormat::B8G8R8A8, Unmap, mapping);
      if (!surface) { Unmap(mapping); break; }
      image = new SourceSurfaceImage(surface);
      Send(channels[0], Encode(ReleaseFrame(id))); // Child snapshot no longer refers to guest memory.
    } else {
      nsTArray<uint32_t> widths{width}, heights{height}, strides, offsets, formats;
      nsTArray<uint64_t> modifiers{v["modifier"].asUInt64()};
      nsTArray<NotNull<RefPtr<FileHandleWrapper>>> fds, fences;
      nsTArray<ipc::FileDescriptor> refs;
      for (size_t i = 0; i < packet.fds.size(); ++i) {
        fds.AppendElement(WrapNotNull(new FileHandleWrapper(UniqueFileHandle(packet.fds[i])))); packet.fds[i] = -1;
        strides.AppendElement(v["strides"][Json::ArrayIndex(i)].asUInt());
        offsets.AppendElement(v["offsets"][Json::ArrayIndex(i)].asUInt());
      }
      SurfaceDescriptor desc = SurfaceDescriptorDMABuf(0, fourcc, modifiers, 0, fds, widths, heights,
          widths, heights, formats, strides, offsets, YUVColorSpace::Identity, ColorRange::FULL,
          ColorSpace2::UNKNOWN, TransferFunction::Default, 0, fences, 0, 0, refs, nullptr, false);
      RefPtr<DMABufSurface> surface = DMABufSurface::CreateDMABufSurface(desc);
      if (!surface) { Status("{\"type\":\"error\",\"message\":\"Native GPU import failed; restart this display in software mode\"}"_ns); break; }
      surface->GlobalRefCountCreate();
      image = new DMABUFSurfaceImage(surface);
      leases.push_back({id, surface});
    }
    if (mClosed || !mVisible || v["generation"].asUInt64() != mGeneration) continue;
    mFrames->SetCurrentFrame(IntSize(width, height), image, TimeStamp::Now(),
        media::TimeUnit::Zero(), media::TimeUnit::Zero());
    Invalidate();
    if (firstFrame) { firstFrame = false; Status("{\"type\":\"frame_ready\"}"_ns); }
  }
  mFrames->GetImageContainer()->ClearImagesFromImageBridge();
  // Renderer disconnect returns its outstanding guest leases. This never sends
  // xdg close, stops Xwayland, or invokes the container controller.
}
