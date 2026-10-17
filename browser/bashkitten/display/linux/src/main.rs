// SPDX-License-Identifier: AGPL-3.0-only
//! Persistent private Wayland gateway and disposable native viewport renderer.
mod drm_syncobj;
mod gateway;
mod gpu;
mod guest_display;
mod keyboard;
mod wire;
use anyhow::{Context, Result, ensure};
use gateway::*;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::Write,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::{
            fs::PermissionsExt,
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
};
use wire::Message;

fn main() {
    if let Err(e) = run() {
        eprintln!("bashkitten-display: {e:#}");
        std::process::exit(1)
    }
}
fn run() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    let arg = |name: &str| -> Result<String> {
        args.windows(2)
            .find(|p| p[0] == name)
            .map(|p| p[1].clone())
            .with_context(|| format!("missing {name}"))
    };
    match args.get(1).map(String::as_str) {
        Some("gateway") => run_gateway(
            Path::new(&arg("--directory")?),
            arg("--width")?.parse()?,
            arg("--height")?.parse()?,
            args.windows(2)
                .find(|p| p[0] == "--drm-render-node")
                .map(|p| PathBuf::from(&p[1])),
            args.windows(2)
                .find(|p| p[0] == "--formats-file")
                .map(|p| PathBuf::from(&p[1])),
        ),
        Some("renderer") => run_renderer(Path::new(&arg("--gateway")?), arg("--host-fd")?.parse()?),
        _ => anyhow::bail!(
            "expected gateway --directory PATH --width N --height N [--drm-render-node PATH] or renderer --gateway PATH --host-fd FD"
        ),
    }
}
struct Commands {
    tx: mpsc::Sender<GatewayCommand>,
    wake: UnixStream,
}
impl Commands {
    fn send(&mut self, c: GatewayCommand) -> Result<()> {
        self.tx.send(c)?;
        match self.wake.write(&[1]) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}
fn release(commands: &mut Commands, id: u64) {
    let _ = commands.send(GatewayCommand::ReleaseFrame {
        id,
        released_monotonic_us: wire::monotonic_us(),
    });
}
fn release_input(
    commands: &mut Commands,
    buttons: &mut HashSet<u32>,
    generation: u64,
) -> Result<()> {
    for button in buttons.drain() {
        commands.send(GatewayCommand::PointerButton {
            button,
            pressed: false,
            geometry_generation: generation,
        })?;
    }
    commands.send(GatewayCommand::KeyboardLeave)?;
    commands.send(GatewayCommand::PointerLeave)
}
fn run_gateway(
    directory: &Path,
    width: u32,
    height: u32,
    mut drm: Option<PathBuf>,
    formats_file: Option<PathBuf>,
) -> Result<()> {
    ensure!(
        directory.is_absolute(),
        "display directory must be absolute"
    );
    fs::create_dir_all(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let guest_directory = directory.join("guest");
    fs::create_dir_all(&guest_directory)?;
    fs::set_permissions(&guest_directory, fs::Permissions::from_mode(0o700))?;
    let wayland = guest_directory.join("wayland-0");
    let presenter = directory.join("presenter.sock");
    // Lifecycle owner removes stale sockets only after validating dead PID/start identity.
    let guest = UnixListener::bind(&wayland).context("bind private Wayland socket")?;
    fs::set_permissions(&wayland, fs::Permissions::from_mode(0o600))?;
    let listener = wire::listener(&presenter)?;
    let (tx, rx) = mpsc::sync_channel(4);
    let (ctx, crx) = mpsc::channel();
    let (read, write) = UnixStream::pair()?;
    read.set_nonblocking(true)?;
    write.set_nonblocking(true)?;
    let mut commands = Commands {
        tx: ctx,
        wake: write,
    };
    let events = EventSender(tx);
    let mode = OutputMode::new(width, height, 1)?;
    // Startup consumes capabilities previously supplied by the native Firefox
    // receiver. Software fallback is explicit and never overwrites GPU config.
    let mut fallback_reason: Option<String> = None;
    let mut formats = Vec::new();
    if let Some(device) = drm.as_deref() {
        let result = (|| -> Result<Vec<DmabufFormat>> {
            let path = formats_file
                .as_ref()
                .context("native receiver capabilities are unavailable")?;
            let value: serde_json::Value = serde_json::from_slice(&fs::read(path)?)?;
            let formats: Vec<DmabufFormat> = serde_json::from_value(if value.is_array() {
                value
            } else {
                value["formats"].clone()
            })?;
            ensure!(
                !formats.is_empty(),
                "native receiver has no supported GPU formats"
            );
            let probe = gpu::Gpu::open(device)?;
            probe.validate_formats(&formats)?;
            Ok(formats)
        })();
        match result {
            Ok(actual) => formats = actual,
            Err(error) => {
                fallback_reason = Some(format!("{error:#}"));
                drm = None;
            }
        }
    }
    let accelerated = drm.is_some();
    let guest_drm = drm.clone();
    thread::Builder::new()
        .name("display-wayland".into())
        .spawn(move || {
            let result = guest_display::run(
                guest,
                events.clone(),
                crx,
                read,
                if accelerated { 4 } else { 0 },
                guest_drm,
                PathBuf::from("/usr/share/X11/xkb"),
            );
            if let Err(e) = result {
                let _ = events.send(GatewayEvent::GuestFailed(format!("{e:#}")));
            }
        })?;
    let initial_formats = formats.clone();
    commands.send(GatewayCommand::Configure { formats, mode })?;
    match rx.recv()? {
        GatewayEvent::NativeReady => {}
        GatewayEvent::GuestFailed(error) => anyhow::bail!(error),
        _ => anyhow::bail!("invalid display initialization state"),
    }
    fs::write(
        directory.join("ready.json"),
        serde_json::to_vec(
            &serde_json::json!({"schema":1,"pid":std::process::id(),"waylandSocket":wayland,"presenterSocket":presenter,"mode":if accelerated{"gpu"}else{"software"},"fallbackReason":fallback_reason}),
        )?,
    )?;
    let mut latest: Option<DmabufFrame> = None;
    let mut client: Option<OwnedFd> = None;
    let mut held = HashMap::new();
    let mut buttons = HashSet::new();
    let mut cursors = HashSet::new();
    let mut generation = 1;
    let mut visible = true;
    loop {
        let mut poll = [
            libc::pollfd {
                fd: listener.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: client.as_ref().map_or(-1, AsRawFd::as_raw_fd),
                events: libc::POLLIN,
                revents: 0,
            },
        ];
        // The gateway alone paces a detached desktop; no browser/UI polling.
        unsafe { libc::poll(poll.as_mut_ptr(), poll.len() as _, 16) };
        let mut disconnect = false;
        if poll[0].revents & libc::POLLIN != 0 {
            let fd = unsafe {
                libc::accept4(
                    listener.as_raw_fd(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK,
                )
            };
            if fd >= 0 {
                let fd = unsafe { OwnedFd::from_raw_fd(fd) };
                if wire::verify_peer(fd.as_raw_fd()).is_ok() {
                    if client.is_some() {
                        let _ = wire::send(
                            fd.as_raw_fd(),
                            &Message::Error {
                                message: "Display already attached".into(),
                            },
                            &[],
                        );
                    } else {
                        client = Some(fd);
                        visible = true;
                    }
                }
            }
        }
        if let Some(fd) = client.as_ref() {
            if poll[1].revents & (libc::POLLHUP | libc::POLLERR) != 0 {
                disconnect = true;
            }
            loop {
                match wire::receive(fd.as_raw_fd()) {
                    Ok(Some((message, fds))) => {
                        if !fds.is_empty() {
                            disconnect = true;
                            break;
                        }
                        let result = (|| -> Result<()> {
                            match message {
                                Message::Attach {
                                    version, formats, ..
                                } => {
                                    if version != 1
                                        || (accelerated
                                            && initial_formats.iter().any(|required| {
                                                !formats.iter().any(|actual| {
                                                    actual.fourcc == required.fourcc
                                                        && actual.modifier == required.modifier
                                                })
                                            }))
                                    {
                                        anyhow::bail!(
                                            "native receiver is incompatible with the running display; restart required"
                                        )
                                    }
                                    wire::send(
                                        fd.as_raw_fd(),
                                        &Message::Ready {
                                            fallback_reason: fallback_reason.clone(),
                                            mode: if accelerated { "gpu" } else { "software" }
                                                .into(),
                                        },
                                        &[],
                                    )
                                }
                                Message::Resize {
                                    width,
                                    height,
                                    generation: g,
                                } => {
                                    let m = OutputMode::new(width, height, g)?;
                                    generation = g;
                                    commands.send(GatewayCommand::SetOutputMode(m))?;
                                    if let Some(frame) = latest.as_mut().filter(|f| {
                                        visible && f.width == width && f.height == height
                                    }) {
                                        frame.geometry_generation = g;
                                        if !held.contains_key(&frame.id) {
                                            send_frame(fd.as_raw_fd(), frame)?;
                                            held.insert(frame.id, g);
                                        }
                                    }
                                    Ok(())
                                }
                                Message::Visible { visible: value } => {
                                    visible = value;
                                    if !visible {
                                        release_input(&mut commands, &mut buttons, generation)?;
                                    } else if let Some(frame) = latest.as_ref().filter(|f| {
                                        f.geometry_generation == generation
                                            && !held.contains_key(&f.id)
                                    }) {
                                        send_frame(fd.as_raw_fd(), frame)?;
                                        held.insert(frame.id, frame.geometry_generation);
                                    }
                                    Ok(())
                                }
                                Message::Focus { focused: true } => {
                                    commands.send(GatewayCommand::KeyboardEnter)
                                }
                                Message::Focus { focused: false } => {
                                    release_input(&mut commands, &mut buttons, generation)
                                }
                                Message::Pointer { x, y, generation } => {
                                    commands.send(GatewayCommand::PointerMotion {
                                        x,
                                        y,
                                        geometry_generation: generation,
                                    })
                                }
                                Message::Button {
                                    button,
                                    pressed,
                                    generation,
                                } => {
                                    if pressed {
                                        buttons.insert(button);
                                    } else {
                                        buttons.remove(&button);
                                    }
                                    commands.send(GatewayCommand::PointerButton {
                                        button,
                                        pressed,
                                        geometry_generation: generation,
                                    })
                                }
                                Message::Wheel {
                                    horizontal,
                                    vertical,
                                    generation,
                                } => commands.send(GatewayCommand::PointerAxis {
                                    horizontal,
                                    vertical,
                                    geometry_generation: generation,
                                }),
                                Message::Key {
                                    key,
                                    pressed,
                                    modifiers,
                                } => commands.send(GatewayCommand::KeyboardKey {
                                    key,
                                    pressed,
                                    modifiers,
                                }),
                                Message::ReleaseCursor { id } => {
                                    if cursors.remove(&id) {
                                        commands.send(GatewayCommand::ReleaseCursor { id })?;
                                    }
                                    Ok(())
                                }
                                Message::Release { id } => {
                                    if let Some(sent_generation) = held.remove(&id) {
                                        if latest.as_ref().is_none_or(|f| f.id != id) {
                                            release(&mut commands, id);
                                        }
                                        // Drain a retained frame after backpressure, or a
                                        // resize that retagged this frame while its previous
                                        // generation was in flight. The renderer must never
                                        // receive the same ID with two outstanding leases.
                                        if let Some(frame) = latest.as_ref().filter(|f| {
                                            visible
                                                && held.len() < 3
                                                && f.geometry_generation == generation
                                                && !held.contains_key(&f.id)
                                                && (f.id != id
                                                    || f.geometry_generation != sent_generation)
                                        }) {
                                            send_frame(fd.as_raw_fd(), frame)?;
                                            held.insert(frame.id, frame.geometry_generation);
                                        }
                                    }
                                    Ok(())
                                }
                                Message::Tick { time_us } => {
                                    commands.send(GatewayCommand::FrameTick {
                                        frame_time_us: time_us,
                                    })
                                }
                                Message::Ping => wire::send(fd.as_raw_fd(), &Message::Pong, &[]),
                                Message::Detach => {
                                    disconnect = true;
                                    Ok(())
                                }
                                _ => anyhow::bail!("unexpected presenter message"),
                            }
                        })();
                        if let Err(e) = result {
                            let _ = wire::send(
                                fd.as_raw_fd(),
                                &Message::Error {
                                    message: format!("{e:#}"),
                                },
                                &[],
                            );
                        }
                    }
                    Ok(None) => break,
                    Err(_) => {
                        disconnect = true;
                        break;
                    }
                }
            }
        }
        if disconnect {
            client = None;
            for id in cursors.drain() {
                commands.send(GatewayCommand::ReleaseCursor { id })?;
            }
            for (id, _) in held.drain() {
                if latest.as_ref().is_none_or(|f| f.id != id) {
                    release(&mut commands, id)
                }
            }
            release_input(&mut commands, &mut buttons, generation)?;
        }
        for event in rx.try_iter() {
            match event {
                GatewayEvent::GuestFrame(frame) => {
                    if let Some(previous) = latest.replace(frame) {
                        if !held.contains_key(&previous.id) {
                            release(&mut commands, previous.id);
                        }
                    }
                    let frame = latest.as_ref().unwrap();
                    if let Some(fd) = client.as_ref().filter(|_| {
                        visible && held.len() < 3 && frame.geometry_generation == generation
                    }) {
                        if send_frame(fd.as_raw_fd(), frame).is_ok() {
                            held.insert(frame.id, frame.geometry_generation);
                        }
                    }
                    // Keep one guest lease for an immediate, current reattachment.
                    // New commits replace it and release the previous unreferenced
                    // lease, so a detached desktop continues using its other buffers.
                }
                GatewayEvent::GuestCursor(image) => {
                    let mut sent = false;
                    if let Some(fd) = client.as_ref().filter(|_| visible && cursors.len() < 3) {
                        let (shm, fourcc, modifier, planes) = match image.storage {
                            CursorStorage::Shm { stride, pixels } => (
                                true,
                                u32::from_le_bytes(*b"AR24"),
                                0,
                                vec![DmabufPlane {
                                    fd: sealed(&pixels)?,
                                    stride: stride as u32,
                                    offset: 0,
                                }],
                            ),
                            CursorStorage::Dmabuf {
                                fourcc,
                                modifier,
                                planes,
                            } => (false, fourcc, modifier, planes),
                        };
                        sent = wire::send(
                            fd.as_raw_fd(),
                            &Message::Cursor {
                                id: image.id,
                                width: image.width,
                                height: image.height,
                                hotspot_x: image.hotspot_x,
                                hotspot_y: image.hotspot_y,
                                fourcc,
                                modifier,
                                strides: planes.iter().map(|p| p.stride).collect(),
                                offsets: planes.iter().map(|p| p.offset).collect(),
                                shm,
                                png: false,
                            },
                            &planes.iter().map(|p| p.fd.as_raw_fd()).collect::<Vec<_>>(),
                        )
                        .is_ok();
                    }
                    if sent && image.id != 0 {
                        cursors.insert(image.id);
                    }
                    if !sent && image.id != 0 {
                        commands.send(GatewayCommand::ReleaseCursor { id: image.id })?;
                    }
                }
                GatewayEvent::GuestCursorHidden | GatewayEvent::GuestCursorFallback => {
                    let state = if matches!(event, GatewayEvent::GuestCursorHidden) {
                        "hidden"
                    } else {
                        "default"
                    };
                    if let Some(fd) = client.as_ref() {
                        let _ = wire::send(
                            fd.as_raw_fd(),
                            &Message::CursorState {
                                state: state.into(),
                            },
                            &[],
                        );
                    }
                }
                GatewayEvent::GuestFailed(message) => {
                    eprintln!("display: {message}");
                    if let Some(fd) = client.as_ref() {
                        let _ = wire::send(fd.as_raw_fd(), &Message::Error { message }, &[]);
                    }
                }
                _ => {}
            }
        }
        commands.send(GatewayCommand::FrameTick {
            frame_time_us: wire::monotonic_us() as i64,
        })?;
    }
}
fn send_frame(fd: i32, frame: &DmabufFrame) -> Result<()> {
    let msg = Message::Frame {
        id: frame.id,
        generation: frame.geometry_generation,
        width: frame.width,
        height: frame.height,
        fourcc: frame.fourcc,
        modifier: frame.modifier,
        strides: frame.planes.iter().map(|p| p.stride).collect(),
        offsets: frame.planes.iter().map(|p| p.offset).collect(),
        shm: frame.shm,
    };
    wire::send(
        fd,
        &msg,
        &frame
            .planes
            .iter()
            .map(|p| p.fd.as_raw_fd())
            .collect::<Vec<_>>(),
    )
}
fn sealed(bytes: &[u8]) -> Result<OwnedFd> {
    let fd = unsafe {
        libc::memfd_create(
            c"bashkitten-image".as_ptr(),
            libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
        )
    };
    ensure!(fd >= 0, "image allocation failed");
    let mut file = unsafe { fs::File::from_raw_fd(fd) };
    file.write_all(bytes)?;
    ensure!(
        unsafe {
            libc::fcntl(
                fd,
                libc::F_ADD_SEALS,
                libc::F_SEAL_WRITE | libc::F_SEAL_GROW | libc::F_SEAL_SHRINK | libc::F_SEAL_SEAL,
            )
        } == 0,
        "image sealing failed"
    );
    Ok(file.into())
}
fn run_renderer(path: &Path, host: i32) -> Result<()> {
    let host = unsafe { OwnedFd::from_raw_fd(host) };
    wire::verify_peer(host.as_raw_fd())?;
    let result = (|| -> Result<()> {
        let guest = wire::connect(path)?;
        let mut gpu: Option<gpu::Gpu> = None;
        let mut drm = String::new();
        let mut snapshots = HashSet::new();
        let mut output_formats = Vec::new();
        loop {
            let mut poll = [
                libc::pollfd {
                    fd: host.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                },
                libc::pollfd {
                    fd: guest.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                },
            ];
            ensure!(
                unsafe { libc::poll(poll.as_mut_ptr(), 2, -1) } >= 0,
                "renderer poll failed"
            );
            for index in 0..2 {
                if poll[index].revents & (libc::POLLERR | libc::POLLHUP) != 0 {
                    return Ok(());
                }
                if poll[index].revents & libc::POLLIN == 0 {
                    continue;
                }
                while let Some((mut msg, mut fds)) = wire::receive(poll[index].fd)? {
                    if index == 1 {
                        if let Message::Frame { id, .. } = &msg {
                            if snapshots.len() >= 3 || snapshots.contains(id) {
                                wire::send(guest.as_raw_fd(), &Message::Release { id: *id }, &[])?;
                                continue;
                            }
                            snapshots.insert(*id);
                        }
                        if let Message::Cursor {
                            id,
                            width,
                            height,
                            fourcc,
                            modifier,
                            strides,
                            offsets,
                            shm,
                            png,
                            ..
                        } = &mut msg
                        {
                            ensure!(
                                *width > 0
                                    && *height > 0
                                    && *width <= 512
                                    && *height <= 512
                                    && !fds.is_empty(),
                                "invalid cursor"
                            );
                            let mut pixels = if *shm {
                                ensure!(
                                    fds.len() == 1
                                        && strides.len() == 1
                                        && offsets.len() == 1
                                        && strides[0] >= *width * 4,
                                    "invalid cursor stride"
                                );
                                let mut pixels = vec![0u8; *width as usize * *height as usize * 4];
                                for (y, row) in
                                    pixels.chunks_exact_mut(*width as usize * 4).enumerate()
                                {
                                    let off = offsets[0] as u64 + y as u64 * strides[0] as u64;
                                    ensure!(
                                        unsafe {
                                            libc::pread(
                                                fds[0].as_raw_fd(),
                                                row.as_mut_ptr().cast(),
                                                row.len(),
                                                off as _,
                                            )
                                        } == row.len() as isize,
                                        "truncated cursor"
                                    );
                                    for pixel in row.chunks_exact_mut(4) {
                                        pixel.swap(0, 2);
                                    }
                                }
                                pixels
                            } else {
                                if gpu.is_none() {
                                    gpu = Some(gpu::Gpu::open(Path::new(&drm))?);
                                }
                                gpu.as_ref().unwrap().pixels(
                                    *width, *height, *fourcc, *modifier, &fds, strides, offsets,
                                )?
                            };
                            // Wayland ARGB is premultiplied; PNG stores straight alpha.
                            for pixel in pixels.chunks_exact_mut(4) {
                                let alpha = pixel[3] as u32;
                                if alpha > 0 {
                                    for value in &mut pixel[..3] {
                                        *value = ((*value as u32 * 255 + alpha / 2) / alpha)
                                            .min(255)
                                            as u8;
                                    }
                                }
                            }
                            let mut encoded = Vec::new();
                            {
                                let mut encoder = png::Encoder::new(&mut encoded, *width, *height);
                                encoder.set_color(png::ColorType::Rgba);
                                encoder.set_depth(png::BitDepth::Eight);
                                encoder.write_header()?.write_image_data(&pixels)?;
                            }
                            fds = vec![sealed(&encoded)?];
                            *png = true;
                            if *id != 0 {
                                wire::send(
                                    guest.as_raw_fd(),
                                    &Message::ReleaseCursor { id: *id },
                                    &[],
                                )?;
                            }
                        }
                        if let Message::Frame {
                            width,
                            height,
                            fourcc,
                            modifier,
                            strides,
                            offsets,
                            shm,
                            ..
                        } = &mut msg
                        {
                            ensure!(
                                *width > 0
                                    && *height > 0
                                    && fds.len() == strides.len()
                                    && fds.len() == offsets.len()
                                    && !fds.is_empty(),
                                "invalid frame descriptor"
                            );
                            ensure!(
                                *fourcc == u32::from_le_bytes(*b"AR24")
                                    || *fourcc == u32::from_le_bytes(*b"XR24"),
                                "unsupported frame format"
                            );
                            if *shm {
                                ensure!(fds.len() == 1, "software frame must have one plane");
                                let row = width.checked_mul(4).context("row overflow")?;
                                ensure!(strides[0] >= row, "short row");
                                let size = (row as u64)
                                    .checked_mul(*height as u64)
                                    .context("frame overflow")?;
                                let fd = unsafe {
                                    libc::memfd_create(
                                        c"bashkitten-frame".as_ptr(),
                                        libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
                                    )
                                };
                                ensure!(fd >= 0, "frame allocation failed");
                                let mut out = unsafe { fs::File::from_raw_fd(fd) };
                                let mut pixels = vec![0u8; row as usize];
                                for y in 0..*height {
                                    let off = offsets[0] as u64 + y as u64 * strides[0] as u64;
                                    let n = unsafe {
                                        libc::pread(
                                            fds[0].as_raw_fd(),
                                            pixels.as_mut_ptr().cast(),
                                            pixels.len(),
                                            off as _,
                                        )
                                    };
                                    ensure!(n == row as isize, "software frame truncated");
                                    if *fourcc == u32::from_le_bytes(*b"XR24") {
                                        for pixel in pixels.chunks_exact_mut(4) {
                                            pixel[3] = 255;
                                        }
                                    }
                                    out.write_all(&pixels)?;
                                }
                                ensure!(
                                    out.metadata()?.len() == size,
                                    "software frame size mismatch"
                                );
                                ensure!(
                                    unsafe {
                                        libc::fcntl(
                                            out.as_raw_fd(),
                                            libc::F_ADD_SEALS,
                                            libc::F_SEAL_WRITE
                                                | libc::F_SEAL_GROW
                                                | libc::F_SEAL_SHRINK
                                                | libc::F_SEAL_SEAL,
                                        )
                                    } == 0,
                                    "frame sealing failed"
                                );
                                fds = vec![out.into()];
                                strides[0] = row;
                                offsets[0] = 0;
                            } else {
                                if gpu.is_none() {
                                    gpu = Some(gpu::Gpu::open(Path::new(&drm))?);
                                }
                                let (output_fds, output_strides, output_offsets, output_modifier) =
                                    gpu.as_ref().unwrap().snapshot(
                                        *width,
                                        *height,
                                        *fourcc,
                                        *modifier,
                                        &fds,
                                        strides,
                                        offsets,
                                        &output_formats,
                                    )?;
                                fds = output_fds;
                                *strides = output_strides;
                                *offsets = output_offsets;
                                *modifier = output_modifier;
                                // Keep the guest lease until the host releases this
                                // snapshot, as on the software path. Releasing it
                                // here permits the gateway to resend the same ID
                                // while snapshots still marks it as outstanding.
                            }
                        }
                    } else {
                        ensure!(fds.is_empty(), "host command must not carry descriptors");
                        if let Message::Release { id } = &msg {
                            snapshots.remove(id);
                        }
                        if let Message::Attach {
                            drm_render_node,
                            formats,
                            ..
                        } = &msg
                        {
                            drm = drm_render_node.clone();
                            output_formats = formats.clone();
                        }
                    }
                    wire::send(
                        poll[1 - index].fd,
                        &msg,
                        &fds.iter().map(AsRawFd::as_raw_fd).collect::<Vec<_>>(),
                    )?;
                }
            }
        }
    })();
    if let Err(error) = &result {
        let _ = wire::send(
            host.as_raw_fd(),
            &Message::Error {
                message: format!("{error:#}"),
            },
            &[],
        );
    }
    result
}
