// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {AutoTiler} from './tiling.js';
import {TilingOwnership} from './tilingOwnership.js';
import {WorkplaceEdges} from './workplaceEdges.js';
import {workspaceLabel, reorderWorkplace} from './workplaces.js';
import {addWorkplaceMenu, addForceKillAction, NativeWindowMenus} from './windowActions.js';
import {BarAutoHide} from './barAutoHide.js';

const PANEL_HEIGHT = 40;
const MENU_WIDTH_RATIO = 0.28;
const MENU_MIN_WIDTH = 320;
const MENU_MAX_WIDTH = 480;
const CAPPED_TASK_BUTTON_WIDTH = 260;
const MIN_TASK_BUTTON_WIDTH = 96;
const TASK_PAGE_STEP = 5;
const TASK_PAGE_BUTTON_WIDTH = 28;
const WORKSPACES_BUTTON_ROLE = 'gnozzardWorkspacesButton';
const RESOURCES_BUTTON_ROLE = 'gnozzardResourcesButton';
const APPLICATIONS_BUTTON_ROLE = 'gnozzardApplicationsButton';

function showTaskbar(mode, tiling) {
    return mode === 'always' || mode === 'automatic' && !tiling;
}

function popupSide(source) {
    const monitor = Main.layoutManager.findMonitorForActor(source);
    const [, y] = source.get_transformed_position();
    return monitor && y < monitor.y + monitor.height / 2 ? St.Side.TOP : St.Side.BOTTOM;
}

function stopEvent() {
    return Clutter.EVENT_STOP;
}

function workplaceContent(text = '') {
    const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER, y_expand: true});
    const indicator = new St.Widget({
        style_class: 'gnozzard-workspace-indicator', x_expand: true, opacity: 0,
    });
    const content = new St.BoxLayout({
        style_class: 'gnozzard-workspace-entry-content', vertical: true, y_expand: true,
    });
    content.add_child(label);
    content.add_child(indicator);
    return {content, label, indicator};
}

function launchApplication(app) {
    if (app.can_open_new_window()) {
        app.open_new_window(global.workspace_manager.get_active_workspace_index());
        return;
    }
    app.activate();
}

function launchGraphicalCommand(commandArguments, name) {
    const commandLine = commandArguments
        .map(argument => GLib.shell_quote(argument)).join(' ');
    const appInfo = Gio.AppInfo.create_from_commandline(
        commandLine,
        name,
        Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION
    );
    const context = global.create_app_launch_context(global.get_current_time(), -1);
    appInfo.launch([], context);
}

function managedAppForWindow(window) {
    const appSystem = Shell.AppSystem.get_default();
    const installed = appSystem.get_installed();
    const windowClasses = new Set([
        window.get_wm_class?.(),
        window.get_wm_class_instance?.(),
    ].filter(value => value).map(value => value.toLocaleLowerCase()));

    for (const appInfo of installed) {
        if (!appInfo.get_id()?.startsWith('gnozzard-launcher-'))
            continue;
        const startupClass = appInfo.get_startup_wm_class?.();
        if (startupClass && windowClasses.has(startupClass.toLocaleLowerCase()))
            return appSystem.lookup_app(appInfo.get_id());
    }

    const pid = window.get_pid();
    if (pid <= 0)
        return null;
    try {
        const [ok, contents] = GLib.file_get_contents(`/proc/${pid}/environ`);
        if (!ok)
            return null;
        const environment = new TextDecoder().decode(contents).split('\0');
        const appImage = environment
            .find(variable => variable.startsWith('APPIMAGE='))
            ?.slice('APPIMAGE='.length);
        if (!appImage)
            return null;

        for (const appInfo of installed) {
            if (!appInfo.get_id()?.startsWith('gnozzard-appimage-'))
                continue;
            if (appInfo.get_string?.('X-AppImage-Path') === appImage)
                return appSystem.lookup_app(appInfo.get_id());
        }
    } catch (_error) {
        // /proc can disappear while a window is closing.
    }
    return null;
}

class SignalStore {
    constructor() {
        this._signals = [];
    }

    connect(object, signal, callback) {
        const id = object.connect(signal, callback);
        this._signals.push([object, id]);
        return id;
    }

    disconnectObject(object) {
        const remaining = [];
        for (const [connectedObject, id] of this._signals) {
            if (connectedObject !== object) {
                remaining.push([connectedObject, id]);
                continue;
            }
            try {
                connectedObject.disconnect(id);
            } catch (_error) {
                // The object may be in its unmanaged/destroyed signal.
            }
        }
        this._signals = remaining;
    }

    clear() {
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch (_error) {
                // An object may already have been destroyed by GNOME Shell.
            }
        }
        this._signals = [];
    }
}

class AppContextMenu {
    constructor(source, app, settings, refresh) {
        this._app = app;
        this._settings = settings;
        this._refresh = refresh;
        this.menu = new PopupMenu.PopupMenu(source, 0.25, St.Side.BOTTOM);
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(source);
        this._manager.addMenu(this.menu);
        this._rebuild();
    }

    _rebuild() {
        this.menu.removeAll();
        const desktopId = this._app.get_id();
        const pinned = this._settings.get_strv('pinned-apps');
        const isPinned = pinned.includes(desktopId);

        const launch = new PopupMenu.PopupMenuItem('Open');
        launch.connect('activate', () => {
            this._refresh(true);
            launchApplication(this._app);
            Main.overview.hide();
        });
        this.menu.addMenuItem(launch);

        const isAppImage = desktopId.startsWith('gnozzard-appimage-');
        const isDesktopLauncher = desktopId.startsWith('gnozzard-launcher-');
        if (isAppImage) {
            const appImagePath = this._app.get_app_info()?.get_string('X-AppImage-Path');
            if (appImagePath) {
                const extractAndRun = new PopupMenu.PopupMenuItem('Extract and Run');
                extractAndRun.connect('activate', () => {
                    this._refresh(true);
                    try {
                        launchGraphicalCommand(
                            ['/usr/libexec/gnozzard', 'extract-and-run', appImagePath],
                            'Gnozzard AppImage'
                        );
                    } catch (error) {
                        logError(error, `Could not extract and run ${desktopId}`);
                    }
                });
                this.menu.addMenuItem(extractAndRun);

                const extractAndRunNoSandbox = new PopupMenu.PopupMenuItem(
                    'Extract and Run --no-sandbox');
                extractAndRunNoSandbox.connect('activate', () => {
                    this._refresh(true);
                    try {
                        launchGraphicalCommand(
                            [
                                '/usr/libexec/gnozzard',
                                'extract-and-run-no-sandbox',
                                appImagePath,
                            ],
                            'Gnozzard AppImage'
                        );
                    } catch (error) {
                        logError(error,
                            `Could not extract and run ${desktopId} without sandboxing`);
                    }
                });
                this.menu.addMenuItem(extractAndRunNoSandbox);
            }
        }

        const pin = new PopupMenu.PopupMenuItem(isPinned ? 'Unpin' : 'Pin');
        pin.connect('activate', () => {
            this._refresh(true);
            const next = isPinned
                ? pinned.filter(id => id !== desktopId)
                : [...pinned, desktopId];
            this._settings.set_strv('pinned-apps', next);
        });
        this.menu.addMenuItem(pin);

        const desktop = new PopupMenu.PopupMenuItem('Add to Desktop');
        desktop.connect('activate', () => {
            this._refresh(true);
            try {
                Gio.Subprocess.new(
                    ['/usr/libexec/gnozzard', 'app-to-desktop', desktopId],
                    Gio.SubprocessFlags.NONE
                );
            } catch (error) {
                logError(error, `Could not create a desktop shortcut for ${desktopId}`);
            }
        });
        this.menu.addMenuItem(desktop);

        if (isAppImage || isDesktopLauncher) {
            const renameCommand = isAppImage ? 'rename-appimage' : 'rename-desktop';
            const removeCommand = isAppImage ? 'remove-appimage' : 'remove-desktop';
            const rename = new PopupMenu.PopupMenuItem('Rename…');
            rename.connect('activate', () => this._renameManaged(desktopId, renameCommand));
            this.menu.addMenuItem(rename);

            const remove = new PopupMenu.PopupMenuItem('Delete from Applications');
            remove.connect('activate', () => {
                this._refresh(true);
                const nextPinned = this._settings.get_strv('pinned-apps')
                    .filter(id => id !== desktopId);
                this._settings.set_strv('pinned-apps', nextPinned);
                try {
                    const process = Gio.Subprocess.new(
                        ['/usr/libexec/gnozzard', removeCommand, desktopId],
                        Gio.SubprocessFlags.NONE
                    );
                    process.wait_check_async(null, (subprocess, result) => {
                        try {
                            subprocess.wait_check_finish(result);
                        } catch (error) {
                            logError(error, `Could not remove ${desktopId}`);
                        }
                    });
                } catch (error) {
                    logError(error, `Could not remove ${desktopId}`);
                }
            });
            this.menu.addMenuItem(remove);
        }
    }

    _renameManaged(desktopId, command) {
        const currentName = this._app.get_name();
        this._refresh(true);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                const dialog = Gio.Subprocess.new(
                    [
                        '/usr/bin/zenity',
                        '--entry',
                        '--title=Rename Application',
                        '--text=Name shown in Applications:',
                        `--entry-text=${currentName}`,
                        '--width=420',
                    ],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                dialog.communicate_utf8_async(null, null, (process, result) => {
                    try {
                        const [, output] = process.communicate_utf8_finish(result);
                        if (!process.get_successful())
                            return;
                        const name = output.trim();
                        if (!name)
                            return;
                        const rename = Gio.Subprocess.new(
                            ['/usr/libexec/gnozzard', command, desktopId, name],
                            Gio.SubprocessFlags.NONE
                        );
                        rename.wait_check_async(null, (subprocess, renameResult) => {
                            try {
                                subprocess.wait_check_finish(renameResult);
                            } catch (error) {
                                logError(error, `Could not rename ${desktopId}`);
                            }
                        });
                    } catch (error) {
                        logError(error, `Could not read the new name for ${desktopId}`);
                    }
                });
            } catch (error) {
                logError(error, `Could not open the rename dialog for ${desktopId}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    open() {
        this._rebuild();
        this.menu.open(true);
    }

    destroy() {
        this.menu.destroy();
        this._manager = null;
    }
}

class ApplicationRow {
    constructor(app, settings, refresh) {
        this.app = app;
        this.actor = new St.Button({
            style_class: 'gnozzard-app-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            can_focus: true,
            reactive: true,
            button_mask: St.ButtonMask.ONE,
        });
        const content = new St.BoxLayout({
            style_class: 'gnozzard-app-row-content',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        content.add_child(app.create_icon_texture(24));
        content.add_child(new St.Label({
            text: app.get_name(),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        }));
        this.actor.set_child(content);
        this._context = null;
        this.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                // Most users never open a row's secondary menu. Build it only
                // on demand instead of allocating a PopupMenu per installed app.
                this._context ??= new AppContextMenu(this.actor, app, settings, refresh);
                this._context.open();
                return stopEvent();
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('clicked', () => {
            launchApplication(app);
            Main.overview.hide();
            refresh(true);
        });
    }

    destroy() {
        this._context?.destroy();
        this.actor.destroy();
    }
}

class ApplicationsMenu {
    constructor(settings, source, monitorIndex, manager, edge, getAvailableHeight) {
        this._settings = settings;
        this._monitorIndex = monitorIndex;
        this._getAvailableHeight = getAvailableHeight;
        this._rows = [];
        this._dirty = true;
        this._searchTimeout = 0;
        this._signals = new SignalStore();
        this.menu = new PopupMenu.PopupMenu(
            source,
            0,
            edge === 'top' ? St.Side.TOP : St.Side.BOTTOM
        );
        this.menu.setSourceAlignment(0);
        this.menu.actor.add_style_class_name('gnozzard-applications-popup');
        if (edge === 'top')
            this.menu.actor.add_style_class_name('gnozzard-applications-below');
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        manager.addMenu(this.menu);
        this.actor = new St.BoxLayout({
            style_class: 'gnozzard-app-menu',
            vertical: true,
            reactive: true,
        });
        this._search = new St.Entry({
            style_class: 'gnozzard-app-search',
            hint_text: 'Search applications',
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });
        this._settingsButton = new St.Button({
            style_class: 'gnozzard-settings-button',
            can_focus: true,
            reactive: true,
            accessible_name: 'Open Gnozzard',
            child: new St.Icon({
                icon_name: 'preferences-system-symbolic',
                icon_size: 18,
            }),
        });
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._list = new St.BoxLayout({
            style_class: 'gnozzard-app-list',
            vertical: true,
            x_expand: true,
        });
        this._scroll.set_child(this._list);
        this.actor.add_child(this._scroll);
        this._pinned = new St.BoxLayout({
            style_class: 'gnozzard-pinned-section',
            vertical: true,
            x_expand: true,
        });
        this.actor.add_child(this._pinned);
        this._bottomBar = new St.BoxLayout({style_class: 'gnozzard-menu-bottom-bar'});
        this._bottomBar.add_child(this._search);
        this._bottomBar.add_child(this._settingsButton);
        this.actor.add_child(this._bottomBar);
        this._signals.connect(this._settingsButton, 'clicked', () => {
            this.close();
            const app = Shell.AppSystem.get_default()
                .lookup_app('com.openresearchtools.GnozzardSettings.desktop');
            if (app) {
                app.activate();
                Main.overview.hide();
            } else {
                Main.notifyError('Gnozzard', 'The Gnozzard app is not installed correctly.');
            }
        });
        this.menu.box.add_child(this.actor);
        this._signals.connect(this.menu, 'open-state-changed', (_menu, open) => {
            if (open) {
                Main.overview.hide();
                this.relayout();
                if (this._dirty)
                    this._rebuild();
                global.stage.set_key_focus(this._search.clutter_text);
            } else {
                this._resetSearch();
            }
        });
        this._signals.connect(this._search.clutter_text, 'text-changed', () => {
            if (this._searchTimeout)
                GLib.source_remove(this._searchTimeout);
            this._searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 90, () => {
                this._searchTimeout = 0;
                if (this.menu.isOpen)
                    this._rebuild();
                else
                    this._dirty = true;
                return GLib.SOURCE_REMOVE;
            });
        });
        this._signals.connect(
            Shell.AppSystem.get_default(),
            'installed-changed',
            () => this._markDirty()
        );
        this._signals.connect(settings, 'changed::pinned-apps', () => this._markDirty());
        this.relayout();
    }

    _markDirty() {
        this._dirty = true;
        if (this.menu.isOpen)
            this._rebuild();
    }

    _clearRows() {
        for (const row of this._rows)
            row.destroy();
        this._rows = [];
        this._list.destroy_all_children();
        this._pinned.destroy_all_children();
    }

    _makeRow(app) {
        const row = new ApplicationRow(app, this._settings, close => {
            if (close === true)
                this.close();
            else
                this._rebuild();
        });
        this._rows.push(row);
        return row.actor;
    }

    _rebuild() {
        this._dirty = false;
        this._clearRows();
        const query = this._search.get_text().trim().toLocaleLowerCase();
        const pinnedIds = this._settings.get_strv('pinned-apps');
        const pinned = new Set(pinnedIds);
        const appSystem = Shell.AppSystem.get_default();
        const apps = appSystem.get_installed()
            .filter(appInfo => appInfo.should_show())
            .map(appInfo => appSystem.lookup_app(appInfo.get_id()))
            .filter(app => app !== null)
            .filter(app => !query ||
                app.get_name().toLocaleLowerCase().includes(query) ||
                (app.get_description() ?? '').toLocaleLowerCase().includes(query))
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        for (const app of apps.filter(item => !pinned.has(item.get_id())))
            this._list.add_child(this._makeRow(app));

        const pinnedApps = pinnedIds
            .map(id => appSystem.lookup_app(id))
            .filter(app => app !== null)
            .filter(app => !query || app.get_name().toLocaleLowerCase().includes(query));
        if (pinnedApps.length > 0) {
            this._pinned.add_child(new St.Label({
                style_class: 'gnozzard-pinned-title',
                text: 'Pinned',
            }));
            for (const app of pinnedApps)
                this._pinned.add_child(this._makeRow(app));
            this._pinned.show();
        } else {
            this._pinned.hide();
        }
    }

    relayout() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const height = Math.max(1, this._getAvailableHeight());
        const width = Math.min(
            MENU_MAX_WIDTH,
            Math.max(MENU_MIN_WIDTH, Math.floor(monitor.width * MENU_WIDTH_RATIO))
        );
        this.actor.set_size(Math.min(width, monitor.width), height);
    }

    toggle() {
        if (this.menu.isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        this.menu.open(true);
    }

    close() {
        this.menu.close(true);
    }

    _resetSearch() {
        if (this._search.get_text() !== '') {
            this._search.set_text('');
            if (this._searchTimeout) {
                GLib.source_remove(this._searchTimeout);
                this._searchTimeout = 0;
            }
            this._dirty = true;
        }
    }

    destroy() {
        if (this._searchTimeout)
            GLib.source_remove(this._searchTimeout);
        this._clearRows();
        this._signals.clear();
        this.menu.destroy();
        this.menu = null;
    }
}

class TaskContextMenu {
    constructor(source, window) {
        this._window = window;
        this.menu = new PopupMenu.PopupMenu(source, 0.5, popupSide(source));
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(source);
        this._manager.addMenu(this.menu);
    }

    _build() {
        this.menu.removeAll();
        addWorkplaceMenu(this.menu, this._window);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const close = new PopupMenu.PopupMenuItem('Close');
        close.setSensitive(this._window.can_close());
        close.connect('activate', () => {
            if (this._window.can_close())
                this._window.delete(global.get_current_time());
        });
        this.menu.addMenuItem(close);

        addForceKillAction(this.menu, this._window);
    }

    open() {
        this._build();
        this.menu.open(true);
    }

    destroy() {
        this.menu.destroy();
        this._manager = null;
    }
}

class TaskButton {
    constructor(window, onChanged, onReorder, fixedWidth = null) {
        this.window = window;
        this._onReorder = onReorder;
        this._signals = new SignalStore();
        const actorProperties = {
            style_class: 'gnozzard-task-button',
            can_focus: true,
            reactive: true,
            x_expand: fixedWidth === null,
            button_mask: St.ButtonMask.ONE,
        };
        if (fixedWidth !== null) {
            actorProperties.min_width = fixedWidth;
            actorProperties.min_width_set = true;
            actorProperties.natural_width = fixedWidth;
            actorProperties.natural_width_set = true;
        }
        this.actor = new St.Button(actorProperties);
        this.actor._delegate = this;
        this._content = new St.BoxLayout({style_class: 'gnozzard-task-content'});
        this._app = this._windowApp();
        this._icon = this._iconForApp(this._app);
        this._content.add_child(this._icon);
        this._label = new St.Label({
            style_class: 'gnozzard-task-label',
            text: window.get_title() || 'Application',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._content.add_child(this._label);
        this.actor.set_child(this._content);
        this._context = null;
        this.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this._openContext();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('popup-menu', () => {
            this._openContext();
            return true;
        });
        this.actor.connect('clicked', () => this._activateOrMinimise());
        this._draggable = DND.makeDraggable(this.actor, {
            timeoutThreshold: 180,
            restoreOnSuccess: true,
            dragActorOpacity: 220,
        });
        this._signals.connect(window, 'notify::title', () => {
            const title = window.get_title() || 'Application';
            this._label.set_text(title);
            // DING maps its desktop surface before adding the @! marker used
            // to identify that surface. Remove the temporary task immediately.
            if (title.startsWith('@!') || title.startsWith('Desktop Icons '))
                onChanged();
        });
        this.updateState();
    }

    _openContext() {
        this._context ??= new TaskContextMenu(this.actor, this.window);
        this._context.open();
    }

    getDragActor() {
        return new Clutter.Clone({source: this.actor});
    }

    getDragActorSource() {
        return this.actor;
    }

    handleDragOver(source) {
        if (!(source instanceof TaskButton) || source === this)
            return DND.DragMotionResult.NO_DROP;
        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, x) {
        if (!(source instanceof TaskButton) || source === this)
            return false;
        this._onReorder(source, this, x >= this.actor.width / 2);
        return true;
    }

    _windowApp() {
        const tracked = Shell.WindowTracker.get_default().get_window_app(this.window);
        if (!tracked || tracked.is_window_backed())
            return managedAppForWindow(this.window) ?? tracked;
        return tracked;
    }

    _iconForApp(app) {
        return app?.create_icon_texture(20) ?? new St.Icon({
            icon_name: 'application-x-executable-symbolic',
            icon_size: 20,
        });
    }

    refreshIcon() {
        const app = this._windowApp();
        if (app === this._app)
            return;
        this._app = app;
        const replacement = this._iconForApp(app);
        this._content.insert_child_at_index(replacement, 0);
        this._icon.destroy();
        this._icon = replacement;
    }

    _activateOrMinimise() {
        const focused = global.display.focus_window === this.window;
        const workspace = this.window.get_workspace();
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const onActiveWorkspace = this.window.is_on_all_workspaces() ||
            workspace === activeWorkspace;
        if (focused && onActiveWorkspace && !this.window.minimized) {
            this.window.minimize();
            return;
        }
        Main.activateWindow(this.window);
    }

    setFixedWidth(fixedWidth) {
        const fixed = fixedWidth !== null;
        this.actor.x_expand = !fixed;
        this.actor.min_width_set = fixed;
        this.actor.natural_width_set = fixed;
        if (fixed) {
            this.actor.min_width = fixedWidth;
            this.actor.natural_width = fixedWidth;
        }
    }

    updateState() {
        if (global.display.focus_window === this.window)
            this.actor.add_style_class_name('focused');
        else
            this.actor.remove_style_class_name('focused');
    }

    destroy() {
        this._context?.destroy();
        this._draggable = null;
        this._signals.clear();
        this.actor.destroy();
    }
}

class ClassicPanel {
    constructor(
        settings,
        monitorIndex,
        sharedState,
        applicationsMenuManager,
        onWindowsChanged,
        onOrderChanged,
        edge,
        getAvailableHeight
    ) {
        this._settings = settings;
        this._monitorIndex = monitorIndex;
        this._edge = edge;
        this._sharedState = sharedState;
        this._onWindowsChanged = onWindowsChanged;
        this._onOrderChanged = onOrderChanged;
        this._signals = new SignalStore();
        this._tasks = [];
        this._taskOffset = 0;
        this._taskCapacity = 0;
        this._taskWindowCount = 0;
        this._desktopWindows = sharedState.desktopWindows;
        this.actor = new St.BoxLayout({
            style_class: 'gnozzard-panel',
            reactive: true,
            height: PANEL_HEIGHT,
        });
        this.applicationsButton = new St.Button({
            style_class: 'gnozzard-applications-button',
            label: 'Applications',
            can_focus: true,
        });
        this.actor.add_child(this.applicationsButton);
        this._taskNavigation = new St.BoxLayout({
            style_class: 'gnozzard-task-navigation',
            visible: false,
        });
        this._taskPrevious = this._createTaskPageButton('<', 'Previous 5 windows');
        this._taskNext = this._createTaskPageButton('>', 'Next 5 windows');
        this._taskNavigation.add_child(this._taskPrevious);
        this._taskNavigation.add_child(this._taskNext);
        this.actor.add_child(this._taskNavigation);
        this._taskBox = new St.BoxLayout({x_expand: true});
        this._taskBox.layout_manager.homogeneous =
            !settings.get_boolean('capped-task-buttons');
        this.actor.add_child(this._taskBox);
        this._showDesktop = new St.Button({
            style_class: 'gnozzard-show-desktop',
            accessible_name: 'Show Desktop',
            can_focus: true,
        });
        this.actor.add_child(this._showDesktop);
        this._menu = new ApplicationsMenu(
            settings,
            this.applicationsButton,
            monitorIndex,
            applicationsMenuManager,
            edge,
            getAvailableHeight
        );
        this.applicationsButton.connect('clicked', () => this._menu.toggle());
        this._taskPrevious.connect('clicked', () => this._moveTaskPage(-TASK_PAGE_STEP));
        this._taskNext.connect('clicked', () => this._moveTaskPage(TASK_PAGE_STEP));
        this._showDesktop.connect('clicked', () => this._toggleDesktop());

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this._signals.connect(settings, 'changed::panel-color', () => this._updateColour());
        this._updateColour();
        this.relayout();
        this._autoHide = new BarAutoHide(this.actor, settings, 'autohide-taskbar', edge,
            () => Main.layoutManager.monitors[this._monitorIndex]);
        this._signals.connect(this._menu.menu, 'open-state-changed', (_menu, open) => {
            this._autoHide.setMenuOpen(open);
        });
        this._refreshTasks();
    }

    _createTaskPageButton(label, accessibleName) {
        return new St.Button({
            style_class: 'gnozzard-task-page-button',
            label,
            accessible_name: accessibleName,
            can_focus: true,
            reactive: true,
            min_width: TASK_PAGE_BUTTON_WIDTH,
            min_width_set: true,
            natural_width: TASK_PAGE_BUTTON_WIDTH,
            natural_width_set: true,
        });
    }

    _updateColour() {
        const colour = this._settings.get_string('panel-color');
        this.actor.set_style(`background-color: ${colour};`);
        Main.panel?.set_style(`background-color: ${colour};`);
    }

    _windowList(allWorkspaces) {
        const workspace = allWorkspaces
            ? null
            : global.workspace_manager.get_active_workspace();
        return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace)
            .filter(window => !window.skip_taskbar &&
                window.get_window_type() !== Meta.WindowType.DESKTOP &&
                !(window.get_title() ?? '').startsWith('@!') &&
                !(window.get_title() ?? '').startsWith('Desktop Icons '))
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
    }

    _eligibleWindows() {
        const eligible = this._windowList(
            this._settings.get_boolean('taskbar-all-workspaces'));
        const available = new Set(eligible);
        const ordered = this._sharedState.windowOrder
            .filter(window => available.has(window));
        for (const window of eligible) {
            if (!ordered.includes(window))
                ordered.push(window);
        }
        this._sharedState.windowOrder.splice(0, this._sharedState.windowOrder.length,
            ...ordered);
        return ordered;
    }

    _refreshTasks() {
        const windows = this._eligibleWindows();
        const layout = this._taskLayout(windows);
        const desiredWindows = new Set(layout.windows);
        const tasksByWindow = new Map(this._tasks.map(task => [task.window, task]));

        for (const task of this._tasks) {
            if (!desiredWindows.has(task.window))
                task.destroy();
        }

        this._tasks = layout.windows.map(window => {
            let task = tasksByWindow.get(window);
            if (!task) {
                task = new TaskButton(
                    window,
                    () => this._onWindowsChanged(),
                    (source, target, after) => this._reorderTask(source, target, after),
                    layout.taskWidth
                );
                this._taskBox.add_child(task.actor);
            } else {
                task.setFixedWidth(layout.taskWidth);
            }
            return task;
        });
        this._tasks.forEach((task, index) =>
            this._taskBox.set_child_at_index(task.actor, index));
        this._updateFocus();
    }

    _taskLayout(windows) {
        const count = windows.length;
        this._taskWindowCount = count;
        if (!this._settings.get_boolean('capped-task-buttons') || count === 0) {
            this._taskOffset = 0;
            this._taskCapacity = count;
            this._taskNavigation.hide();
            return {windows, taskWidth: null};
        }
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor) {
            this._taskOffset = 0;
            this._taskCapacity = count;
            this._taskNavigation.hide();
            return {windows, taskWidth: CAPPED_TASK_BUTTON_WIDTH};
        }
        const [, applicationsWidth] = this.applicationsButton.get_preferred_width(-1);
        const [, desktopWidth] = this._showDesktop.get_preferred_width(-1);
        const availableWithoutNavigation = Math.max(MIN_TASK_BUTTON_WIDTH,
            monitor.width - applicationsWidth - desktopWidth);
        const overflow = count * MIN_TASK_BUTTON_WIDTH > availableWithoutNavigation;
        const available = Math.max(MIN_TASK_BUTTON_WIDTH,
            availableWithoutNavigation - (overflow ? TASK_PAGE_BUTTON_WIDTH * 2 : 0));
        const capacity = overflow
            ? Math.max(1, Math.floor(available / MIN_TASK_BUTTON_WIDTH))
            : count;
        const maxOffset = Math.max(0, count - capacity);
        this._taskOffset = Math.min(this._taskOffset, maxOffset);
        this._taskCapacity = capacity;
        this._taskNavigation.visible = overflow;
        this._updateTaskPageButtons();
        const visibleWindows = overflow
            ? windows.slice(this._taskOffset, this._taskOffset + capacity)
            : windows;
        const taskWidth = Math.max(MIN_TASK_BUTTON_WIDTH, Math.min(
            CAPPED_TASK_BUTTON_WIDTH,
            Math.floor(available / visibleWindows.length)
        ));
        return {windows: visibleWindows, taskWidth};
    }

    _moveTaskPage(delta) {
        const maxOffset = Math.max(0, this._taskWindowCount - this._taskCapacity);
        const nextOffset = Math.max(0, Math.min(maxOffset, this._taskOffset + delta));
        if (nextOffset === this._taskOffset)
            return;
        this._taskOffset = nextOffset;
        this._refreshTasks();
    }

    _updateTaskPageButtons() {
        const maxOffset = Math.max(0, this._taskWindowCount - this._taskCapacity);
        this._setTaskPageButtonEnabled(this._taskPrevious, this._taskOffset > 0);
        this._setTaskPageButtonEnabled(this._taskNext, this._taskOffset < maxOffset);
    }

    _setTaskPageButtonEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }

    _reorderTask(source, target, after) {
        const order = this._sharedState.windowOrder;
        const sourceIndex = order.indexOf(source.window);
        if (sourceIndex < 0 || !order.includes(target.window))
            return;
        const [window] = order.splice(sourceIndex, 1);
        const targetIndex = order.indexOf(target.window);
        order.splice(targetIndex + (after ? 1 : 0), 0, window);
        this._refreshTasks();
        this._onOrderChanged(this);
    }

    _updateFocus() {
        for (const task of this._tasks)
            task.updateState();
    }

    _toggleDesktop() {
        const windows = this._windowList(false);
        const restorable = [...this._desktopWindows].filter(window =>
            windows.includes(window) && window.minimized);
        if (restorable.length > 0) {
            for (const window of restorable)
                window.unminimize();
            Main.activateWindow(restorable.at(-1));
            this._desktopWindows.clear();
            return;
        }
        this._desktopWindows.clear();
        for (const window of windows) {
            if (!window.minimized) {
                this._desktopWindows.add(window);
                window.minimize();
            }
        }
    }

    relayout() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this.actor.set_position(monitor.x,
            this._edge === 'top' ? monitor.y : monitor.y + monitor.height - PANEL_HEIGHT);
        this.actor.set_size(monitor.width, PANEL_HEIGHT);
        this._autoHide?.relayout();
        this._menu.relayout();
    }

    toggleApplications() {
        // An explicit keyboard shortcut remains usable with a hidden bar.
        this._autoHide.reveal();
        this._menu.toggle();
    }

    refreshTasks() {
        this._refreshTasks();
    }

    updateFocus() {
        this._updateFocus();
    }

    updateIcons() {
        for (const task of this._tasks)
            task.refreshIcon();
    }

    get monitorIndex() {
        return this._monitorIndex;
    }

    destroy() {
        this._signals.clear();
        this._menu.destroy();
        this._autoHide.destroy();
        for (const task of this._tasks)
            task.destroy();
        this._tasks = [];
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}

class WorkspaceContextMenu {
    constructor(source, closeable, onClose, tiler, workspace, settings) {
        this.menu = new PopupMenu.PopupMenu(source, 0.5, popupSide(source));
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(source);
        this._manager.addMenu(this.menu);
        if (tiler) {
            const enabled = tiler.isWorkspaceEnabled(workspace);
            const arrange = new PopupMenu.PopupSwitchMenuItem('Auto-arrange windows', enabled);
            arrange.connect('toggled', (_item, state) => tiler.setWorkspaceEnabled(workspace, state));
            this.menu.addMenuItem(arrange);
            const layouts = new PopupMenu.PopupSubMenuMenuItem('Arrange as');
            for (const [name, kind] of [['Automatic', 'auto'], ['Rows', 'rows'],
                ['Columns', 'columns'], ['One above the rest', 'top'], ['One beside the rest', 'side']]) {
                const item = new PopupMenu.PopupMenuItem(name);
                item.connect('activate', () => {
                    tiler.setWorkspaceEnabled(workspace, true);
                    tiler.setLayout(workspace, kind);
                });
                layouts.menu.addMenuItem(item);
            }
            this.menu.addMenuItem(layouts);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
        for (const [label, offset] of [['Move Left', -1], ['Move Right', 1]]) {
            const item = new PopupMenu.PopupMenuItem(label);
            const target = workspace.index() + offset;
            item.setSensitive(closeable && target > 0 &&
                target < global.workspace_manager.get_n_workspaces());
            item.connect('activate', () => reorderWorkplace(workspace, offset, settings));
            this.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const close = new PopupMenu.PopupMenuItem('Close Workplace');
        close.setSensitive(closeable);
        close.connect('activate', onClose);
        this.menu.addMenuItem(close);
    }

    open() {
        this.menu.open(true);
    }

    destroy() {
        this.menu.destroy();
        this._manager = null;
    }
}

const WorkspacesButton = GObject.registerClass(
class WorkspacesButton extends PanelMenu.Button {
    _init(settings, getTiler) {
        super._init(0, 'Workplaces', true);
        this._settings = settings;
        this._getTiler = getTiler;
        this.add_style_class_name('gnozzard-workspaces-button');
        this._signals = new SignalStore();
        this._entries = [];
        this._workspaceManager = global.workspace_manager;
        this._content = new St.BoxLayout({style_class: 'gnozzard-workspaces-content'});
        this._addButton = new St.Button({
            style_class: 'gnozzard-workspace-add-button',
            label: '+',
            accessible_name: 'Add Workplace',
            can_focus: true,
            reactive: true,
            button_mask: St.ButtonMask.ONE,
        });
        this._addButton.connect('clicked', () => this._addWorkspace());
        this._content.add_child(this._addButton);
        this.add_child(this._content);
        this._signals.connect(this._workspaceManager, 'notify::n-workspaces', () =>
            this._sync());
        this._signals.connect(this._workspaceManager, 'workspaces-reordered', () =>
            this._sync());
        this._signals.connect(this._workspaceManager, 'workspace-switched', () =>
            this._syncActive());
        this._sync();
    }

    _createEntry() {
        const actor = new St.Button({
            style_class: 'gnozzard-workspace-button',
            can_focus: true,
            reactive: true,
            button_mask: St.ButtonMask.ONE,
        });
        const {content, label, indicator} = workplaceContent();
        actor.set_child(content);
        const entry = {
            workspace: null,
            context: null,
            actor,
            label,
            indicator,
        };
        entry.actor.connect('clicked', () =>
            entry.workspace?.activate(global.get_current_time()));
        entry.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this._openContext(entry);
            return Clutter.EVENT_STOP;
        });
        entry.actor.connect('popup-menu', () => {
            this._openContext(entry);
            return true;
        });
        this._content.insert_child_at_index(entry.actor, this._entries.length);
        this._entries.push(entry);
    }

    _openContext(entry) {
        entry.context?.destroy();
        const main = this._workspaceManager.get_workspace_by_index(0);
        entry.context = new WorkspaceContextMenu(
            entry.actor,
            entry.workspace !== main,
            () => this._closeWorkspace(entry.workspace),
            this._getTiler(),
            entry.workspace,
            this._settings
        );
        entry.context.open();
    }

    _sync() {
        const count = this._workspaceManager.get_n_workspaces();
        while (this._entries.length < count)
            this._createEntry();
        while (this._entries.length > count) {
            const entry = this._entries.pop();
            entry.context?.destroy();
            entry.actor.destroy();
        }
        for (let index = 0; index < count; index++) {
            const entry = this._entries[index];
            entry.context?.destroy();
            entry.context = null;
            entry.workspace = this._workspaceManager.get_workspace_by_index(index);
            const label = workspaceLabel(index);
            entry.label.set_text(label);
            entry.actor.accessible_name = label;
        }
        this._syncActive();
    }

    _syncActive() {
        const activeIndex = this._workspaceManager.get_active_workspace_index();
        for (let index = 0; index < this._entries.length; index++) {
            const entry = this._entries[index];
            const active = index === activeIndex;
            entry.indicator.opacity = active ? 255 : 0;
            if (active)
                entry.actor.add_style_class_name('active');
            else
                entry.actor.remove_style_class_name('active');
        }
    }

    _addWorkspace() {
        this._workspaceManager.append_new_workspace(true, global.get_current_time());
    }

    _closeWorkspace(workspace) {
        const main = this._workspaceManager.get_workspace_by_index(0);
        if (!workspace || !main || workspace === main)
            return;
        const timestamp = global.get_current_time();
        for (const window of workspace.list_windows()) {
            if (!window.is_on_all_workspaces())
                window.change_workspace(main);
        }
        if (this._workspaceManager.get_active_workspace() === workspace)
            main.activate(timestamp);
        this._workspaceManager.remove_workspace(workspace, timestamp);
    }

    destroy() {
        for (const entry of this._entries)
            entry.context?.destroy();
        this._entries = [];
        this._signals.clear();
        super.destroy();
    }
});

const SystemApplicationsButton = GObject.registerClass(
class SystemApplicationsButton extends PanelMenu.Button {
    _init(settings, monitorIndex, manager, edge, getAvailableHeight, getAutoHide) {
        super._init(0, 'Applications');
        this.add_style_class_name('gnozzard-workspaces-button');
        this._getAutoHide = getAutoHide;
        this.applicationsButton = this;
        const {content} = workplaceContent('Applications');
        content.add_style_class_name('gnozzard-workspace-button');
        this.add_child(content);
        // The same menu and single menu manager are used in either bar.
        this._menu = new ApplicationsMenu(settings, this.applicationsButton,
            monitorIndex, manager, edge, getAvailableHeight);
        this.setMenu(this._menu.menu);
        this._menu.menu.connect('open-state-changed', (_menu, open) => {
            this._getAutoHide()?.setMenuOpen(open);
        });
    }

    toggleApplications() {
        this._getAutoHide()?.reveal();
        this._menu.toggle();
    }

    destroy() {
        this._menu.destroy();
        this.menu = null;
        super.destroy();
    }
});

const ResourcesButton = GObject.registerClass(
class ResourcesButton extends PanelMenu.Button {
    _init() {
        super._init(0, 'Open Resources', true);
        this.add_style_class_name('gnozzard-resources-button');
        const icon = new St.Icon({
            icon_name: 'org.openresearchtools.GnozzardResources-symbolic',
            icon_size: 16,
            style_class: 'system-status-icon',
        });
        const activationButton = new St.Button({
            style_class: 'gnozzard-resources-activation',
            accessible_name: 'Open Resources',
            can_focus: false,
            reactive: true,
            button_mask: St.ButtonMask.ONE,
            child: icon,
        });
        activationButton.connect('clicked', () => this._activate());
        this.add_child(activationButton);
    }

    vfunc_key_release_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_space) {
            this._activate();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _activate() {
        const app = Shell.AppSystem.get_default().lookup_app(
            'org.openresearchtools.GnozzardResources.desktop');
        if (app) {
            app.activate();
            Main.overview.hide();
        } else {
            Main.notifyError('Gnozzard', 'Resources is not installed correctly.');
        }
    }
});

export default class GnozzardExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signals = new SignalStore();
        this._watchedWindows = new Set();
        this._applicationsMenuManager = Main.panel.menuManager;
        this._desktopStarted = false;
        this._previousTopPanelStyle = Main.panel?.get_style() ?? null;
        const activities = Main.panel.statusArea.activities?.container ??
            Main.panel.statusArea.activities;
        this._previousActivitiesVisible = activities?.visible ?? true;
        this._panelState = {
            windowOrder: [],
            desktopWindows: new Set(),
        };
        this._panels = [];
        this._tilingOwnership = new TilingOwnership(this._settings);
        this._applyClassicSettings();
        if (Main.actionMode === Shell.ActionMode.NONE) {
            this._signals.connect(Main.layoutManager, 'startup-complete', () =>
                this._finishStartup());
        } else {
            this._finishStartup();
        }
        Main.wm.addKeybinding(
            'toggle-applications',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => (this._systemApplications ?? this._primaryPanel())?.toggleApplications()
        );
        this._signals.connect(global.display, 'window-created', (_display, window) => {
            this._watchWindow(window);
            this._refreshPanels();
        });
        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);
        this._signals.connect(global.display, 'notify::focus-window', () =>
            this._updatePanelsFocus());
        this._signals.connect(Shell.WindowTracker.get_default(), 'tracked-windows-changed', () =>
            this._updatePanelIcons());
        this._signals.connect(global.window_manager, 'switch-workspace', () => {
            this._syncBarLayout();
            this._refreshPanels();
        });
        this._signals.connect(Main.layoutManager, 'monitors-changed', () =>
            this._rebuildPanels());
        this._signals.connect(this._settings, 'changed::show-resources-button', () =>
            this._syncResourcesButton());
        this._signals.connect(this._settings, 'changed::taskbar-all-workspaces', () =>
            this._refreshPanels());
        this._signals.connect(this._settings, 'changed::taskbars-all-displays', () =>
            this._rebuildPanels());
        this._signals.connect(this._settings, 'changed::capped-task-buttons', () =>
            this._rebuildPanels());
        this._signals.connect(this._settings, 'changed::auto-tile-windows', () =>
            this._syncAutoTiler());
        for (const key of ['taskbar-mode', 'swap-bars', 'tiling-disabled-workplaces'])
            this._signals.connect(this._settings, `changed::${key}`, () => this._syncBarLayout());
        this._signals.connect(Main.layoutManager.panelBox, 'notify::height', () =>
            this._positionSystemBar());
    }

    _finishStartup() {
        if (this._desktopStarted)
            return;
        Main.overview.hide();
        if (Main.overview.visible) {
            this._signals.connect(Main.overview, 'hidden', () => {
                this._signals.disconnectObject(Main.overview);
                this._startDesktop();
            });
            return;
        }
        this._startDesktop();
    }

    _startDesktop() {
        if (this._desktopStarted)
            return;
        this._desktopStarted = true;
        this._nativeWindowMenus = new NativeWindowMenus();
        Main.panel?.add_style_class_name('gnozzard-top-panel');
        this._syncWorkspacesButton();
        this._syncResourcesButton();
        this._syncAutoTiler();
        this._workplaceEdges = new WorkplaceEdges(this._settings);
    }

    _syncAutoTiler() {
        if (!this._desktopStarted)
            return;
        if (this._settings.get_boolean('auto-tile-windows'))
            this._autoTiler ??= new AutoTiler(this._settings);
        else {
            this._autoTiler?.destroy();
            this._autoTiler = null;
        }
        this._syncBarLayout();
    }

    _syncBarLayout() {
        if (!this._desktopStarted)
            return;
        const tiling = Boolean(this._autoTiler?.isWorkspaceEnabled(
            global.workspace_manager.get_active_workspace()));
        const taskbar = showTaskbar(this._settings.get_string('taskbar-mode'), tiling);
        const swapped = this._settings.get_boolean('swap-bars');
        if (taskbar === this._showTaskbar && swapped === this._barsSwapped)
            return;
        this._showTaskbar = taskbar;
        this._barsSwapped = swapped;
        this._rebuildPanels();
    }

    _positionSystemBar() {
        if (!this._desktopStarted)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const box = Main.layoutManager.panelBox;
        box.set_position(monitor.x,
            this._barsSwapped ? monitor.y + monitor.height - box.height : monitor.y);
        this._topBarAutoHide?.relayout();
        this._systemApplications?._menu.relayout();
    }

    _menuHeight(monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        const systemHeight = monitor === Main.layoutManager.primaryMonitor ? Main.panel.height : 0;
        return monitor.height - systemHeight - (this._showTaskbar ? PANEL_HEIGHT : 0);
    }

    _rebuildPanels() {
        if (!this._desktopStarted)
            return;
        this._systemApplications?.destroy();
        this._systemApplications = null;
        for (const panel of this._panels)
            panel.destroy();
        this._panels = [];
        this._topBarAutoHide?.destroy();
        this._topBarAutoHide = null;
        this._positionSystemBar();
        const systemEdge = this._barsSwapped ? 'bottom' : 'top';
        this._topBarAutoHide = new BarAutoHide(Main.layoutManager.panelBox, this._settings,
            'autohide-top-bar', systemEdge, () => Main.layoutManager.primaryMonitor);
        const primaryIndex = Math.max(0, Main.layoutManager.monitors
            .indexOf(Main.layoutManager.primaryMonitor));
        if (!this._showTaskbar) {
            this._systemApplications = new SystemApplicationsButton(this._settings, primaryIndex,
                this._applicationsMenuManager, systemEdge, () => this._menuHeight(primaryIndex),
                () => this._topBarAutoHide);
            Main.panel.addToStatusArea(APPLICATIONS_BUTTON_ROLE, this._systemApplications, 0, 'left');
            this._settings.set_boolean('taskbar-present', false);
            return;
        }
        const monitorIndexes = this._settings.get_boolean('taskbars-all-displays')
            ? Main.layoutManager.monitors.map((_monitor, index) => index)
            : [primaryIndex];
        this._panels = monitorIndexes.map(index =>
            new ClassicPanel(
                this._settings,
                index,
                this._panelState,
                this._applicationsMenuManager,
                () => this._refreshPanels(),
                source => this._syncPanelOrder(source),
                this._barsSwapped ? 'top' : 'bottom',
                () => this._menuHeight(index)
            ));
        // Settings reflects the actual bars, including per-workplace tiling.
        this._settings.set_boolean('taskbar-present', this._panels.length > 0);
    }

    _primaryPanel() {
        const index = Main.layoutManager.monitors
            .indexOf(Main.layoutManager.primaryMonitor);
        return this._panels.find(panel => panel.monitorIndex === index) ??
            this._panels[0] ?? null;
    }

    _refreshPanels() {
        for (const panel of this._panels)
            panel.refreshTasks();
    }

    _watchWindow(window) {
        if (!window || this._watchedWindows.has(window))
            return;
        this._watchedWindows.add(window);
        this._signals.connect(window, 'notify::skip-taskbar', () =>
            this._refreshPanels());
        this._signals.connect(window, 'workspace-changed', () =>
            this._refreshPanels());
        this._signals.connect(window, 'unmanaged', () => {
            this._signals.disconnectObject(window);
            this._watchedWindows.delete(window);
            this._refreshPanels();
        });
    }

    _updatePanelsFocus() {
        for (const panel of this._panels)
            panel.updateFocus();
    }

    _updatePanelIcons() {
        for (const panel of this._panels)
            panel.updateIcons();
    }

    _syncPanelOrder(source) {
        for (const panel of this._panels) {
            if (panel !== source)
                panel.refreshTasks();
        }
    }

    _schema(id) {
        return new Gio.Settings({schema_id: id});
    }

    _applyClassicSettings() {
        const mutter = this._schema('org.gnome.mutter');
        const wm = this._schema('org.gnome.desktop.wm.preferences');
        const desktop = this._schema('org.gnome.desktop.interface');
        const shellKeybindings = this._schema('org.gnome.shell.keybindings');
        if (!this._settings.get_boolean('settings-owned')) {
            this._settings.set_boolean('previous-hot-corners',
                desktop.get_boolean('enable-hot-corners'));
            this._settings.set_string('previous-button-layout', wm.get_string('button-layout'));
            this._settings.set_string('previous-overlay-key', mutter.get_string('overlay-key'));
            this._settings.set_boolean('settings-owned', true);
        }
        desktop.set_boolean('enable-hot-corners', false);
        if (desktop.settings_schema.has_key('accent-color'))
            desktop.set_string('accent-color', 'orange');
        desktop.set_string('icon-theme', 'Gnozzard');
        wm.set_string('button-layout', ':minimize,maximize,close');
        mutter.set_boolean('dynamic-workspaces', false);
        mutter.set_string('overlay-key', '');
        if (shellKeybindings.settings_schema.has_key('toggle-application-view')) {
            if (!this._settings.get_boolean('application-view-keybinding-owned')) {
                this._settings.set_strv('previous-application-view-keybinding',
                    shellKeybindings.get_strv('toggle-application-view'));
                this._settings.set_boolean('application-view-keybinding-owned', true);
            }
            shellKeybindings.set_strv('toggle-application-view', []);
        }
        this._applyLockBackground();
    }

    _applyLockBackground() {
        const lock = this._schema('org.gnome.desktop.screensaver');
        if (!this._settings.get_boolean('lock-settings-owned')) {
            this._settings.set_string('previous-lock-picture-uri',
                lock.get_string('picture-uri'));
            this._settings.set_string('previous-lock-picture-options',
                lock.get_string('picture-options'));
            this._settings.set_string('previous-lock-color-shading-type',
                lock.get_string('color-shading-type'));
            this._settings.set_string('previous-lock-primary-color',
                lock.get_string('primary-color'));
            this._settings.set_string('previous-lock-secondary-color',
                lock.get_string('secondary-color'));
            this._settings.set_boolean('lock-settings-owned', true);
        }
        lock.set_string('picture-uri', '');
        lock.set_string('picture-options', 'none');
        lock.set_string('color-shading-type', 'solid');
        lock.set_string('primary-color', '#202225');
        lock.set_string('secondary-color', '#202225');
    }

    _restoreLockBackground() {
        if (!this._settings?.get_boolean('lock-settings-owned'))
            return;
        const lock = this._schema('org.gnome.desktop.screensaver');
        lock.set_string('picture-uri',
            this._settings.get_string('previous-lock-picture-uri'));
        lock.set_string('picture-options',
            this._settings.get_string('previous-lock-picture-options'));
        lock.set_string('color-shading-type',
            this._settings.get_string('previous-lock-color-shading-type'));
        lock.set_string('primary-color',
            this._settings.get_string('previous-lock-primary-color'));
        lock.set_string('secondary-color',
            this._settings.get_string('previous-lock-secondary-color'));
        this._settings.set_boolean('lock-settings-owned', false);
    }

    _syncWorkspacesButton() {
        if (!this._desktopStarted)
            return;
        this._workspacesButton?.destroy();
        this._workspacesButton = new WorkspacesButton(this._settings, () => this._autoTiler);
        const activities = Main.panel.statusArea.activities?.container ??
            Main.panel.statusArea.activities;
        if (activities)
            activities.visible = false;
        Main.panel.addToStatusArea(
            WORKSPACES_BUTTON_ROLE,
            this._workspacesButton,
            0,
            'left'
        );
    }

    _syncResourcesButton() {
        if (!this._desktopStarted)
            return;
        this._resourcesButton?.destroy();
        this._resourcesButton = null;
        if (this._settings.get_boolean('show-resources-button')) {
            this._resourcesButton = new ResourcesButton();
            Main.panel.addToStatusArea(
                RESOURCES_BUTTON_ROLE,
                this._resourcesButton,
                0,
                'right'
            );
        }
    }

    _restoreSettings() {
        this._restoreLockBackground();
        const shellKeybindings = this._schema('org.gnome.shell.keybindings');
        if (this._settings?.get_boolean('application-view-keybinding-owned') &&
            shellKeybindings.settings_schema.has_key('toggle-application-view')) {
            shellKeybindings.set_strv('toggle-application-view',
                this._settings.get_strv('previous-application-view-keybinding'));
            this._settings.set_boolean('application-view-keybinding-owned', false);
        }
        if (!this._settings?.get_boolean('settings-owned'))
            return;
        const wm = this._schema('org.gnome.desktop.wm.preferences');
        const desktop = this._schema('org.gnome.desktop.interface');
        desktop.set_boolean('enable-hot-corners',
            this._settings.get_boolean('previous-hot-corners'));
        wm.set_string('button-layout', this._settings.get_string('previous-button-layout'));
        const mutter = this._schema('org.gnome.mutter');
        mutter.set_string('overlay-key', this._settings.get_string('previous-overlay-key'));
        this._settings.set_boolean('settings-owned', false);
    }

    disable() {
        Main.wm.removeKeybinding('toggle-applications');
        this._signals?.clear();
        this._nativeWindowMenus?.destroy();
        this._nativeWindowMenus = null;
        this._systemApplications?.destroy();
        this._systemApplications = null;
        this._autoTiler?.destroy();
        this._autoTiler = null;
        this._workplaceEdges?.destroy();
        this._workplaceEdges = null;
        this._topBarAutoHide?.destroy();
        this._topBarAutoHide = null;
        this._tilingOwnership?.destroy();
        this._tilingOwnership = null;
        this._watchedWindows?.clear();
        this._watchedWindows = null;
        for (const panel of this._panels ?? [])
            panel.destroy();
        this._panels = [];
        this._settings?.set_boolean('taskbar-present', false);
        this._applicationsMenuManager = null;
        this._panelState = null;
        if (Main.panel) {
            Main.panel.remove_style_class_name('gnozzard-top-panel');
            Main.panel.set_style(this._previousTopPanelStyle);
        }
        this._previousTopPanelStyle = null;
        this._workspacesButton?.destroy();
        this._workspacesButton = null;
        this._resourcesButton?.destroy();
        this._resourcesButton = null;
        const activities = Main.panel.statusArea.activities?.container ??
            Main.panel.statusArea.activities;
        if (activities)
            activities.visible = this._previousActivitiesVisible ?? true;
        this._previousActivitiesVisible = null;
        this._barsSwapped = false;
        this._showTaskbar = undefined;
        this._positionSystemBar();
        this._desktopStarted = false;
        this._restoreSettings();
        this._settings = null;
    }
}
