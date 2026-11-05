// SPDX-License-Identifier: AGPL-3.0-only
//! The disposable renderer imports/blits on its own EGL context. Its exported
//! buffers never alias a leased Xwayland buffer. GPU waits occur only here.
use crate::gateway::DmabufFormat;
use anyhow::{Context, Result, ensure};
use std::{
    ffi::{c_char, c_int, c_void},
    fs::{File, OpenOptions},
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    path::Path,
    ptr,
};
type Handle = *mut c_void;
#[link(name = "gbm")]
unsafe extern "C" {
    fn gbm_create_device(fd: c_int) -> Handle;
    fn gbm_device_destroy(device: Handle);
    fn gbm_bo_create_with_modifiers2(
        device: Handle,
        width: u32,
        height: u32,
        format: u32,
        modifiers: *const u64,
        count: u32,
        flags: u32,
    ) -> Handle;
    fn gbm_bo_destroy(bo: Handle);
    fn gbm_bo_get_plane_count(bo: Handle) -> c_int;
    fn gbm_bo_get_fd_for_plane(bo: Handle, plane: c_int) -> c_int;
    fn gbm_bo_get_stride_for_plane(bo: Handle, plane: c_int) -> u32;
    fn gbm_bo_get_offset(bo: Handle, plane: c_int) -> u32;
    fn gbm_bo_get_modifier(bo: Handle) -> u64;
}
#[link(name = "EGL")]
unsafe extern "C" {
    fn eglGetProcAddress(name: *const c_char) -> *const c_void;
    fn eglInitialize(display: Handle, major: *mut c_int, minor: *mut c_int) -> u32;
    fn eglBindAPI(api: u32) -> u32;
    fn eglChooseConfig(
        display: Handle,
        attributes: *const c_int,
        configs: *mut Handle,
        size: c_int,
        count: *mut c_int,
    ) -> u32;
    fn eglCreateContext(
        display: Handle,
        config: Handle,
        share: Handle,
        attributes: *const c_int,
    ) -> Handle;
    fn eglMakeCurrent(display: Handle, draw: Handle, read: Handle, context: Handle) -> u32;
    fn eglDestroyContext(display: Handle, context: Handle) -> u32;
    fn eglTerminate(display: Handle) -> u32;
}
#[link(name = "GLESv2")]
unsafe extern "C" {
    fn glGenTextures(count: c_int, textures: *mut u32);
    fn glDeleteTextures(count: c_int, textures: *const u32);
    fn glBindTexture(target: u32, texture: u32);
    fn glTexParameteri(target: u32, pname: u32, param: c_int);
    fn glGenFramebuffers(count: c_int, buffers: *mut u32);
    fn glDeleteFramebuffers(count: c_int, buffers: *const u32);
    fn glBindFramebuffer(target: u32, buffer: u32);
    fn glFramebufferTexture2D(
        target: u32,
        attachment: u32,
        textarget: u32,
        texture: u32,
        level: c_int,
    );
    fn glCheckFramebufferStatus(target: u32) -> u32;
    fn glBlitFramebuffer(
        sx0: c_int,
        sy0: c_int,
        sx1: c_int,
        sy1: c_int,
        dx0: c_int,
        dy0: c_int,
        dx1: c_int,
        dy1: c_int,
        mask: u32,
        filter: u32,
    );
    fn glReadPixels(
        x: c_int,
        y: c_int,
        width: c_int,
        height: c_int,
        format: u32,
        kind: u32,
        pixels: *mut c_void,
    );
    fn glFinish();
    fn glGetError() -> u32;
}
type PlatformDisplay = unsafe extern "C" fn(u32, Handle, *const c_int) -> Handle;
type CreateImage = unsafe extern "C" fn(Handle, Handle, u32, Handle, *const c_int) -> Handle;
type DestroyImage = unsafe extern "C" fn(Handle, Handle) -> u32;
type ImageTarget = unsafe extern "C" fn(u32, Handle);
const NONE: c_int = 0x3038;
const TEXTURE: u32 = 0x0DE1;
const FRAMEBUFFER: u32 = 0x8D40;
pub struct Gpu {
    display: Handle,
    context: Handle,
    device: Handle,
    _drm: File,
    create: CreateImage,
    destroy: DestroyImage,
    target: ImageTarget,
}
struct Allocation {
    bo: Handle,
    fds: Vec<OwnedFd>,
    strides: Vec<u32>,
    offsets: Vec<u32>,
    modifier: u64,
}
impl Drop for Allocation {
    fn drop(&mut self) {
        unsafe {
            gbm_bo_destroy(self.bo);
        }
    }
}
pub type Snapshot = (Vec<OwnedFd>, Vec<u32>, Vec<u32>, u64);
impl Gpu {
    pub fn open(path: &Path) -> Result<Self> {
        unsafe {
            let drm = OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
                .context("opening selected GPU")?;
            let device = gbm_create_device(drm.as_raw_fd());
            ensure!(!device.is_null(), "cannot initialize GBM for selected GPU");
            let get = eglGetProcAddress(c"eglGetPlatformDisplayEXT".as_ptr());
            if get.is_null() {
                gbm_device_destroy(device);
                anyhow::bail!("EGL GBM platform is unavailable")
            }
            let get: PlatformDisplay = std::mem::transmute(get);
            let display = get(0x31D7, device, ptr::null());
            if display.is_null() || eglInitialize(display, ptr::null_mut(), ptr::null_mut()) == 0 {
                gbm_device_destroy(device);
                anyhow::bail!("EGL selected GPU initialization failed")
            }
            let create = eglGetProcAddress(c"eglCreateImageKHR".as_ptr());
            let destroy = eglGetProcAddress(c"eglDestroyImageKHR".as_ptr());
            let target = eglGetProcAddress(c"glEGLImageTargetTexture2DOES".as_ptr());
            if create.is_null() || destroy.is_null() || target.is_null() {
                eglTerminate(display);
                gbm_device_destroy(device);
                anyhow::bail!("EGL image import is unavailable")
            }
            let mut config = ptr::null_mut();
            let mut count = 0;
            let attrs = [0x3033, 0, 0x3040, 0x40, NONE];
            let configured = eglBindAPI(0x30A0) != 0
                && eglChooseConfig(display, attrs.as_ptr(), &mut config, 1, &mut count) != 0
                && count > 0;
            if !configured {
                eglTerminate(display);
                gbm_device_destroy(device);
                anyhow::bail!("GLES3 framebuffer configuration unavailable")
            }
            let context =
                eglCreateContext(display, config, ptr::null_mut(), [0x3098, 3, NONE].as_ptr());
            if context.is_null()
                || eglMakeCurrent(display, ptr::null_mut(), ptr::null_mut(), context) == 0
            {
                if !context.is_null() {
                    eglDestroyContext(display, context);
                }
                eglTerminate(display);
                gbm_device_destroy(device);
                anyhow::bail!("GLES3 offscreen context unavailable")
            }
            Ok(Self {
                display,
                context,
                device,
                _drm: drm,
                create: std::mem::transmute(create),
                destroy: std::mem::transmute(destroy),
                target: std::mem::transmute(target),
            })
        }
    }
    fn image(
        &self,
        width: u32,
        height: u32,
        fourcc: u32,
        modifier: u64,
        fds: &[OwnedFd],
        strides: &[u32],
        offsets: &[u32],
    ) -> Result<Handle> {
        ensure!(
            fds.len() <= 4 && fds.len() == strides.len() && fds.len() == offsets.len(),
            "invalid GPU planes"
        );
        let mut attrs = vec![
            0x3057,
            width as c_int,
            0x3056,
            height as c_int,
            0x3271,
            fourcc as c_int,
        ];
        let fdattrs = [0x3272, 0x3275, 0x3278, 0x3440];
        let modattrs = [0x3443, 0x3445, 0x3447, 0x3449];
        for i in 0..fds.len() {
            attrs.extend([
                fdattrs[i],
                fds[i].as_raw_fd(),
                fdattrs[i] + 1,
                offsets[i] as c_int,
                fdattrs[i] + 2,
                strides[i] as c_int,
            ]);
            if modifier != 0x00ff_ffff_ffff_ffff {
                attrs.extend([
                    modattrs[i],
                    modifier as c_int,
                    modattrs[i] + 1,
                    (modifier >> 32) as c_int,
                ]);
            }
        }
        attrs.push(NONE);
        let image = unsafe {
            (self.create)(
                self.display,
                ptr::null_mut(),
                0x3270,
                ptr::null_mut(),
                attrs.as_ptr(),
            )
        };
        ensure!(!image.is_null(), "EGL DMA-BUF import failed");
        Ok(image)
    }
    pub fn pixels(
        &self,
        width: u32,
        height: u32,
        fourcc: u32,
        modifier: u64,
        fds: &[OwnedFd],
        strides: &[u32],
        offsets: &[u32],
    ) -> Result<Vec<u8>> {
        unsafe {
            ensure!(
                width > 0 && height > 0 && width <= 512 && height <= 512,
                "invalid cursor dimensions"
            );
            let image = self.image(width, height, fourcc, modifier, fds, strides, offsets)?;
            let mut texture = 0;
            let mut framebuffer = 0;
            glGenTextures(1, &mut texture);
            glGenFramebuffers(1, &mut framebuffer);
            let result = (|| -> Result<Vec<u8>> {
                glBindTexture(TEXTURE, texture);
                (self.target)(TEXTURE, image);
                glBindFramebuffer(FRAMEBUFFER, framebuffer);
                glFramebufferTexture2D(FRAMEBUFFER, 0x8CE0, TEXTURE, texture, 0);
                ensure!(
                    glCheckFramebufferStatus(FRAMEBUFFER) == 0x8CD5,
                    "cursor GPU framebuffer incomplete"
                );
                let mut pixels = vec![0u8; width as usize * height as usize * 4];
                glReadPixels(
                    0,
                    0,
                    width as c_int,
                    height as c_int,
                    0x1908,
                    0x1401,
                    pixels.as_mut_ptr().cast(),
                );
                glFinish();
                ensure!(glGetError() == 0, "cursor GPU readback failed");
                Ok(pixels)
            })();
            glDeleteFramebuffers(1, &framebuffer);
            glDeleteTextures(1, &texture);
            (self.destroy)(self.display, image);
            result
        }
    }
    fn allocate(
        &self,
        width: u32,
        height: u32,
        fourcc: u32,
        formats: &[DmabufFormat],
    ) -> Result<Allocation> {
        unsafe {
            let modifiers: Vec<_> = formats
                .iter()
                .filter(|format| format.fourcc == fourcc)
                .map(|format| format.modifier)
                .collect();
            ensure!(
                !modifiers.is_empty(),
                "native receiver cannot import this GPU format"
            );
            let bo = gbm_bo_create_with_modifiers2(
                self.device,
                width,
                height,
                fourcc,
                modifiers.as_ptr(),
                modifiers.len() as u32,
                4,
            );
            ensure!(
                !bo.is_null(),
                "selected GPU cannot allocate a native receiver format"
            );
            let mut allocation = Allocation {
                bo,
                fds: vec![],
                strides: vec![],
                offsets: vec![],
                modifier: gbm_bo_get_modifier(bo),
            };
            ensure!(
                modifiers.contains(&allocation.modifier),
                "GPU returned an unnegotiated modifier"
            );
            let count = gbm_bo_get_plane_count(bo);
            ensure!(count > 0 && count <= 4, "invalid GPU plane count");
            for plane in 0..count {
                let fd = gbm_bo_get_fd_for_plane(bo, plane);
                ensure!(fd >= 0, "GPU plane export failed");
                allocation.fds.push(OwnedFd::from_raw_fd(fd));
                allocation
                    .strides
                    .push(gbm_bo_get_stride_for_plane(bo, plane));
                allocation.offsets.push(gbm_bo_get_offset(bo, plane));
            }
            Ok(allocation)
        }
    }
    pub fn validate_formats(&self, formats: &[DmabufFormat]) -> Result<()> {
        let fourcc: std::collections::HashSet<_> =
            formats.iter().map(|format| format.fourcc).collect();
        for format in fourcc {
            let source = self.allocate(64, 64, format, formats)?;
            self.snapshot(
                64,
                64,
                format,
                source.modifier,
                &source.fds,
                &source.strides,
                &source.offsets,
                formats,
            )?;
        }
        Ok(())
    }
    pub fn snapshot(
        &self,
        width: u32,
        height: u32,
        fourcc: u32,
        modifier: u64,
        fds: &[OwnedFd],
        strides: &[u32],
        offsets: &[u32],
        formats: &[DmabufFormat],
    ) -> Result<Snapshot> {
        unsafe {
            ensure!(
                width <= i32::MAX as u32 && height <= i32::MAX as u32,
                "GPU dimensions overflow"
            );
            let input = self.image(width, height, fourcc, modifier, fds, strides, offsets)?;
            let result = (|| -> Result<Snapshot> {
                let mut output = self.allocate(width, height, fourcc, formats)?;
                let out_image = self.image(
                    width,
                    height,
                    fourcc,
                    output.modifier,
                    &output.fds,
                    &output.strides,
                    &output.offsets,
                )?;
                let mut textures = [0; 2];
                let mut buffers = [0; 2];
                glGenTextures(2, textures.as_mut_ptr());
                glGenFramebuffers(2, buffers.as_mut_ptr());
                let result = (|| -> Result<()> {
                    for i in 0..2 {
                        glBindTexture(TEXTURE, textures[i]);
                        glTexParameteri(TEXTURE, 0x2801, 0x2600);
                        glTexParameteri(TEXTURE, 0x2800, 0x2600);
                        (self.target)(TEXTURE, if i == 0 { input } else { out_image });
                        glBindFramebuffer(FRAMEBUFFER, buffers[i]);
                        glFramebufferTexture2D(FRAMEBUFFER, 0x8CE0, TEXTURE, textures[i], 0);
                        ensure!(
                            glCheckFramebufferStatus(FRAMEBUFFER) == 0x8CD5,
                            "GPU framebuffer import incomplete"
                        );
                    }
                    glBindFramebuffer(0x8CA8, buffers[0]);
                    glBindFramebuffer(0x8CA9, buffers[1]);
                    glBlitFramebuffer(
                        0,
                        0,
                        width as c_int,
                        height as c_int,
                        0,
                        0,
                        width as c_int,
                        height as c_int,
                        0x4000,
                        0x2600,
                    );
                    glFinish();
                    ensure!(glGetError() == 0, "GPU snapshot failed");
                    Ok(())
                })();
                glDeleteFramebuffers(2, buffers.as_ptr());
                glDeleteTextures(2, textures.as_ptr());
                (self.destroy)(self.display, out_image);
                result?;
                Ok((
                    std::mem::take(&mut output.fds),
                    std::mem::take(&mut output.strides),
                    std::mem::take(&mut output.offsets),
                    output.modifier,
                ))
            })();
            (self.destroy)(self.display, input);
            result
        }
    }
}
impl Drop for Gpu {
    fn drop(&mut self) {
        unsafe {
            eglMakeCurrent(
                self.display,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
            );
            eglDestroyContext(self.display, self.context);
            eglTerminate(self.display);
            gbm_device_destroy(self.device);
        }
    }
}
