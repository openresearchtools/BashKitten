// SPDX-License-Identifier: AGPL-3.0-only
//! Private local packet/FD protocol; no network listener or web transport.
use crate::gateway::DmabufFormat;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    ffi::CString,
    io, mem,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::ffi::OsStrExt,
    },
    path::Path,
};
pub const MAX_PACKET: usize = 65536;
pub const MAX_FDS: usize = 4;
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Message {
    Attach {
        version: u32,
        formats: Vec<DmabufFormat>,
        #[serde(rename = "drmRenderNode")]
        drm_render_node: String,
    },
    Ready {
        mode: String,
        #[serde(rename = "fallbackReason")]
        fallback_reason: Option<String>,
    },
    Error {
        message: String,
    },
    Resize {
        width: u32,
        height: u32,
        generation: u64,
    },
    Focus {
        focused: bool,
    },
    Visible {
        visible: bool,
    },
    Pointer {
        x: f64,
        y: f64,
        generation: u64,
    },
    Button {
        button: u32,
        pressed: bool,
        generation: u64,
    },
    Wheel {
        horizontal: f64,
        vertical: f64,
        generation: u64,
    },
    Key {
        key: u32,
        pressed: bool,
        modifiers: u32,
    },
    Frame {
        id: u64,
        generation: u64,
        width: u32,
        height: u32,
        fourcc: u32,
        modifier: u64,
        strides: Vec<u32>,
        offsets: Vec<u32>,
        shm: bool,
    },
    Cursor {
        id: u64,
        width: u32,
        height: u32,
        hotspot_x: i32,
        hotspot_y: i32,
        fourcc: u32,
        modifier: u64,
        strides: Vec<u32>,
        offsets: Vec<u32>,
        shm: bool,
        png: bool,
    },
    CursorState {
        state: String,
    },
    ReleaseCursor {
        id: u64,
    },
    Release {
        id: u64,
    },
    Tick {
        time_us: i64,
    },
    Ping,
    Pong,
    Detach,
}
pub fn listener(path: &Path) -> Result<OwnedFd> {
    let fd = unsafe {
        libc::socket(
            libc::AF_UNIX,
            libc::SOCK_SEQPACKET | libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK,
            0,
        )
    };
    ensure!(fd >= 0, "socket: {}", io::Error::last_os_error());
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    let (addr, len) = address(path)?;
    ensure!(
        unsafe {
            libc::bind(
                fd.as_raw_fd(),
                (&addr as *const libc::sockaddr_un).cast(),
                len,
            )
        } == 0,
        "bind {}: {}",
        path.display(),
        io::Error::last_os_error()
    );
    let path = CString::new(path.as_os_str().as_bytes())?;
    ensure!(
        unsafe { libc::chmod(path.as_ptr(), 0o600) } == 0,
        "chmod: {}",
        io::Error::last_os_error()
    );
    ensure!(
        unsafe { libc::listen(fd.as_raw_fd(), 1) } == 0,
        "listen: {}",
        io::Error::last_os_error()
    );
    Ok(fd)
}
pub fn connect(path: &Path) -> Result<OwnedFd> {
    let fd = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_SEQPACKET | libc::SOCK_CLOEXEC, 0) };
    ensure!(fd >= 0, "socket: {}", io::Error::last_os_error());
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    let (addr, len) = address(path)?;
    ensure!(
        unsafe {
            libc::connect(
                fd.as_raw_fd(),
                (&addr as *const libc::sockaddr_un).cast(),
                len,
            )
        } == 0,
        "connect {}: {}",
        path.display(),
        io::Error::last_os_error()
    );
    verify_peer(fd.as_raw_fd())?;
    Ok(fd)
}
fn address(path: &Path) -> Result<(libc::sockaddr_un, libc::socklen_t)> {
    let mut a: libc::sockaddr_un = unsafe { mem::zeroed() };
    a.sun_family = libc::AF_UNIX as _;
    let bytes = path.as_os_str().as_bytes();
    ensure!(
        !bytes.contains(&0) && bytes.len() < a.sun_path.len(),
        "invalid private socket path"
    );
    for (out, input) in a.sun_path.iter_mut().zip(bytes) {
        *out = *input as _;
    }
    Ok((
        a,
        (mem::size_of::<libc::sa_family_t>() + bytes.len() + 1) as _,
    ))
}
pub fn verify_peer(fd: i32) -> Result<()> {
    let mut cred: libc::ucred = unsafe { mem::zeroed() };
    let mut len = mem::size_of_val(&cred) as libc::socklen_t;
    ensure!(
        unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut cred as *mut libc::ucred).cast(),
                &mut len,
            )
        } == 0,
        "peer credentials unavailable"
    );
    ensure!(
        cred.uid == unsafe { libc::getuid() },
        "presenter belongs to a different user"
    );
    Ok(())
}
pub fn send(fd: i32, message: &Message, fds: &[i32]) -> Result<()> {
    let bytes = serde_json::to_vec(message)?;
    send_bytes(fd, &bytes, fds)
}
pub fn send_bytes(fd: i32, bytes: &[u8], fds: &[i32]) -> Result<()> {
    ensure!(
        bytes.len() <= MAX_PACKET && fds.len() <= MAX_FDS,
        "packet invalid"
    );
    let mut iov = libc::iovec {
        iov_base: bytes.as_ptr() as *mut _,
        iov_len: bytes.len(),
    };
    let mut control = [0usize; 16];
    let mut msg: libc::msghdr = unsafe { mem::zeroed() };
    msg.msg_iov = &mut iov;
    msg.msg_iovlen = 1;
    if !fds.is_empty() {
        msg.msg_control = control.as_mut_ptr().cast();
        msg.msg_controllen = unsafe { libc::CMSG_SPACE(mem::size_of_val(fds) as _) as usize };
        unsafe {
            let c = libc::CMSG_FIRSTHDR(&msg);
            (*c).cmsg_level = libc::SOL_SOCKET;
            (*c).cmsg_type = libc::SCM_RIGHTS;
            (*c).cmsg_len = libc::CMSG_LEN(mem::size_of_val(fds) as _) as usize;
            std::ptr::copy_nonoverlapping(fds.as_ptr(), libc::CMSG_DATA(c).cast(), fds.len());
        }
    }
    let n = unsafe { libc::sendmsg(fd, &msg, libc::MSG_NOSIGNAL | libc::MSG_DONTWAIT) };
    if n < 0 {
        return Err(io::Error::last_os_error()).context("sending native display packet");
    }
    ensure!(n as usize == bytes.len(), "incomplete display packet");
    Ok(())
}
pub fn receive(fd: i32) -> Result<Option<(Message, Vec<OwnedFd>)>> {
    let mut bytes = vec![0u8; MAX_PACKET];
    let mut control = [0usize; 16];
    let mut iov = libc::iovec {
        iov_base: bytes.as_mut_ptr().cast(),
        iov_len: bytes.len(),
    };
    let mut msg: libc::msghdr = unsafe { mem::zeroed() };
    msg.msg_iov = &mut iov;
    msg.msg_iovlen = 1;
    msg.msg_control = control.as_mut_ptr().cast();
    msg.msg_controllen = mem::size_of_val(&control);
    let n = unsafe { libc::recvmsg(fd, &mut msg, libc::MSG_CMSG_CLOEXEC | libc::MSG_DONTWAIT) };
    if n < 0 {
        let e = io::Error::last_os_error();
        if e.kind() == io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        return Err(e.into());
    }
    ensure!(n > 0, "display peer disconnected");
    let mut fds = Vec::new();
    unsafe {
        let mut c = libc::CMSG_FIRSTHDR(&msg);
        while !c.is_null() {
            if (*c).cmsg_level == libc::SOL_SOCKET && (*c).cmsg_type == libc::SCM_RIGHTS {
                let count = ((*c).cmsg_len - libc::CMSG_LEN(0) as usize) / mem::size_of::<i32>();
                for i in 0..count {
                    fds.push(OwnedFd::from_raw_fd(
                        *libc::CMSG_DATA(c).cast::<i32>().add(i),
                    ));
                }
            }
            c = libc::CMSG_NXTHDR(&msg, c);
        }
    }
    ensure!(
        msg.msg_flags & (libc::MSG_TRUNC | libc::MSG_CTRUNC) == 0 && fds.len() <= MAX_FDS,
        "truncated display packet"
    );
    Ok(Some((serde_json::from_slice(&bytes[..n as usize])?, fds)))
}
pub fn monotonic_us() -> u64 {
    let mut ts: libc::timespec = unsafe { mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    (ts.tv_sec as u64) * 1_000_000 + (ts.tv_nsec as u64) / 1000
}
