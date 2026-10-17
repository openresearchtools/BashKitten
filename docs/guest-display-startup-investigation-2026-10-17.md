# Guest Display startup investigation — 17 October 2026

The earlier black guest-browser startup remains an unresolved failure. This
record supplements the native-environments plan and its frozen baseline
`f71686dcb76402ec43bac3e6a7db8979ef0fb119`; it does not change their requirements
or establish full Display acceptance.

The original Xorg evidence used outer browser/backend
`5151ba20ce574f77f69b43eb1439b93d42202b48`, a retained guest browser/backend
`c1826669d1f14fcfb87453aa85f1ceda82295bc7`, and guest OS
`48f0d3c73f96de302634d869c2992c04b4408a4e`. Two ordinary starts showed a live
taskbar with a black guest-browser region. Ordinary Display Off/On restored the
frame in the first case. The guest journal recorded a forced WebRender reset
during initialization. Preserve that failure and the earlier cab139/26ba143
results; later successful attempts do not invalidate them.

After the workstation reboot, diagnosis used only the existing
`bashkitten-test-debian13-xorg` VM, its real Xorg login, the same installed outer
candidate and retained profile/data, and machine
`0baf64c9-e198-42de-988c-cd95fdce8210` (Xorg 3c35). Old process identifiers were
discarded. No unrelated VM, host desktop input, browser preferences or product
source was changed for the comparison.

| Bounded comparison | Observation |
| --- | --- |
| First ordinary cold launch after reboot | Guest browser fully painted. Browser and XFCE started at tick 16567; Xfwm started 13 ticks later. No startup DeviceReset entry. |
| Guest compositor Off, then restore its original On | Same inner browser PID/start identity throughout. Both frames remained painted. Both transitions produced `FORCED_RESET` / `WR_SIMULATE` journal entries. XFCE session state was `u 1`. |
| Normal outer Quit, then ordinary relaunch | Captured owned processes exited in 5.59 seconds without diagnostic signals. Relaunch painted with Xfwm starting nine ticks after the guest browser, and no startup reset. The inner browser showed its Restore Session trouble page; this was recorded without attempting recovery. |
| One diagnostic delayed-XFCE launch | Temporarily set only the selected machine's saved command to `sleep 1; exec /usr/bin/xfce4-session`, then used actual Display Off/On. The guest received that command. Xfwm started 104 ticks after the guest browser; a forced reset occurred at browser time 1.10973 seconds, comparable to the earlier failing 1.14322 seconds. The frame was nevertheless fully painted. |
| Final ordinary Display Off/On after restoration | Guest received the original command, remained fully painted, and emitted no new reset. Xfwm started six ticks after the guest browser. Display On, Observe Off and compositing On were restored; the same outer browser remained running. |

The reset message alone is therefore insufficient to identify the black-frame
cause. Browser-before-Xfwm process creation and an early initialization reset
also occur in healthy comparisons. The single delayed-start experiment does
not establish a causal fix or exclude every timing-sensitive failure.

The diagnostic command was removed before the final ordinary Display Off/On.
Restoration compared every saved field and restored the entire original
`launch.json` byte for byte, with SHA-256
`e83b874c74e2d03de11717978af11b4ec92c36b9225fe64d8441501d30af44cc`.
The original compositor value `true` was restored. The one-second sleep was
external fault injection, never a proposed product startup delay.

Source inspection found a possible readiness boundary if further evidence
establishes this race. `agent/machines/guest/assets/bashkitten-display-session`
launches the guest browser immediately after starting the configured desktop
command. Upstream Xfwm initializes each screen's compositor before publishing
`_NET_SUPPORTING_WM_CHECK` and before registering its session client. XFCE's
`org.xfce.Session.Manager.GetState` reaches IDLE (`1`) after ordered client
startup. These are concrete readiness conditions, unlike a fixed sleep. No
readiness patch, compositor-setting override, browser restart workaround or
native Firefox reset suppression is justified by the comparisons above.

Source references:

- [Xfwm screen initialization and session registration](https://github.com/xfce-mirror/xfwm4/blob/xfwm4-4.20.0/src/main.c#L535)
- [Xfwm supporting-window property publication](https://github.com/xfce-mirror/xfwm4/blob/xfwm4-4.20.0/src/hints.c#L436)
- [XFCE ordered client startup completion](https://github.com/xfce-mirror/xfce4-session/blob/xfce4-session-4.20.1/xfce4-session/xfsm-startup.c#L607)
- [XFCE startup-complete state](https://github.com/xfce-mirror/xfce4-session/blob/xfce4-session-4.20.1/xfce4-session/xfsm-manager.c#L861)

Original external evidence remains under
`/run/media/user/Data/BashkittenBuild/acceptance/xorg-vm-control/5151/`, including
`candidate-5151-xorg-controls-lifetime.json`,
`black-startup-native-diagnostic.json`, and
`black-startup-guest-complete-namespace-state.json`. The reboot comparisons and
ordinary product captures are under
`/home/user/Bashkitten-Acceptance/isolated-wayland-20261017/diagnostics/xorg-reboot-display/`,
summarized in `bounded-compositor-probe-summary.json`.

The next integrated candidate still needs cold container Display startup through
the installed product on real Xorg and Wayland, recording the actual guest
component revisions separately from the outer browser. If the black frame
returns, capture its guest window/compositor state and startup journal before
restarting Display. These healthy attempts do not close that acceptance case.

## Subsequent cold reproduction with outer 31073761ca

The real Xorg VM reproduced the black guest region during ordinary cold
autostart after installing outer candidate `31073761ca`, before updating the
retained OS48f guest. The immutable candidate's build evidence remains unchanged.
Outer browser PID/start ticks were 21523/94083; guest browser 22364/94345 and
Xfwm 22446/94356. XFCE state was IDLE and compositing was On. The guest journal
recorded a forced reset at browser time 1.06415 seconds. This is another failure,
not a successful validation of the preceding timing hypothesis.

A bounded read-only inspection retained the failed window before the planned
OS update/Display restart. The guest's own ordinary X11 capture showed the same
black main area and painted panel as the outer Display capture. Therefore the
black region existed before the outer viewport transport. XRandR reported the
expected 1270 × 652 guest screen.

Inside the guest's complete user/mount/PID/IPC/network/UTS namespaces, X11
properties identified active window `0x400016` as the guest browser's PID 87
(host PID 22364). It was a normal, viewable, focused and maximized window at
0,0 with size 1270 × 612; its drawing child `0x400010` had the same nonzero size.
The opaque region matched this geometry. These observations exclude an absent,
minimized or zero-sized browser window in this instance. The browser's main
thread was in `do_sys_poll`; renderer/compositor threads were in futex waits.
Those single wait-state snapshots do not establish a deadlock or identify which
component stopped producing the visible browser content.

The evidence localizes the failure to the guest browser/compositing stage, but
does not yet distinguish those owners or establish a source fix. No browser
preferences, source, settings or process state were changed during this
inspection. The diagnostic hold ended after copying the receipt, allowing the
separately planned OS update and ordinary Display controls to continue.

Evidence directory:
`/home/user/Bashkitten-Acceptance/xorg-3107-20261017/`:

- `outer-installed-before-os-restart.png`
- `inner-black-actual-x11.png`
- `black-window-readonly.json`

The original cold-start receipt is in the test VM at
`~/.local/state/bashkitten-upgrade-3107/cold-autostart-black-area.json`.
