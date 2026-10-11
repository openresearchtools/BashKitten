// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from './tilingLayout.js';
import {moveWindowToWorkplace} from './workplaces.js';

function unmaximize(window) {
    if (!(window.maximized_horizontally || window.maximized_vertically))
        return;
    // Mutter 50 replaced the flags argument with separate maximize APIs.
    if (window.get_maximized)
        window.unmaximize(Meta.MaximizeFlags.BOTH);
    else
        window.unmaximize();
}

function place(actor, rect) {
    actor.set_position(rect.x, rect.y);
    actor.set_size(Math.max(1, rect.width), Math.max(1, rect.height));
}

export class AutoTiler {
    constructor(settings) {
        this._settings = settings;
        this._signals = [];
        this._windows = new Map();
        this._groups = [];
        this._sizes = new Map();
        this._later = 0;
        this._grab = null;
        this._chrome = [];
        this._disabled = new Set(settings.get_value('tiling-disabled-workplaces').deepUnpack()
            .map(index => global.workspace_manager.get_workspace_by_index(index)).filter(Boolean));
        this._connect(global.display, 'window-created', (_display, window) => this._watch(window));
        this._connect(global.window_manager, 'map', (_manager, actor) => {
            this._watch(actor.meta_window);
            const record = this._windows.get(actor.meta_window.get_stable_sequence());
            if (record && !record.ready) {
                const id = actor.connect('first-frame', () => {
                    actor.disconnect(id);
                    record.firstFrame = null;
                    record.ready = true;
                    this._queue();
                });
                record.firstFrame = [actor, id];
            }
        });
        this._connect(global.display, 'workareas-changed', () => this._queue());
        this._connect(global.display, 'window-entered-monitor', () => this._queue());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._queue());
        this._connect(global.workspace_manager, 'workspace-switched', () => this._queue());
        this._connect(global.workspace_manager, 'notify::n-workspaces', () => {
            this._saveDisabled();
            this._queue();
        });
        this._connect(global.display, 'grab-op-begin', (_display, window, op) => this._begin(window, op));
        this._connect(global.display, 'grab-op-end', () => this._end());
        this._connect(Main.overview, 'showing', () => this._hideChrome());
        this._connect(Main.overview, 'hidden', () => this._queue());
        this._connect(Main.sessionMode, 'updated', () => this._queue());
        this._connect(settings, 'changed::tiling-linked-dividers', () => this._queue());
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window, true);
        this._queue();
    }

    _connect(object, signal, callback, list = this._signals) {
        list.push([object, object.connect(signal, callback)]);
    }

    isWorkspaceEnabled(workspace) {
        return !this._disabled.has(workspace);
    }

    _saveDisabled() {
        this._disabled = new Set([...this._disabled].filter(w => w.index() >= 0));
        this._settings.set_value('tiling-disabled-workplaces',
            new GLib.Variant('ai', [...this._disabled].map(w => w.index()).sort((a, b) => a - b)));
    }

    setWorkspaceEnabled(workspace, enabled) {
        if (enabled) this._disabled.delete(workspace);
        else this._disabled.add(workspace);
        this._saveDisabled();
        for (const record of this._windows.values()) {
            if (!enabled && record.group?.workspace === workspace)
                this._restore(record);
        }
        this._queue();
    }

    setLayout(workspace, kind) {
        for (const group of this._groups.filter(g => g.workspace === workspace)) {
            this._accept(group, Layout.preset(Layout.ids(group.tree), kind, this._area(group), this._sizes));
            group.revision++;
        }
        this._queue();
    }

    _watch(window, ready = false) {
        if (!window || this._windows.has(window.get_stable_sequence()) ||
            window.get_window_type() !== Meta.WindowType.NORMAL || window.is_override_redirect())
            return;
        const id = window.get_stable_sequence();
        const record = {id, window, signals: [], group: null, original: null, bookmark: null,
            ready, firstFrame: null, target: null, minimum: {width: 0, height: 0}, requests: []};
        this._windows.set(id, record);
        for (const signal of ['workspace-changed', 'notify::fullscreen', 'notify::resizeable', 'notify::window-type',
            'notify::on-all-workspaces', 'notify::skip-taskbar'])
            this._connect(window, signal, () => this._queue(), record.signals);
        this._connect(window, 'size-changed', () => this._geometryChanged(record, true), record.signals);
        this._connect(window, 'position-changed', () => this._geometryChanged(record), record.signals);
        this._connect(window, 'notify::minimized', () => {
            if (record.group && window.minimized && this.isWorkspaceEnabled(window.get_workspace())) {
                // Undo the request before Mutter's queued visibility calculation.
                window.unminimize();
                return;
            }
            this._queue();
        }, record.signals);
        for (const signal of ['notify::maximized-horizontally', 'notify::maximized-vertically']) {
            this._connect(window, signal, () => {
                this._queue();
                if (!record.group || !this.isWorkspaceEnabled(window.get_workspace()) ||
                    !(window.maximized_horizontally || window.maximized_vertically))
                    return;
                Main.wm.skipNextEffect(window.get_compositor_private());
                unmaximize(window);
                this._queue();
            }, record.signals);
        }
        this._connect(window, 'notify::title', () => this._queue(), record.signals);
        this._connect(window, 'unmanaged', () => {
            if (this._grab?.record === record)
                this._end(true);
            this._remove(record);
            if (record.firstFrame)
                record.firstFrame[0].disconnect(record.firstFrame[1]);
            for (const [object, signal] of record.signals)
                object.disconnect(signal);
            this._windows.delete(id);
            this._sizes.delete(id);
            this._queue();
        }, record.signals);
        this._queue();
    }

    _eligible(record) {
        const w = record.window;
        return record.ready && w.get_window_type() === Meta.WindowType.NORMAL &&
            w.get_compositor_private() && w.get_workspace() && !w.minimized &&
            !w.is_fullscreen() && !w.is_on_all_workspaces() && !w.skip_taskbar &&
            !w.get_transient_for() &&
            this.isWorkspaceEnabled(w.get_workspace());
    }

    _geometryChanged(record, resized = false) {
        if (!record.group || !record.target)
            return;
        const frame = record.window.get_frame_rect();
        // Older Mutter exposes constraints through committed resize responses.
        // Match the requests that this frame can acknowledge, not just the
        // newest desired tile: Wayland can deliver an earlier configure later.
        if (resized && !record.window.get_min_size &&
            !(record.window.maximized_horizontally || record.window.maximized_vertically)) {
            const requests = record.requests.filter(r => r.width <= frame.width && r.height <= frame.height);
            if (requests.length) {
                for (const dimension of ['width', 'height']) {
                    const requested = Math.max(...requests.map(r => r[dimension]));
                    record.minimum[dimension] = frame[dimension] > requested
                        ? frame[dimension] : Math.min(record.minimum[dimension], frame[dimension]);
                }
                record.requests.splice(0, record.requests.indexOf(requests.at(-1)) + 1);
            }
        }
        if (this._grab)
            return;
        // Acknowledging our own placement does not start another reflow. App
        // geometry changes use the same coalesced path as every other update.
        if (['x', 'y', 'width', 'height'].some(key => frame[key] !== record.target[key]))
            this._queue();
    }

    _group(workspace, monitor) {
        let group = this._groups.find(g => g.workspace === workspace && g.monitor === monitor);
        if (!group) {
            group = {workspace, monitor, tree: null, revision: 0};
            this._groups.push(group);
        }
        return group;
    }

    _area(group) {
        const r = group.workspace.get_work_area_for_monitor(group.monitor);
        return Layout.inset(r);
    }

    _remove(record) {
        const group = record.group;
        if (!group)
            return;
        const tree = Layout.copy(group.tree);
        group.tree = Layout.remove(group.tree, record.id);
        group.revision++;
        record.bookmark = {group, tree, revision: group.revision};
        record.group = null;
        record.target = null;
    }

    _queue() {
        if (this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        if (this._grab)
            return;
        for (const record of this._windows.values()) {
            const w = record.window;
            const group = this._eligible(record) ? this._group(w.get_workspace(), w.get_monitor()) : null;
            if (group !== record.group)
                this._remove(record);
            if (!group)
                continue;
            // GTK/Wayland clients negotiate their own minimum; Mutter exposes it
            // directly on newer Shells. Older Shells still enforce it themselves.
            let {width, height} = w.get_min_size ? {width: 0, height: 0} : record.minimum;
            width = Math.max(160, width);
            height = Math.max(100, height);
            if (w.get_min_size) {
                const [valid, minWidth, minHeight] = w.get_min_size();
                if (valid) { width = Math.max(width, minWidth); height = Math.max(height, minHeight); }
            }
            if (!w.resizeable) {
                // Fixed-size normal apps still get a tile; reserve their native
                // dimensions instead of leaving them floating over other apps.
                const frame = w.get_frame_rect();
                width = Math.max(width, frame.width);
                height = Math.max(height, frame.height);
            }
            // Minimums include the cell's padding, so fitting and overflow use
            // the actual space required by both the application and its gap.
            this._sizes.set(record.id, {width: width + Layout.GAP, height: height + Layout.GAP});
            if (record.group)
                continue;
            const frame = w.get_frame_rect();
            record.original ??= {rect: {x: frame.x, y: frame.y, width: frame.width, height: frame.height},
                maximized: w.get_maximized ? Boolean(w.get_maximized()) : w.is_maximized()};
            const bookmark = record.bookmark;
            const next = bookmark?.group === group && bookmark.revision === group.revision
                ? bookmark.tree : Layout.insert(group.tree, record.id, this._area(group), this._sizes);
            if (!next) {
                this._overflow(record, group);
                continue;
            }
            group.tree = next;
            group.revision++;
            record.group = group;
            record.bookmark = null;
        }
        this._groups = this._groups.filter(g => g.workspace.index() >= 0 &&
            g.monitor < Main.layoutManager.monitors.length);
        for (const group of this._groups) {
            this._accept(group, Layout.fit(group.tree, this._area(group), this._sizes));
            this._apply(group);
        }
        this._drawChrome();
    }

    _apply(group) {
        for (const r of Layout.layout(group.tree, this._area(group), this._sizes).regions) {
            if (r.node.id === undefined)
                continue;
            const record = this._windows.get(r.node.id);
            const w = record?.window;
            if (!w || w.minimized || w.is_fullscreen())
                continue;
            const target = Layout.inset(r.rect);
            record.target = target;
            unmaximize(w);
            const old = w.get_frame_rect();
            if (['x', 'y', 'width', 'height'].some(k => old[k] !== target[k])) {
                if (!w.get_min_size && (old.width !== target.width || old.height !== target.height)) {
                    const previous = record.requests.at(-1);
                    if (!previous || previous.width !== target.width || previous.height !== target.height)
                        record.requests.push(target);
                }
                w.move_resize_frame(false, target.x, target.y, target.width, target.height);
            }
        }
    }

    _accept(group, result) {
        group.tree = result.tree;
        for (const id of result.overflow) {
            const record = this._windows.get(id);
            if (record)
                this._overflow(record, group);
        }
    }

    _overflow(record, source) {
        this._remove(record);
        const manager = global.workspace_manager;
        for (let index = 0; index < manager.get_n_workspaces(); index++) {
            const workspace = manager.get_workspace_by_index(index);
            if (workspace === source.workspace || !this.isWorkspaceEnabled(workspace))
                continue;
            const group = this._group(workspace, source.monitor);
            const next = Layout.insert(group.tree, record.id, this._area(group), this._sizes);
            if (!next)
                continue;
            group.tree = next;
            group.revision++;
            record.group = group;
            record.bookmark = null;
            moveWindowToWorkplace(record.window, workspace);
            return;
        }
        const workspace = moveWindowToWorkplace(record.window);
        const group = this._group(workspace, source.monitor);
        group.tree = Layout.leaf(record.id);
        record.group = group;
        record.bookmark = null;
    }

    _restore(record) {
        if (!record.original || record.window.is_fullscreen())
            return;
        const {rect, maximized} = record.original;
        const w = record.window;
        unmaximize(w);
        w.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
        if (maximized) {
            if (w.get_maximized) w.maximize(Meta.MaximizeFlags.BOTH);
            else w.maximize();
        }
        record.original = null;
    }

    _hideChrome() {
        for (const actor of this._chrome) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._chrome = [];
    }

    _addChrome(actor, rect) {
        place(actor, rect);
        Main.layoutManager.addChrome(actor, {affectsStruts: false, trackFullscreen: true});
        this._chrome.push(actor);
        return actor;
    }

    _drawChrome() {
        this._hideChrome();
        if (this._grab || Main.overview.visible || Main.sessionMode.isLocked)
            return;
        const workspace = global.workspace_manager.get_active_workspace();
        for (const group of this._groups.filter(g => g.workspace === workspace)) {
            if (global.get_window_actors().some(a => a.meta_window.is_fullscreen() &&
                a.meta_window.get_monitor() === group.monitor && a.meta_window.located_on_workspace(workspace)))
                continue;
            const {cuts} = Layout.layout(group.tree, this._area(group), this._sizes);
            for (const cut of cuts) {
                // The pointer target straddles the centre of the shared gap.
                const rect = {...cut.rect};
                rect[cut.axis] -= 3;
                rect[cut.axis === 'x' ? 'width' : 'height'] = 6;
                const handle = this._addChrome(new St.Widget({reactive: true, track_hover: true,
                    style_class: 'gnozzard-tile-divider', accessible_name: 'Resize adjacent windows'}), rect);
                handle.connect('button-press-event', (_actor, event) => {
                    if (event.get_button() !== 1)
                        return Clutter.EVENT_PROPAGATE;
                    this._beginDivider(group, cut, handle);
                    return Clutter.EVENT_STOP;
                });
            }
        }
    }

    _beginDivider(group, cut, actor) {
        if (this._grab)
            return;
        const [x, y] = global.get_pointer();
        this._grab = {group, tree: Layout.copy(group.tree), cuts: [cut], x, y,
            modal: Main.pushModal(actor), signals: [], divider: true};
        this._connect(actor, 'key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._end(true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this._grab.signals);
        this._trackGrab();
    }

    _begin(window, op) {
        if (this._grab)
            return;
        const record = window && this._windows.get(window.get_stable_sequence());
        if (!record?.group)
            return;
        const [x, y] = global.get_pointer();
        const group = record.group;
        const moving = op === Meta.GrabOp.MOVING || op === Meta.GrabOp.MOVING_UNCONSTRAINED ||
            op === Meta.GrabOp.KEYBOARD_MOVING;
        const frame = window.get_frame_rect();
        const cuts = Layout.layout(group.tree, this._area(group), this._sizes).cuts.filter(c => {
            const r = c.rect;
            if (c.axis === 'x')
                return ((op & 4096 && Math.abs(r.x - frame.x) < Layout.GAP / 2 + 2) ||
                    (op & 8192 && Math.abs(r.x - frame.x - frame.width) < Layout.GAP / 2 + 2)) &&
                    r.y < frame.y + frame.height && r.y + r.height > frame.y;
            return ((op & 32768 && Math.abs(r.y - frame.y) < Layout.GAP / 2 + 2) ||
                (op & 16384 && Math.abs(r.y - frame.y - frame.height) < Layout.GAP / 2 + 2)) &&
                r.x < frame.x + frame.width && r.x + r.width > frame.x;
        });
        this._hideChrome();
        this._grab = {record, group, tree: Layout.copy(group.tree), x, y, cuts, moving,
            scope: 0, candidate: null, signals: [], source: 0, preview: null};
        this._connect(global.stage, 'captured-event', (_stage, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
                this._grab.cancelled = true;
                return Clutter.EVENT_PROPAGATE;
            }
            if (moving && (event.type() === Clutter.EventType.SCROLL ||
                event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_space)) {
                const backwards = event.type() === Clutter.EventType.SCROLL &&
                    event.get_scroll_direction() === Clutter.ScrollDirection.UP;
                this._grab.scope = Math.max(0, this._grab.scope + (backwards ? -1 : 1));
                this._preview();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this._grab.signals);
        this._trackGrab();
    }

    _trackGrab() {
        // One pointer path for title-bar and divider drags, scoped to the grab.
        // Mutter owns title-bar pointer events; no idle/background polling.
        this._grab.source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (this._grab.moving) this._preview();
            else this._resizeGrab();
            if (this._grab.divider && !(global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK)) {
                this._grab.source = 0;
                this._end();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _resizeGrab() {
        const grab = this._grab;
        const [x, y] = global.get_pointer();
        let tree = grab.tree;
        for (const cut of grab.cuts)
            tree = Layout.resize(tree, this._area(grab.group), this._sizes, cut.path,
                cut.axis === 'x' ? x - grab.x : y - grab.y,
                this._settings.get_boolean('tiling-linked-dividers'));
        grab.group.tree = tree;
        this._apply(grab.group);
    }

    _preview() {
        const grab = this._grab;
        const [x, y] = global.get_pointer();
        const monitor = Main.layoutManager.monitors.findIndex(m => x >= m.x && y >= m.y &&
            x < m.x + m.width && y < m.y + m.height);
        if (monitor < 0)
            return;
        const group = this._group(global.workspace_manager.get_active_workspace(), monitor);
        const area = this._area(group);
        const hit = Layout.hit(group.tree, area, this._sizes, x, y, grab.scope);
        grab.candidate = null;
        let tree = group.tree, label = 'Whole desktop';
        if (!this.isWorkspaceEnabled(group.workspace)) {
            grab.preview?.hide();
            return;
        }
        if (!tree) tree = Layout.leaf(grab.record.id);
        else if (hit) {
            label = `${hit.label} · ${hit.side === 'centre' ? 'Swap' : hit.side} · Space / scroll: scope`;
            if (group !== grab.group && hit.side === 'centre') {
                grab.preview?.hide();
                return;
            }
            tree = Layout.dock(tree, grab.record.id, Layout.ids(hit.node), hit.side, area, this._sizes);
        } else {
            grab.preview?.hide();
            return;
        }
        if (!tree) {
            this._showPreview(area, 'Cannot fit here: application minimum sizes exceed this layout', false);
            return;
        }
        const region = Layout.layout(tree, area, this._sizes).regions
            .find(r => r.node.id === grab.record.id);
        if (!region)
            return;
        grab.candidate = {group, tree};
        this._showPreview(Layout.inset(region.rect), label, true);
    }

    _showPreview(rect, label, valid) {
        const grab = this._grab;
        if (!grab.preview) {
            grab.preview = new St.Bin({style_class: 'gnozzard-tile-preview', reactive: false,
                child: new St.Label({style_class: 'gnozzard-tile-preview-label',
                    y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER})});
            Main.layoutManager.addChrome(grab.preview, {affectsStruts: false});
        }
        if (valid) grab.preview.remove_style_pseudo_class('invalid');
        else grab.preview.add_style_pseudo_class('invalid');
        grab.preview.child.set_text(label);
        place(grab.preview, rect);
        grab.preview.show();
    }

    _end(cancelled = false) {
        const grab = this._grab;
        if (!grab)
            return;
        // Include the release position, even when it arrives between pointer
        // samples. Never commit a preview from the previous point in the drag.
        if (grab.moving && !cancelled && !grab.cancelled)
            this._preview();
        if (grab.source)
            GLib.source_remove(grab.source);
        for (const [object, id] of grab.signals)
            object.disconnect(id);
        if (grab.modal)
            Main.popModal(grab.modal);
        if (grab.preview) {
            Main.layoutManager.removeChrome(grab.preview);
            grab.preview.destroy();
        }
        if (cancelled || grab.cancelled)
            grab.group.tree = grab.tree;
        else if (grab.moving && grab.candidate) {
            const {group, tree} = grab.candidate;
            if (group !== grab.group) {
                this._remove(grab.record);
                moveWindowToWorkplace(grab.record.window, group.workspace);
                grab.record.window.move_to_monitor(group.monitor);
                grab.record.group = group;
            }
            group.tree = tree;
            group.revision++;
        } else if (!grab.moving)
            grab.group.revision++;
        this._grab = null;
        this._queue();
    }

    destroy() {
        this._end(true);
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._hideChrome();
        for (const record of this._windows.values()) {
            if (record.firstFrame)
                record.firstFrame[0].disconnect(record.firstFrame[1]);
            for (const [object, id] of record.signals)
                object.disconnect(id);
            this._restore(record);
        }
        this._windows.clear();
        this._groups = [];
    }
}
