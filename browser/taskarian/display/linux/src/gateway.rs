// SPDX-License-Identifier: AGPL-3.0-only
// Types adapted from BuzzardOS 6c1b89f25c196ae7ab4a8f20e166b27e4ee94cc0.
// Original AGPL-3.0-or-later notices remain in ../vendor/buzzardos.
use crate::keyboard::{KeyboardMapReply, KeyboardMapRequest};
use anyhow::{Context, Result};
use std::{os::fd::OwnedFd, sync::mpsc::SyncSender};

#[derive(Debug)]
pub enum GatewayEvent {
    NativeReady,
    GuestConnected,
    GuestDisconnected,
    GuestFailed(String),
    GuestFrame(DmabufFrame),
    GuestCursor(CursorImage),
    GuestCursorFallback,
    GuestCursorHidden,
    FrameReleased { id: u64, held_us: u64 },
}
#[derive(Debug)]
pub struct CursorImage {
    pub id: u64,
    pub width: u32,
    pub height: u32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
    pub storage: CursorStorage,
}
#[derive(Debug)]
pub enum CursorStorage {
    Shm {
        stride: usize,
        pixels: Vec<u8>,
    },
    Dmabuf {
        fourcc: u32,
        modifier: u64,
        planes: Vec<DmabufPlane>,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DmabufFormat {
    pub fourcc: u32,
    #[serde(with = "modifier_string")]
    pub modifier: u64,
}
// JavaScript must not round 64-bit DRM modifiers while saving capabilities.
mod modifier_string {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Value {
            Text(String),
            Number(u64),
        }
        match Value::deserialize(deserializer)? {
            Value::Number(value) => Ok(value),
            Value::Text(value) => value.parse().map_err(serde::de::Error::custom),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputMode {
    pub logical_width: u32,
    pub logical_height: u32,
    pub physical_width: u32,
    pub physical_height: u32,
    pub host_surface_scale_120: u32,
    pub guest_ui_scale_120: u32,
    pub geometry_generation: u64,
    pub refresh_mhz: u32,
}
impl OutputMode {
    pub fn new(width: u32, height: u32, generation: u64) -> Result<Self> {
        anyhow::ensure!(
            width > 0 && height > 0 && width <= i32::MAX as u32 && height <= i32::MAX as u32,
            "invalid native viewport dimensions"
        );
        width
            .checked_mul(4)
            .and_then(|s| s.checked_mul(height))
            .context("viewport byte size overflow")?;
        Ok(Self {
            logical_width: width,
            logical_height: height,
            physical_width: width,
            physical_height: height,
            host_surface_scale_120: 120,
            guest_ui_scale_120: 120,
            geometry_generation: generation,
            refresh_mhz: 60000,
        })
    }
}
#[derive(Debug)]
pub struct DmabufPlane {
    pub fd: OwnedFd,
    pub offset: u32,
    pub stride: u32,
}
#[derive(Debug)]
pub struct DmabufFrame {
    pub id: u64,
    pub geometry_generation: u64,
    pub width: u32,
    pub height: u32,
    pub fourcc: u32,
    pub modifier: u64,
    pub planes: Vec<DmabufPlane>,
    pub submitted_monotonic_us: u64,
    pub explicit_sync: bool,
    pub acquire_wait_us: u64,
    pub shm: bool,
}
#[derive(Debug)]
pub enum GatewayCommand {
    Configure {
        formats: Vec<DmabufFormat>,
        mode: OutputMode,
    },
    SetOutputMode(OutputMode),
    ReleaseFrame {
        id: u64,
        released_monotonic_us: u64,
    },
    ReleaseCursor {
        id: u64,
    },
    FramePainted {
        id: u64,
        frame_time_us: i64,
    },
    FramePresented {
        id: u64,
        presentation_time_us: i64,
        refresh_interval_us: i64,
        sequence: u64,
        offloaded: bool,
    },
    FrameTick {
        frame_time_us: i64,
    },
    PointerEnter {
        x: f64,
        y: f64,
        geometry_generation: u64,
    },
    PointerLeave,
    PointerMotion {
        x: f64,
        y: f64,
        geometry_generation: u64,
    },
    PointerButton {
        button: u32,
        pressed: bool,
        geometry_generation: u64,
    },
    PointerAxis {
        horizontal: f64,
        vertical: f64,
        geometry_generation: u64,
    },
    KeyboardEnter,
    KeyboardLeave,
    KeyboardKey {
        key: u32,
        pressed: bool,
        modifiers: u32,
    },
    KeyboardMap {
        request: KeyboardMapRequest,
        reply: SyncSender<KeyboardMapReply>,
    },
}
#[derive(Clone, Debug)]
pub struct EventSender(pub SyncSender<GatewayEvent>);
impl EventSender {
    pub fn send(&self, event: GatewayEvent) -> Result<()> {
        self.0.send(event).context("display owner stopped")
    }
}
