# Stack interactions: selection, keyboard, Quick Look, clipboard, drag and drop

Design of everything the user asked for on 2026-11-01 about the dock's stack dropdowns (Downloads, Screenshots, Recents, any folder). It is written to be implemented by independent agents in parallel worktrees: every slice names its files, its hooks into code other agents are editing, its tests and its visual proof. Umbrella ticket: [#50](https://github.com/alex-mextner/hyperdock/issues/50); the slice tickets (#53 to #73) are listed in section 13.

How claims are marked: **[verified]** = reproduced or proven by an experiment in an isolated nested headless gnome-shell (the scratch probes are summarised in section 2 and 3, the logs quoted), **[source]** = read in the named source file, **[macOS]** = documented macOS behaviour with the cited page, **[inference]** = reasoned, not observed (each one has a test or ticket step that settles it).

## Summary

- **Root causes.** (1) Nothing can be dragged out: no drag source exists, the fan opens the file on button *press*, Grid and List cells are plain buttons, and a Shell extension cannot start a Wayland drag by itself. (2) Right click: `St.Button` only answers the left button, no handler exists for button 3, and in the fan any button opens the file. (3) Names: the labels are drawn, but with real screenshot names the part that tells the files apart (the time) is always cut off, and nothing shows the full name. Evidence: sections 2.1-2.3.
- **Drag out works through a helper client**, handed the pointer with a *spare mouse button* (a virtual press of button 9 while button 1 is held); proven end to end in the nested shell against the real `StackPanel`, the Trash and a stack on the dock (section 5). The same-button handoff does not work (mutter drops it); only the user can confirm it on a physical mouse, touchpad and touch screen.
- **Clipboard:** a Shell extension can put exactly one mimetype on the Wayland clipboard (verified; a GJS subclass of `Meta.SelectionSource` cannot be registered), so Copy/Cut use `x-special/gnome-copied-files`, which is what Files pastes, including cut versus copy (section 3.2, 9).
- **Quick Look:** a built-in overlay for images and text, Sushi (`org.gnome.NautilusPreviewer2`, installed here) for the types the overlay cannot show (section 4.5).
- **Drops from other apps** already work for files and folders when `file-drops` is on (it ships off); links, text, images and "between icons" do not exist yet, a name collision loses the drop silently and a dropped URL makes GIO fetch the page. The decision table, the extended helper protocol and the insertion rule are in section 6 and 11.6-11.7.
- **Folders as stacks**, **web links on the dock** and the data model (`folder-stacks`, new `dock-links`): sections 7 and 8.
- **Plan:** ten pure modules with 4,400 lines of checks are in this branch (section 11); 16 implementation slices and 5 follow-ups with tickets, file ownership and hooks into the code of the two branches that are editing the popovers (sections 10 and 13).

## 1. What the user asked for

Verbatim (2026-11-01):

> а еще я не смог драгндропнуть картинку из выпадушки скриншотов и правая клавиша не работает и названия не выводятся. кроме пока очень сыро проработай детально чтобы было удобно. так же как в маке должны работать выделение по умолчанию и стрелочки и пробел для демонстрации крупно. для выделенного должны работать все стандартные хоткеи. cut/copy/delete и подобные. так же должен работать драгндроп на группу (скриншоты, загрузки и тп), так же должен работать драгндроп на док, так должны тягаться папки и приложения и ссылки на веб страницы и мб чтото еще. папки отображаются так же стопками.

Requirements derived from it (the numbers are used in the tickets):

| # | Requirement | Kind | Section |
|---|---|---|---|
| R1 | An image can be dragged out of the Screenshots dropdown (to Files, a browser, a chat, an editor, the dock) | bug | 2.1, 5 |
| R2 | Right click in a dropdown opens a context menu | bug | 2.2, 4.7 |
| R3 | File names are shown and readable | bug | 2.3, 4.8 |
| R4 | The dropdowns are worked out in detail and convenient (not "raw") | umbrella | all |
| R5 | Something is selected by default when a dropdown opens; arrow keys move the selection | feature | 4.1-4.3 |
| R6 | Space shows the selected file large (Quick Look); arrows move it | feature | 4.5 |
| R7 | The standard hotkeys work on the selection: cut, copy, paste, delete and similar | feature | 4.4, 9 |
| R8 | Drag and drop onto a group (Screenshots, Downloads, ...) works | feature | 6.3 |
| R9 | Drag and drop onto the dock works for folders, apps, web links, and maybe other things | feature | 6.4-6.6, 8 |
| R10 | Folders are displayed as stacks too | feature | 7 |

## 2. Root causes of the three reported bugs

Method: a nested headless gnome-shell (`gnome-shell --headless --no-x11 --virtual-monitor 1200x800`) under `prlimit --core=0`, a private D-Bus session, `HOME` and every `XDG_*` directory in a temp dir (the real `~/.config/monitors.xml` is a symlink loop and a crash must never raise an apport dialog on the real desktop), the extension installed from this branch, fixtures of 14 real 2560x1440 PNG screenshots (with and without freedesktop thumbnails) in `Pictures/Screenshots`, and a virtual pointer driving real input through the Shell's event path (`pointerFor` of `stackScenarios.js`). The scratch probe (not shipped) pressed, right-clicked and dragged on the first entry of the Screenshots dropdown in each view and logged what the Shell did. Base: the code of commit 37cfbee.

### 2.1 R1: nothing can be dragged out of a dropdown

**Cause 1: there is no drag source at all [source, verified].** `grep makeDraggable|_delegate` finds drag sources only for the dock's own app icons (`interactions.js`, `compat.js`); `stackPanel.js` and `dockItemMenu.js` have none.

**Cause 2: the fan launches on press [verified].** `DockItemList.slideIn` connects `icon.connect('button-press-event', ...)` (dockItemMenu.js:243): the file opens and the fan disappears on the button press, before any motion can start a drag. Probe, Fan view, press on the first file and move 12 steps: the stub `xdg-open` recorded the file path, `dragEvents: 0`, the fan was gone in the mid-drag screenshot.

**Cause 3: Grid and List cells are `St.Button`s [verified].** A press followed by a move beyond the click threshold cancels the click gesture and nothing else is attached. Probe: `dragEvents: 0`, no new actor in `Main.uiGroup`, nothing opened, the panel stayed open (so the user sees "nothing happens").

**Root constraint: a Shell extension cannot originate a Wayland drag [verified/source].** `Meta.Dnd` has no methods (enumerated with GI), `imports.ui.dnd` only drags between Shell actors, and Wayland's `wl_data_device.start_drag` needs a client surface that owns the pointer's implicit grab serial. Section 5 holds the technique that works.

Evidence (nested shell, base 37cfbee): fan mid-drag, the fan vanished and the file opened ([screenshot](images/stack-interactions/fan-drag-mid.png)); grid mid-drag, the dropdown unchanged ([screenshot](images/stack-interactions/grid-drag-mid.png)). Probe log lines: `{"view":"fan","step":"drag-out","dragEvents":0,...,"opened":"<the file>","fanOpenAfter":false,"hasDelegate":false}` and `{"view":"grid","step":"drag-out","dragEvents":0,"newActorsMidDrag":[],"opened":"","panelOpenAfter":true,"hasDelegate":false}`.

### 2.2 R2: right click does nothing (and in the fan it opens the file)

- **Fan [verified]:** the same `button-press-event` handler has no `get_button()` check, so a right press opens the file exactly as a left press (probe: `step:"right-click"` logged `opened: <the file>`, `fanOpen: false`; no menu actor).
- **Grid and List [verified]:** `St.Button` has `button-mask` ONE (left only), nothing else listens for button 3, and `StackPanel` handles only presses outside the popover (stackPanel.js:294-301). Probe: `panelOpen: true`, `newActors: []`, nothing opened.
- The only context menu in the area is the *dock item's* (`item._menu`: Sort by / Display as / View content as / Group by / Open), built by `addStackMenu` (stackPanel.js:170); a file inside a dropdown never had one.
- Evidence: [fan after a right click](images/stack-interactions/fan-rightclick.png) (the fan is gone, the file opened), [grid after a right click](images/stack-interactions/grid-rightclick.png) (nothing changed).
- **Fix shape (section 4.7):** buttons accept `ONE|TWO|THREE`; the secondary click (and the Menu key, and Shift+F10) opens a `PopupMenu` built from `stackMenuModel.itemMenu` anchored at the pointer; the fan stops activating on press.

### 2.3 R3: names

**Names are drawn in all three views [verified]**, with and without thumbnails: nested shell, 14 PNG screenshots named like the real ones (`Screenshot from 2026-10-30 10-13-00.png`); every label had positive size, opacity 255, `mapped: true` (Grid 88x16, List 260x18, Fan 263x32; probe `step:"labels"`). So "names are not shown" is not a missing label actor. What the screenshots show is that **the names are unreadable as names**:

- Grid: an 88 px label with `Pango.EllipsizeMode.MIDDLE` shows `Screen…00.png` for *every* screenshot: the only part that tells them apart (the time) is the part cut away.
- Fan: `l.name.replace(/(.{32})..+/, '$1...')` (dockItemMenu.js:204) keeps the first 32 characters: `Screenshot from 2026-10-30 10-13...`, again without the time.
- List: `EllipsizeMode.END`: `Screenshot from 2026-10-30 10-13-…`.
- Nothing shows the full name of the selected or hovered file.
- Screenshots: [Grid](images/stack-interactions/grid-names.png), [List](images/stack-interactions/list-names.png), [Fan](images/stack-interactions/fan-names.png) (also the evidence of the inverted fan order below).

The grid-speed work (ticket [#37](https://github.com/alex-mextner/hyperdock/issues/37), `cellName` in `stackLayout.js` on branch dropdown-grid-speed) already rebuilds the grid label as two short lines keeping the start and the end of the name; section 4.8 adds what it does not cover (fan, list, a caption with the full name and the file's details).

**Could not verify live:** the user's display is 3840x2160 at 150% with `scale-monitor-framebuffer`; a headless mutter ignored a `monitors.xml` scale of 1.5 (`geometryScale` stayed 1), so labels on a fractional scale were not exercised. The fan positions its labels from `get_transformed_size()` (dockItemMenu.js:511) which is correct in logical pixels [inference]; the names ticket therefore asks the user to confirm on the real session.

### 2.4 Other defects found on the way (ticketed, not fixed here)

- **Fan order is inverted [verified in the screenshot].** With newest-first sort the newest file (`report-00`) is drawn farthest from the dock, second from the top under "More...", the oldest of the five next to the dock. macOS puts the newest next to the Dock [macOS: [Mainspring](https://trymainspring.com/blog/dock-stack-fan-grid-list-mac): "sorted by Date Added, the latest file sits right above the Dock"].
- **`file-drops` is off by default** (gschema `file-drops` default false): the user has it on (`dconf read` returned true), so the dock accepts file drops from other apps already; section 6.2 lists what that machinery does and does not do.

## 3. Research

### 3.1 What macOS does (the model to match) [macOS]

Sources: Apple Support "Use the Dock on Mac"; [AppleInsider on Stacks and Quick Look](https://appleinsider.com/inside/macos-ventura/tips/how-to-use-stacks-and-quick-look-in-macos-ventura); [Mainspring, Dock stack views](https://trymainspring.com/blog/dock-stack-fan-grid-list-mac); [macsales, Dock stacks](https://eshop.macsales.com/blog/64838-use-dock-stacks-in-macos/).

- A folder dragged to the right side of the Dock (left of the Trash) becomes a stack. Control- or right-click gives *Sort by* (Name, Date Added, Date Modified, Date Created, Kind), *Display as* (Stack, Folder), *View content as* (Fan, Grid, List, Automatic), *Open "<name>"*. All of this exists already in `addStackMenu`.
- Fan only exists for a bottom Dock; it holds roughly a dozen items, newest nearest the Dock, with *Open in Finder* at the top. Grid scrolls and **navigates into sub-folders with a back arrow in the corner**; List shows sub-folders as submenus and is the most keyboard friendly: *type a few letters to jump, arrow keys to move, Return opens, Esc closes the stack without opening anything*.
- A click on an item opens it like a double click in Finder; you have to click the icon (the name is not a button) [AppleInsider].
- Dragging a file out of a stack onto the Desktop, a window or an app icon works; dropping on an app icon opens the file in that app [Mainspring].
- Quick Look: select a file, press **Space**; arrow buttons go to the previous/next selected file; Esc leaves full screen; for several files a grid button; *Open with* button; `.webloc` previews the page [AppleInsider]. Whether macOS stacks themselves answer Space is not documented in the pages above [inference: they do not]; the user asked for it, so it is built here.
- macOS stacks have **no** Finder-style context menu on files and no cut/copy/delete [a feature request for exactly that is open on a Mac utility: [vorssaint-utils #2734](https://github.com/vorssaint/vorssaint-utils/issues/2734)]. The user's list goes beyond macOS there; this document designs the superset.

### 3.2 What a GNOME Shell 50 extension can do

All of these were checked in this session unless marked.

| Question | Answer | Evidence |
|---|---|---|
| Start a drag to another Wayland app from a Shell actor | **Not from the Shell itself:** `Meta.Dnd` has no methods and Shell DnD is actor-to-actor. **Yes through a helper client** that is handed the pointer with a spare mouse button (section 5). | `GI` enumeration of `Meta`, `Shell`, `Clutter` (`Meta.Dnd methods: constructor`); DragOutSpike, [docs/spikes/DRAG_OUT.md](spikes/DRAG_OUT.md) |
| Shell-internal drag | `DND.makeDraggable(actor, params)`: GNOME 50 uses `St.DndStartGesture` (`manualMode`, `timeoutThreshold`), takes its **own** `Main.pushModal` for the drag, drop targets implement `_delegate.handleDragOver(source, actor, x, y, time)` / `acceptDrop(source, actor, x, y, time)`, Escape cancels, `DND.addDragMonitor` observes | read of `ui/dnd.js` from the running shell's resource bundle [source] |
| Receive a drag from another app on a Shell actor | Hover positions only (`global.backend.get_dnd()` `dnd-position-change`, `Main.xdndHandler` `drag-begin`/`drag-end`); the **drop and its data go to a Wayland surface only**. The repo's answer is the helper client of `fileDrops.js` | `fileDrops.js` header [source] |
| Put files on the clipboard | `St.Clipboard.set_content(type, mimetype, bytes)` / `Meta.SelectionSourceMemory.new(mimetype, bytes)`: **exactly one mimetype** | nested shell: set `x-special/gnome-copied-files`, `Meta.Selection.get_mimetypes` returned `["x-special/gnome-copied-files"]`, `transfer_async` read back `copy\nfile:///tmp/a%20b.png` verbatim [verified] |
| Offer several mimetypes at once | **Not from GJS.** A GJS subclass of `Meta.SelectionSource` fails at class registration: `VFunc read_async accepts another callback as a parameter. This is not supported` (the extension did not load) | nested shell log [verified] |
| What Nautilus 50 pastes | `x-special/gnome-copied-files`: first line `cut` or `copy`, then one URI per line, no empty line, every line a valid URI (`g_uri_is_valid`); it offers that plus `GdkFileList` (`text/uri-list` on the wire) | `nautilus/src/nautilus-clipboard.c` (main) [source] |
| Quick Look | `gnome-sushi 50.0` is installed here (`/usr/libexec/org.gnome.NautilusPreviewer`), D-Bus-activatable as `org.gnome.NautilusPreviewer`, object `/org/gnome/NautilusPreviewer`, interface `org.gnome.NautilusPreviewer2`: `ShowFile(s uri, s windowHandle, b closeIfAlreadyShown, s activationToken)`, `Close()`, signal `SelectionEvent(q direction)` (arrow pressed inside the previewer), properties `Visible`, `ParentHandle` | `gdbus introspect --session --dest org.gnome.NautilusPreviewer` [verified] |
| Show in Files / properties | `org.freedesktop.FileManager1` (`ShowItems`, `ShowItemProperties`, `ShowFolders`), implemented by Nautilus | [inference, standard interface; the existing code already calls `org.gnome.Nautilus.FileOperations2`] |
| Trash and restore | `Gio.File.trash_async`; restore = `Gio.File.move` from the item in `trash:///` (found by `trash::orig-path`) back to the original path, as Nautilus does | [inference, GIO API] |
| Layout-independent Ctrl+C | `event.get_key_code()` is the xkb keycode (evdev + 8), the same physical key in every layout; the keysym is layout dependent (`Cyrillic_es`) | table in 11.2 [source: xkb] |

**What this means for the design.** (1) Copy/cut puts *one* mimetype on the clipboard: `x-special/gnome-copied-files`, which is exactly what Nautilus and GTK file choosers paste (cut vs copy included); pasting files into a browser or chat from the clipboard needs `text/uri-list`, which a single-mimetype source cannot also offer, so the context menu has *Copy Path* (`text/plain`) and, for one image, *Copy Image* (`image/png`) next to *Copy*, and drag and drop (section 5) is the path for other apps. A multi-mimetype clipboard needs a client-owned selection (a helper that holds keyboard focus to get a serial): ticket "multi-format clipboard helper" (deferred). (2) Everything that must travel to another app or arrive from another app goes through helper Wayland clients: `fileDrops.js` already does it for drops, and section 5 adds the drag-out helper.

## 4. Interaction model

### 4.1 Vocabulary

*Dropdown* = the popover a stack opens: the Fan (`DockItemList`, dockItemMenu.js), or the Grid or List panel (`StackPanel`, stackPanel.js). *Item* = a file, folder or recent app, addressed by its `number` (reading order across all batches). *Selection* and *focus* as defined in 11.1. *Writable stack* = a folder stack (not Recents) whose folder is writable (`Gio` `access::can-write`); Recents (apps) and read-only folders disable cut, paste, rename, trash.

### 4.2 State machine of an open dropdown

```
            open (click on the dock item)
closed ───────────────────────────────► BROWSE  (selection = initialSelection, keyboard owned by the dropdown)
  ▲                                       │  │ Space ................ PREVIEW  (Quick Look; Space/Esc back to BROWSE)
  │ Esc / click outside / item opened /   │  │ F2 ................... RENAME   (inline entry; Enter/Esc back)
  │ Super tap / overview / drag started   │  │ right click, Menu key . MENU     (PopupMenu owns keys; closes back to BROWSE)
  └───────────────────────────────────────┘  │ press on item, move > threshold ... DRAG (section 5; the dropdown closes)
                                             │ Ctrl+Shift+N .......... RENAME of the new folder
```

One keyboard owner at a time: `commandFor(press, ctx)` of 11.2 takes `mode` and returns the command or `null` (propagate). Escape closes the innermost thing: preview, then rename (cancel), then menu (the menu handles itself), then the dropdown.

### 4.3 Selection and navigation (details in 11.1)

- **Default selection:** when the dropdown opens the first item is selected and focused (Grid and List: the item at the top left; Fan: the item nearest the dock). Nothing is selected in an empty stack. The selection is visible immediately (4.8).
- **Arrows:** Up/Down/Left/Right as in Finder icon and list views, no wrap-around, Home/End, PageUp/PageDown by `pageRows` rows; the view scrolls to keep the focus visible (`StackContent.ensureVisible(number)` exists on the grid-speed branch; the fan has no scroll).
- **Shift+arrow** grows a range from the anchor; **Ctrl+arrow** moves the focus ring only; **Ctrl+Space** toggles the focused item; **Ctrl+A** selects all.
- **Type-to-select:** typing letters within one second jumps to the first file whose name starts with them (case-insensitive; the same letter repeated cycles through the matches; Cyrillic works because the typed character, not the key, is matched).
- **Pointer:** a plain click opens (macOS); Ctrl+click toggles, Shift+click selects a range, neither opens; a click on empty space inside the popover clears nothing (the default selection stays). Moving the pointer over an item selects it (hover = select, as in macOS menus) unless several items are selected; the hover select fires only on real pointer motion, never because the content scrolled or the dropdown opened under a stationary pointer (compare the pointer position with the last one).
- **Enter / double click / Ctrl+O** open the selected items: a file in its default app (`Gio.AppInfo.launch_default_for_uri_async`), a folder in Files (Grid: navigates into it, see 7.3), a recent app launches. Several items open all of them. The dropdown closes after opening (macOS), the dock icon bounces once.

### 4.4 Hotkeys (full map in 11.2)

| Action | Keys | Notes |
|---|---|---|
| Open | Return, Ctrl+O | |
| Quick Look | Space | 4.5 |
| Copy / Cut / Paste | Ctrl+C / Ctrl+X / Ctrl+V | files on the clipboard as `x-special/gnome-copied-files`; cut items are dimmed until pasted or the clipboard changes; paste goes into the stack's folder (or the folder Grid is navigated into) |
| Select all | Ctrl+A | |
| Move to Trash | Delete, Ctrl+Backspace | with an Undo toast |
| Delete permanently | Shift+Delete | confirmation dialog |
| Rename | F2 | inline; Enter commits, Esc cancels; collision gets the `keep-both` suffix |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y | last trash, move, copy, rename, new folder of this session (`UndoLog`) |
| New Folder | Ctrl+Shift+N | writable folder stacks only, goes into rename |
| Copy path | Ctrl+Shift+C | `text/plain`, paths newline separated |
| Show in Files | Ctrl+R | `FileManager1.ShowItems` |
| Properties | Alt+Return, Ctrl+I | `FileManager1.ShowItemProperties` |
| Close | Esc | |
| Anything with Super, the layout switch, modifier-only presses | untouched | propagate to the Shell: with the input-grab work (ticket [#36](https://github.com/alex-mextner/hyperdock/issues/36)) the dropdown holds `POPUP`; our handler returns `null` for them |

**Coexistence with the input-grab work.** The dropdown keeps `pushPopoverGrab(actor)` of `popoverInput.js` (branch dropdown-input-grab): `Main.pushModal(actor, {actionMode: Shell.ActionMode.POPUP})`. Key events reach the actor's `key-press-event` only for combinations the Shell did not take as keybindings; `Super+Space` and a Super tap never arrive, and our map returns `null` for anything with `super` or a bare modifier, so the two cannot fight. The single hook is H2 (section 10): `StackPanel._connectBackdrop`'s key handler calls `interaction.onKey(event)` and returns its `EVENT_STOP`/`EVENT_PROPAGATE`. Typing: letters use `event.get_key_unicode()`; a context menu (`PopupMenu`) takes its own nested grab and keys while it is open (mode `menu`).

### 4.5 Quick Look (Space)

- **Built-in overlay (`stackPreview.js`), always available:** a panel above the dropdown (the dropdown stays under it, dimmed): the picture for images (decoded by `St.TextureCache.load_file_async` at up to 90% of the work area, aspect kept), the first 4 KiB as text for text files, the freedesktop thumbnail or the big type icon for anything else, and under it the name, size, type and date. Left/Up and Right/Down show the previous/next *selected* item, or the neighbours of the focus when one item is selected; Space or Esc close it (Esc once = close the preview only). A multi-selection shows `n of m`.
- **Sushi for what the overlay cannot show (video, audio, PDF pages, office documents, archives):** when `org.gnome.NautilusPreviewer` is activatable (checked with `ListActivatableNames`), Space on such a type calls `ShowFile(uri, '', false, '')`. Sushi is a normal window, and while the dropdown holds its modal grab the compositor routes no pointer input to clients at all [verified, probe `e0`, section 5.1], so the dropdown releases its grab while Sushi is visible (it watches `Visible` through `PropertiesChanged`) and listens to `SelectionEvent(direction)`: it moves the focus and calls `ShowFile` again with the new URI (`closeIfAlreadyShown` false); when `Visible` turns false it takes the grab back. Without Sushi the built-in card is used.
- Decision rule (pure, in the glue): `image/*` and `text/*` use the built-in overlay, other types use Sushi when available, else the built-in card.

### 4.6 Rename

F2 or the context menu *Rename* on a single item replaces its name label by an `St.Entry` holding the name with the extension excluded from the initial selection; `commandFor` mode `rename` hands every key except Enter and Esc to the entry. Enter commits through `stackFileOps.rename` (collision: `uniqueName` keep-both, the toast says so), Esc or focus loss cancels. The key grab stays on the dropdown; the entry gets `grab_key_focus()`. Input methods work because the entry is a real `St.Entry`.

### 4.7 Context menus

Built with `PopupMenu.PopupMenu` from the entries of `stackMenuModel.js` (11.9), anchored at the click point on the dropdown's layer, opened through a `PopupMenuManager` (its grab nests on the dropdown's; `attachMenuToOverlayKey` from the input-grab branch keeps Super working). Menu key and Shift+F10 open the item menu at the focus item. While a menu is open the dropdown is in mode `menu`.

**On an item (right click on a cell; if the item is not selected it becomes the selection first):**

| Entry | Accel | When |
|---|---|---|
| Open | Return | always |
| Open With ▸ (one entry per `Gio.AppInfo.get_all_for_type`, default first) | | exactly one item selected, at least one app |
| Set as Wallpaper | | one image |
| - | | |
| Quick Look | Space | |
| - | | |
| Copy | Ctrl+C | folder stack |
| Cut | Ctrl+X | writable |
| - | | |
| Rename | F2 | one item, writable |
| Move to Trash | Delete | writable |
| - | | |
| Copy Path | Ctrl+Shift+C | |
| Show in Files | Ctrl+R | |
| Properties | Alt+Return | |

For an item of the **Recents** stack (an app): Open, separator, Remove from Recents. No Share entry (GNOME has no share service to call [inference]).

**On the empty background of the popover:** Paste (Ctrl+V; enabled when the clipboard holds files and the stack is writable), New Folder (Ctrl+Shift+N), Undo (Ctrl+Z; enabled when the log has an entry), separator, Select All (Ctrl+A), separator, Sort by ▸, Group by ▸, View as ▸ (the same radio entries the dock item's menu has, current choice marked), separator, Open in Files. For Recents: Clear Recents, View as.

### 4.8 Names, selection look, caption

- **Selected / focused look.** Selected cell: a rounded plate behind the icon in the system accent colour at 55% alpha (`St.Settings.get().accent_color`, the `accent-color` property exists in the GI data; white at 22% when unavailable) and the name on an accent pill; the focus ring (when the focus is not the only selected item) is a 1 px white 70% outline; hover without selection change shows the existing white 16% plate. Cut items: icon opacity 50%.
- **Grid label:** `cellName()` of the grid-speed work (two lines, start and end kept). **List label:** middle ellipsis (`Pango.EllipsizeMode.MIDDLE`), not END. **Fan label:** the pill keeps the existing look; the name is cut in the middle at 48 characters instead of the tail at 32; the selected entry's label is highlighted with the accent and never fades.
- **Caption line (`stackCaption.js`, pure `captionFor(items, now)`):** a one-line status above the *Open in Files* button: for one item `Screenshot From 2026-10-30 19-41-08.png - 1.2 MB - Today 19:41`; for several `3 items selected - 4.1 MB`; folders show `Folder - 12 items`. This is what makes every name readable whatever the cell width, and it costs one label.
- **Tooltip:** none (the caption replaces it; a tooltip under a modal grab is flaky).

## 5. Drag out of a dropdown

Source: the DragOutSpike experiments in sandboxed nested shells (code and raw results summarised in `docs/spikes/DRAG_OUT.md`). Only **virtual** pointers and our own GTK4 test windows were used; no physical mouse, touchpad or touch screen, and no real Files, browser or chat app. The design below is therefore a verified mechanism with a stated list of what only the user's session can confirm (5.9).

### 5.1 What is possible and what is not [verified]

1. Only a Wayland **client** can start a drag that other apps can receive (`wl_data_device.start_drag(source, origin_surface, icon, serial)`). `Meta.Dnd` and `Meta.Selection` have no way to start one (API enumeration; `Meta.SelectionType.SELECTION_DND` exists but setting it starts no drag grab [inference from mutter source]).
2. mutter accepts `start_drag` only for a `serial` that equals the **button press serial** the origin surface received while the pointer focus is on that surface and a button is down (`meta_wayland_seat_get_grab_info(require_pressed=TRUE)`, `meta-wayland-pointer.c:1451-1457`).
3. **Under any `Main.pushModal` a client receives no pointer event at all, not even `enter`** (probe `e0`: with a full-stage or small modal actor the sink window saw nothing and the grab actor got the clicks; after `popModal` the sink saw enter, motion, press, release, leave). So the dropdown's modal grab and a client drag cannot coexist.
4. Shell-internal DnD (`imports.ui.dnd`) takes its own modal and a Wayland window under the pointer never sees it: it can reorder dock icons, it can never reach another app.
5. Handing off the user's own button does **not** work: a synthetic release+press of button 1 while the physical button is held is dropped by mutter's seat (per-evdev-button counter, `meta-seat-impl.c:1005-1015` "Drop any repeated button press (for example from virtual devices)"; a virtual device ignores a release it never pressed, `meta-virtual-input-device-native.c:339-346`; log line `Received multiple virtual 0x110 button releases (ignoring)`).
6. Pressing a **different** button from a virtual device while button 1 is physically held **does** work: the client gets a legitimate press serial with `button_count > 0`, starts the drag, and the drag then follows the physical button 1 and the pointer motion; the physical release drops. That is the technique below.

### 5.2 The technique: pointer handoff with a spare mouse button

A long-lived helper client (a gjs/GTK4 process spawned at enable through `Meta.WaylandClient.new_subprocess`, the pattern of `fileDrops.js`; `apps/drag-out.js`) owns a small undecorated window and the `Gdk.Drag`. Sequence, all verified end to end in the nested shell against the **real `StackPanel`** (probe `real`):

1. **Arm.** A cell's `St.DndStartGesture` (`manual_mode: false`, the same threshold object `imports.ui.dnd` uses; `get_point_begin_event()`, `get_drag_triggering_event()`) recognises a press of button 1 that moved beyond the threshold (`Meta.prefs_get_drag_threshold()`, 8 px by default). Buttons 2 and 3 never start it.
2. **Guard.** `global.get_pointer()[2] & BUTTON1_MASK` must still be set; if the button is already up, abort: nothing is injected (probe `t80`: a release 5 ms after `show` aborted cleanly).
3. **Close the dropdown and release every grab:** `panel.close()` (pops the modal, makes the backdrop non-reactive) or `_destroyList()` for the fan. Raise the helper's layer **above everything else** (re-raise after the popover was added; a layer below the later-added backdrop never got `enter`, probe `t83`).
4. **Place the handoff window:** `move_resize_frame(false, px - w/2, py - w/2, w, w)` with `w >= 160` centred on the pointer, then `drag <icon> <uri>...` and `show` to the helper; wait for the window's `shown` (17-19 ms warm; ~250-300 ms for the very first show of a cold helper). The window has DOCK type, is hidden from the window list and sticky, as in `fileDrops.js`. No pointer nudge is needed: mutter re-picks the pointer focus when the surface appears (`enterWithoutNudge: true` in every trial).
5. **Inject:** from a virtual pointer device `notify_button(now, 9, PRESSED)` at the same coordinates (button 9; buttons 2, 3, 8 also worked; **never button 1**). The client sees `enter`, `pressed(button 9)` and calls `Gdk.Drag.begin(...)` from that press (a `GestureClick`; a `Gtk.DragSource` did not start with an extra button, probe `t10`). The Shell sees `Meta.Dnd` `dnd-enter` ~2 ms after the press: the drag is running.
6. **Drag:** the drag follows the physical button and pointer; the existing `fileDrops.js` layer handles the dock targets unchanged (Downloads stack: the file moved; Trash: trashed through the GIO fallback; both verified), Escape cancels (`dnd-leave`, the sink saw `drag-leave` and no drop), the physical release drops. The helper may hide its window 50 ms after `drag-begin`; the drag survives (destroying the origin surface would end it).
7. **Finish:** on `dnd-leave` (or `dragEnd`) release button 9 from the same virtual device (~100 ms later in the runs; the release **must always be sent** or the device destroyed, whose finalizer releases held buttons; otherwise the seat keeps count 1 for that button and later real presses of it are dropped) and hide the helper. Use `dragEnd{action}` from `Gdk.Drag` `dnd-finished` as the end signal: `drag-cancel` alone fired early with `reason 2` in several drags that still succeeded.

Timing, warm helper: popModal to `dnd-enter` about 21 ms in total. Cold-start pitfall: a freshly spawned helper failed reproducibly with the first extra-button handoff (mutter never started the drag; the icon surface got no role). It worked when the helper had shown and hidden a window once, when the window was 160 px or larger, or when the pointer first moved 150 ms after the press. **Mitigation (required):** spawn the helper at enable, let it map and unmap one window after `ready`, and use a window of at least 160 px.

If no `dnd-enter` arrives within 100 ms of the injected press the Shell treats the handoff as failed: release the button, hide the helper, show the toast `Could not start the drag` and log the details (retry once with another spare button when the first failure was the cold-start case). A user who physically holds the chosen spare button at that moment would see the press swallowed by mutter's de-duplication; the retry with a different button covers it.

The helper protocol (stdin lines, stdout JSON lines):

```
stdin   drag <iconPath> <count> <uri>...   arm the payload (uri-list bytes + Gdk.FileList union, COPY|MOVE, icon from the file)
        show                                present the undecorated window (the Shell places it first)
        hide                                unmap (a running drag survives)
stdout  {"ready": true}
        {"enter": true}   {"pressed": {"button": 9}}   {"dragBegin": true}
        {"dragEnd": {"action": 0|1|2}}      0 refused/cancelled, 1 copy, 2 move
```

### 5.3 Fallback if the handoff misbehaves on real hardware: surface under the press

Probe `altA`: a transparent helper surface mapped **before** the press, over the item, in a layer above the popover and **without** `Main.pushModal` receives the real physical button-1 press (`clientEnter`, `pressed(1)`, `dragBegin`, `dndEnter` all true) and `Gtk.DragSource` or `Gdk.Drag.begin` work. The cost is large: the covered Shell actors see nothing (not even hover; the helper would have to report hover and click per item), and the popover cannot be modal (Escape, click-outside and the keyboard plumbing of section 4 would need a non-modal design). It is documented as the fallback and is **not** the plan. Slice S8's first step is a real-device smoke test of the handoff (5.9); only if it fails is the fallback designed.

### 5.4 What is dragged

| Dragged | Payload | Actions | Icon |
|---|---|---|---|
| file or folder of a folder stack | `text/uri-list` and `Gdk.FileList` of the `file://` URIs | COPY and MOVE (Nautilus and dock stacks decide; an app that only reads the data gets a copy) | the file's thumbnail (freedesktop cache) or its type icon, 64 px |
| several selected items (the dragged item is in the selection) | all of them | same | the first thumbnail with a count badge |
| an item not in the selection | that item alone, and it becomes the selection | same | as one item |
| an app of the Recents stack | the URI of its `.desktop` file | COPY | the app icon |

Dropping a file URI list on the dock: the table 11.6 applies (stack, Trash, app icon, gap). Dropping on another app: a URI list is what GTK, Qt and Electron apps read; browsers accept it on upload areas that take files. The clipboard path (copy and paste, section 9) remains the way for apps that read a `text/uri-list` from the clipboard (feature F2).

### 5.5 Click versus drag, and the fan

A press that does not move beyond the threshold is a click (open, select, menu) in all three views; the click handlers are `clicked` of the cell (Grid, List) and the click of the entry (Fan, section 10 H5). After a drag started the dropdown is already closed, so no click can fire. In the fan the press **no longer opens** anything (today's root cause 2 of 2.1).

### 5.6 Interaction with the other grabs

The input-grab work gives every popover `POPUP` mode; the handoff calls the panel's normal `close()` first, which already runs its `_releaseGrab` and `popModal`. A context menu open at that moment closes first (it cannot, a press on a cell closes it, so this is a no-op). `autohide`: the dock stays up while the drag is in flight (`holdForDrag`, existing).

### 5.7 Test plan

`stackint-dragout` (nested, isolated bus): press on the first cell, move 12 steps, release over (a) the test sink window, (b) the Downloads stack item, (c) the Trash item, (d) empty desktop; asserts the sink got the URIs, the stack got the file, the Trash got it, nothing happened for (d) and the file stayed; Escape in flight cancels; a press and release without motion opens (stub log); a two-item selection drags both with the badge (screenshot of the drag icon: the nested `Shell.Screenshot` does not capture the client drag icon, so the proof of the badge is the PNG the helper composed, attached to the ticket). Evidence format: the probe's JSON lines (`enter`, `pressed`, `dragBegin`, `dnd-enter`, `drop-data`, timings).

### 5.8 Things that go wrong and what the code does

| Case | Handling |
|---|---|
| physical button released before the window is mapped | abort, inject nothing, helper hidden (verified `t80`) |
| the dropdown was already closing | the handoff starts only from a live panel; ignore the gesture otherwise |
| the drag is refused by the target | `dragEnd{action:0}`: nothing to do; the folder watcher keeps the dropdown content right |
| a MOVE completed | `dragEnd{action:2}`: the watcher refreshes; the undo log is **not** written (the destination app did the move) |
| the helper dies | the existing restart policy of `fileDrops.js` (backoff, five quick crashes give up) is reused; the gesture then does nothing and the toast says `Drag out is unavailable` |
| two monitors | the helper window is placed in global stage coordinates, the layer covers the stage |

### 5.9 Only the user can verify

The handoff was proven with a virtual pointer inside a headless native backend (the same `MetaSeatImpl` code path as a real session, but not a libinput device). On the real session: a physical mouse, a touchpad (tap-and-drag), and a touch screen (a virtual touch sequence was not tested and a touch drag ignores the pointer sprite), and the real receivers (Files, Firefox, Chrome, Telegram). The S8 ticket's last acceptance item is that smoke test.

## 6. Drop onto a group and onto the dock

Source: the DropInSpike experiments (an extended copy of the helper and of `fileDrops.js`, an 8-payload x 8-target matrix, in sandboxed nested shells: private bus whose only service directory is empty, display variables unset, temporary `HOME`, a mock or absent Nautilus). The test drag source is a GTK4 client of our own offering the payloads below, **not** real Nautilus, Firefox or Chrome; the payload shapes follow the documented GTK, Firefox and Chrome conventions. The prototype helper and the shell-side patch are kept in `docs/spikes/dropin/` as reference for slice S9-S13; they are prototypes, the modules of section 11 replace their parsing.

### 6.1 How a drop reaches the Shell (recap) [source, verified]

A drag started in another app delivers its drop **and its data only to a Wayland surface** (the Shell gets hover positions through `Meta.Dnd`, never the drop). `fileDrops.js` therefore maps one transparent `Gtk.DropTargetAsync` window per dock (`apps/file-drops.js`, type DOCK, placed in its own layer above the docks) while a drag is in progress and asks the helper about it over a line protocol. The Shell tracks the hovered dock item itself (`dock._hoveredIcon`, the **nearest** icon, never null inside the dock rectangle) and decides the target (`_targetFor`) and the action (`_perform`). Section 6 changes the decision logic (table 11.6) and adds what the helper reads and tells.

### 6.2 What the baseline does today [verified, matrix in the nested shell]

| Dragged | onto a stack (Downloads / Screenshots) | onto the Trash | onto an app icon | in a gap / empty dock / outside |
|---|---|---|---|---|
| file, folder | moved (same file system) or copied (Ctrl, or another file system); a name collision **fails silently**: `Error moving file ...: File exists` (`Gio.FileCopyFlags.NONE`) and the file stays where it was | trashed | opens in the app when the app's `.desktop` has `%U/%f` (`supports_uris/files`); an app without them (the fixture editor) is refused | a gap hits the **nearest app icon** and opens the file in it (surprising); empty dock / outside: refused |
| `.desktop` file | **moved into the folder** (the launcher is treated as a file) | trashed (the launcher is deleted) | opens (passed as a file) | as files |
| web link (Firefox `text/x-moz-url`, Chrome `text/uri-list`) | accepted, then `copy https://... Gio.IOErrorEnum: Not Found`: **gvfs-http really fetches the URL** (a network call from a dock drop; hazard) | `Operation not supported` | app with `%U` opens it, the title is lost | as files |
| text, image data | never reaches the helper (a text-only or image-only drag offers no formats the target accepts, so there is no `drag-enter`) | | | |

Helper-side formats seen: a file from GTK: `GdkFileList GFile gchararray text/uri-list text/plain;charset=utf-8`; a Firefox link: `GdkFileList GFile gchararray text/x-moz-url text/uri-list text/plain text/html`; Chrome: `... text/uri-list text/plain text/html`. Autohide works (the drop rectangle comes from the strut and the dock reveals on entering it).

Findings that matter for the user's complaint "drop onto a group must work":

1. **`file-drops` ships off** (`gschema.xml:305` default false, README advertises it without saying so). The user has it on, so for him the likely causes are the next two.
2. **A collision loses the drop silently** (the move fails and nothing tells the user).
3. **Nothing shows what the drop will do**: the dock magnifies around the pointer, but there is no highlight on the target, no insertion marker, no copy/move/refuse feedback (screenshot during the drag).
4. A drag cannot start from, or end in, an open dropdown: the modal backdrop of the panel (or the monitor-sized actor of the fan) takes the press.
5. Real Nautilus and real browsers were not exercised (only our GTK client and a mock `org.gnome.Nautilus.FileOperations2`): the nested proof of S9 uses the same sources, so the closing note asks the user to try Files and Firefox for real.

### 6.3 Transfer rules (the one decision point: `stackTransfer.js`)

For `move-or-copy` (a stack or mounted volume as target):

1. Source `file:` URIs only. A non-file URI (http, trash, smb) is **refused**, never handed to GIO (finding above).
2. A file already in the target folder: skipped silently (existing behaviour); a folder dropped onto itself or into its own subtree: refused with an error toast.
3. Same file system: move; other file system: copy. **Ctrl or Alt forces a copy, Shift forces a move** (existing rules, Alt is Option). The modifiers are read when the drop happens (`global.get_pointer()`), and the drag cursor changes with them (helper `drop.status(COPY)` always; the Shell shows the `+` badge by the target label).
4. Name collision: `uniqueName(name, taken, 'keep-both')` for everything we perform ourselves (`a.png` -> `a 2.png`); for the Nautilus path Nautilus's own conflict dialog applies. The toast names the result: `Moved to Downloads as "a 2.png"`.
5. Directories, cross-file-system copies and batches over 20 files go to `org.gnome.Nautilus.FileOperations2` (`MoveURIs`, `CopyURIs`, `TrashURIs`) when its bus name is owned (progress and conflict dialogs for free), else the GIO fallback (recursive copy, same keep-both rule). Operations done by GIO are logged in the `UndoLog`; the toast offers Undo; Nautilus ones are not logged.
6. A `.desktop` file dropped on a stack is an ordinary file (it is moved/copied), as in the baseline; the dock gap is where it pins (6.4).

### 6.4 Where on the dock a drop lands: onto an item, or between items

`dropSlot(slots, x, y, vertical, {ontoShare: 0.5})` (11.7): the middle half of an item that accepts the drop is **onto** it, the outer quarters and the gaps are **between** (insertion index = number of items before the gap). The prototype used the same split (a fraction below 0.25 or above 0.75 of the hovered item's rectangle is the gap before or after it; verified: a launcher dropped in a gap pins at index 1, at the left end 0, at the right end 3).

| Item under the pointer | Accepts `onto` | What a drop does |
|---|---|---|
| folder stack, mounted volume | files, folders, images, `.desktop` files as files | `move-or-copy` (6.3) |
| Trash | local files and folders | `trash` |
| app icon (favourite) | files and URLs when its launcher has `%U/%f/%u/%F` (checked with `GAppInfo.supports_uris/files`) | `open-with`; an app that takes neither is not a drop target (the gap logic applies) |
| web link, file link, Recents, tile, separator, apps icon | nothing | not a target (gap logic) |
| gap, empty dock area | - | the `dock` column of the table 11.6 |

The favourite apps are on the left of the separator and everything else on the right; a drop of a folder, link or file **between two favourites** lands at the *start of the group* (macOS refuses to put folders there; we snap them to the group, with the marker drawn at the group's left edge), and a drop of an app **between group items** appends to the favourites. The stack run, link run and the Trash keep their order (`clusterOrder`).

### 6.5 What the helper reads and says (extended protocol, prototype tested)

The helper's `Gtk.DropTargetAsync` formats widen to `text/uri-list`, `Gdk.FileList`, `text/x-moz-url`, `text/plain` (+`;charset=utf-8`), `text/html` and `image/png`. Helper to Shell, one JSON line each:

```
{"enter": {"drag": N, "formats": ["text/uri-list", ...]}}       first contact: the Shell can already choose the cursor
{"peek":  {"drag": N, "uris": ["file:///..."]}}                  uri-list read before the drop (so a folder/app/file target can be refused early)
{"drop":  {"drag": N, "uris": [...], "formats": [...],
           "payloads": {"text/x-moz-url": "<base64>", "text/html": "<base64>", "text/plain": "<base64>", "image/png": "<base64>"}}}
{"accepted": N}  {"leave": N}  {"ready": true}                   unchanged
```

`payloads` is filled only for non-file drags and capped (64 KiB x-moz-url, 256 KiB html and plain, 16 MiB image). The Shell decodes base64 with `GLib.base64_decode`, turns the Firefox payload into text with `webLinks.decodeMozUrl` and calls `dropClassify.classifyPayload` (11.6). The `peek` message is untested with real Chrome, Firefox and Nautilus (caveat).

### 6.6 Feedback while dragging (S9-S13)

- **Target highlight:** the hovered accepting item gets an accent ring and its dock label becomes the action: `Move to Downloads`, `Copy to Downloads` (Ctrl/Alt), `Open with Firefox`, `Move to Trash`; a refusing target shows no ring and the refuse cursor (helper `drop.status(0)`).
- **Insertion marker (`dockDropMarker.js`):** the gap opens under the pointer with the dock's existing add-favourite width animation (layoutScenarios #1) and a 3 px accent line stands in it; the item that will be created is not drawn until the drop.
- **Refusals** say why in a two-second toast (`Only folders and files can go in a stack`).

### 6.7 Spring loading (S15) [verified constraint, design open]

macOS opens a folder stack after a hover so you can drop into a sub-folder. The prototype shows what must change first: a client drag cannot start while a *modal* dropdown is open; the spring emulation fires 600 ms after hover, the Fan (non-modal) opens but the helper gets `leave` 25 ms later and the drop is lost (`cancel:2`), and the Grid panel (`Main.pushModal`) **wedges the client drag** (no end, no cancel, no `Meta.Dnd` leave). So S15 needs a *spring presentation* of the dropdown: no modal grab, the drop layer above it, a helper drop window over its rectangle that reports the pointer (`{"motion": {"drag": N, "x": X, "y": Y}}`) so the Shell can find the cell under it; closing when the drag ends or leaves. This is why S15 is last and carries a feasibility step first.

### 6.8 Test plan for this section

`stackint-dropin` (nested): the source client of the spike (8 payload rows), targets stack, Trash, app, gap, empty dock, outside; asserts the decision table cell by cell, collision keep-both, Ctrl copy, same-file-system move, the favourites order after a gap drop, `folder-stacks` / `dock-links` contents, and that nothing real was touched (temp folders only, mock Nautilus). The pure part is `drop_classify_check.js`, `drop_slot_check.js`, `web_links_check.js`.

## 7. Folders as stacks

### 7.1 What already exists [source]

`folder-stacks` (gschema, string JSON array) lists extra folders; each entry is a path string or `{path, title?, icon?, view?, sort?, display?, group?}`; `stackSources.folderStackSpecs` turns the entries (plus Downloads and the built-in Screenshots) into stack specs; `services.setupFolderStacks` builds items with watchers; `stackDock.syncFolderStacks` creates dock items; "Display as Stack" renders the pile (`stackPile.js`, `apps/stack-pile.js`); the per-stack menu persists options by rewriting the entry (`withStackOption`). `prefs.js` can add and remove entries. Missing: adding a folder from the dock (drop), and everything inside the dropdown.

### 7.2 Dock side (R9 folders, R10)

- Dropping a folder (or several) on the dock between items or on the dock's empty area (action `add-folder` of 6.4) appends `{ "path": <folder>, "display": "stack", "view": "automatic", "sort": "date-added", "group": "none" }` to `folder-stacks` through `folderStackEntries.addFolder` (11.8): explicit fields, so a later change of a default never changes the user's stack. The new stack item appears at the insertion point *within the stack run* of the group (position = index among the folder stacks).
- A folder already shown (same normalized path, symlinks resolved) is not added twice; the existing item bounces instead.
- Dropping a folder **onto** an existing stack means "move/copy it into that folder" (R8), not "add": the item is a drop target, the gap between items is the add target (6.4).
- Remove: dock item menu *Remove from Dock* (new entry, removes the entry through `removeFolder`), or drag the item off the dock (the existing drag-off gesture of `dragOff.js` applies to extra items too: the slice extends `removalKind` with `{ stack: true }`).
- `Display as` default for dropped folders is **Stack** (the user's wish: folders as stacks); the *Folder* alternative stays in the menu.
- Migration: none needed. Entries stay valid as they are (`normalizeEntries` tolerates strings and objects and unknown fields); the only schema addition is optional fields, listed in 7.4.

### 7.3 Inside the dropdown

- **Grid:** a sub-folder cell shows the folder icon with an item-count badge. A plain click navigates into it: the dropdown title becomes the folder's name, a **back button** (‹) appears at the top left, Backspace and Alt+Left also go back, and the items, selection and caption are those of that folder (sorted/grouped with the stack's options). Esc leaves the dropdown, not the folder level. *Open in Files* opens the current level. This is the macOS behaviour [macOS: macsales, Mainspring].
- **List:** a sub-folder row has a chevron; Right arrow or a click expands it in place (one level, indented, with its own rows in the selection order), Left collapses; Return opens it in Files. [macOS shows submenus.] Slice order: Grid navigation first, List expansion second.
- **Fan:** a folder entry opens in Files (macOS).
- **Pure model `stackNav.js` (spec only; implemented in the slice):** `{ stack: [{path, title}] }` with `enter(nav, entry)`, `back(nav)`, `current(nav)`; the dropdown rebuilds its items for `current(nav)`.

### 7.4 Per-folder options and optional entry fields

Sort, group, view and display persist per folder exactly as today. New optional entry fields: none required. A later `"id"` is not needed because the path is the identity.

## 8. Web links and files on the dock

### 8.1 Data model

New setting `dock-links` (gschema type `s`, default `'[]'`): a JSON array in dock order of

```json
{ "kind": "url",  "url": "https://example.com/a?b=1", "title": "Example Domain" }
{ "kind": "file", "path": "/home/u/Documents/notes.pdf", "title": "notes" }
```

`kind` `url` is the R9 "link to a web page", `file` is "maybe something else" (a document pinned to the dock; macOS allows files right of the separator). `url` is the output of `webLinks.normalizeUrl` (http and https only); `title` is optional (empty = the host name); `linkKey(url)` de-duplicates. Pure helpers: `webLinks.addLink/removeLink` (11.6). Invalid entries are skipped when the dock builds its items and never rewritten (the user's JSON survives a bug).

### 8.2 Where it lives and how it looks

- **Group order:** `separator, mount, recents, downloads, stack, link, tile, trash`: one new role `link` in `CLUSTER_ROLES` of `stackModel.js` (one line) and `roleOf` of `stackDock.js`. Links stand with the stacks right of the separator, before the minimized-window tiles and the Trash (macOS: files and links right of the separator).
- **Icon (no network):** a url link shows the system default browser's icon (`Gio.AppInfo.get_default_for_uri_scheme('https')`) with a rounded badge holding the first letter of the host (without `www.`) on a colour derived from the host; a file link shows the file's thumbnail or type icon (with the shortcut-less look macOS has). Favicon fetching is a later opt-in (privacy: it contacts the site), key `dock-links-fetch-titles` default false, ticket deferred.
- **Label:** the title; the host when empty.
- **Activate:** click opens the url with the default handler (`Gio.AppInfo.launch_default_for_uri_async`) and bounces; Shift+click does the same (browsers decide about windows); a file link opens the file. Middle click: same.
- **Menu (right click):** Open, Edit... (a small `ModalDialog` with title and URL entries; saving validates with `normalizeUrl`), Copy Link, Remove from Dock. File link: Open, Show in Files, Remove from Dock.
- **Drop on it:** a link item takes no drops (only app icons, stacks and the Trash do, see the table of 11.6); the pointer shows no drop target over it.

### 8.3 Adding

Drop of a URL / `text/x-moz-url` / a link from the browser's address bar or page onto the dock gap or empty dock area (6.4) adds a `url` link at the insertion index within the link run; a file onto the gap adds a `file` link; the dock animates the gap open under the pointer (the existing add-favorite animation of `layoutScenarios.js` #1) and the new item appears with a bounce. Title: from the payload (`text/x-moz-url`, `_NETSCAPE_URL`, `text/html` anchor text), else empty. A link already present moves nothing and bounces its item.

## 9. File operations, clipboard, trash and undo

### 9.1 Module split

| Module | Pure? | Does |
|---|---|---|
| `stackClipboard.js` (11.3) | pure | payload strings and parsing |
| `stackClipboardGlue.js` | Shell | `St.Clipboard.set_content(CLIPBOARD, COPIED_FILES_MIME, bytes)` for copy/cut; reads with `St.Clipboard.get_content`; remembers the cut set; `Meta.Selection` `owner-changed` clears the cut dimming |
| `uniqueName.js` (11.4), `undoLog.js` (11.5) | pure | collision names; undo plans |
| `stackFileOps.js` | Gio | trash (`trash_async`), restore (find the item in `trash:///` by `trash::orig-path`, `Gio.File.move`), move into a folder, copy a file, rename, new folder, permanent delete; every operation appends to the `UndoLog` and returns the list of paths it touched |
| `stackTransfer.js` | Gio + D-Bus | the existing `FileDrops._transfer` rules moved out of `fileDrops.js`: same file system -> move, else copy, Ctrl/Alt forces copy, Shift forces move; directories and cross-file-system copies and big batches go to `org.gnome.Nautilus.FileOperations2` (progress, conflict dialogs) when its bus name is owned, else a recursive GIO copy; collisions: `uniqueName` keep-both for what we do ourselves |
| `stackToast.js` | Shell | one-line pill above the dock: `Moved 3 items to Trash  [Undo]`, 6 s, progress bar for operations over 700 ms |
| `stackDialogs.js` | Shell | the permanent-delete confirmation (`ModalDialog`) and the link editor |

### 9.2 Semantics

- **Copy / Cut:** put `buildCopiedFiles(uris, cut)` on the clipboard. Cut dims the items in every open dropdown of the stack until paste or until the clipboard owner changes. Nothing is deleted at cut time.
- **Paste:** parse `x-special/gnome-copied-files` (fallback `text/uri-list`, then `text/plain` lines that are absolute paths or `file://` URIs); target folder = the stack's folder (Grid: the navigated folder); `pasteMode` decides move or copy; the transfer rules of `stackTransfer` apply; a cut paste clears the clipboard afterwards. Items already in the folder are skipped (copy of an item into its own folder uses `uniqueName` style `copy`).
- **Trash:** `trash_async` for each; one `UndoLog` entry per command; toast with Undo; the dropdown refreshes through the folder watcher that already exists. Items on a file system without a trash get the permanent-delete confirmation instead of failing silently.
- **Permanent delete:** Shift+Delete or *Delete Permanently* in the Trash stack; confirm dialog; not undoable.
- **Undo (Ctrl+Z in the dropdown, the toast's button anywhere):** executes `UndoLog.undo()`'s plan with the same operations, then `settle(plan, ok)`. Operations delegated to Nautilus are not in the log (its own Ctrl+Z covers them) and the toast says so by not offering Undo.
- **Errors:** a failed operation shows a toast `Could not move "<name>": <message>` with the console log; it never leaves a half-removed selection.

## 10. Integration with the code other agents are editing

Two agents are editing the popover code now: **dropdown-grid-speed** (ticket [#37](https://github.com/alex-mextner/hyperdock/issues/37): `stackContent.js`, `stackLayout.js`, `stackThumbs.js`, `stackFolder.js`, `stackPanel.js`, `dockItemMenu.js`, `stackModel.js`, `services.js`) and **dropdown-input-grab** (ticket [#36](https://github.com/alex-mextner/hyperdock/issues/36): `popoverInput.js`, `stackPanel.js`, `dock.js`, `dockItems.js`, `interactions.js`). This design adds new modules and asks for the following **hooks**; none of them was applied here. Wave-1 agents apply them after both branches are merged into main.

| Hook | Where (file, anchor) | Change |
|---|---|---|
| **H1** | `StackPanel._init`, after `_buildPopover` | `this._interaction = new StackInteraction({ panel: this, stack, files, view })` (new `stackInteraction.js`, owns selection, keyboard, hover, menus, preview, rename, clipboard glue) |
| **H2** | `StackPanel._connectBackdrop`, the `key-press-event` handler | replace the Escape-only body by `return this._interaction.onKey(evt)`; it returns `Clutter.EVENT_STOP` for consumed keys, `EVENT_PROPAGATE` for the rest |
| **H3** | `StackPanel._gridCell` / `_listRow` (the `makeCell(item, rect)` callback given to `StackContent`) | set `cell._number = rect.number`; `button_mask: St.ButtonMask.ONE \| TWO \| THREE`; `clicked` -> `interaction.onCell(number, button, event)`; `notify::hover` -> `interaction.onHover(number)`; style from `interaction.styleFor(number)`; arm the drag source (section 5.2): one `St.DndStartGesture` per cell whose `recognize` starts the handoff |
| **H4** | `StackContent` (grid-speed) | already has `cellActor(number)` and `ensureVisible(number)`; need `restyle()` that re-applies `styleFor` to the realized cells (or the interaction iterates `cellActor` over `realizedItems()`); no other change |
| **H5** | `DockItemList.slideIn` (dockItemMenu.js:243): `icon.connect('button-press-event')` | activate on click (press and release without motion beyond the drag threshold, `Clutter.ClickAction`), only for button 1; button 3 opens the item menu; `w._number = index` for the selection; the fan uses `FanInteraction` (the same controller with `shape.view = 'fan'`) |
| **H6** | `DockItemList.slideIn` / `showFanList` | take the dropdown grab with `pushPopoverGrab(list)` so Esc, arrows and Space reach the fan; release it in `_destroyList`; today the fan has no key focus at all |
| **H7** | `dockItemMenu.js:204` `.replace(/(.{32})..+/, '$1...')` | middle ellipsis at 48 (section 4.8) |
| **H8** | `StackPanel._buildPopover` | add the caption label (`stackCaption.js`) above *Open in Files* |
| **H9** | `stackModel.js` `CLUSTER_ROLES` + `stackDock.js` `roleOf` | role `link` (8.2); one line each |
| **H10** | `fileDrops.js` `_targetFor`, `_onDrop`, `_perform`, `_transfer`; `apps/file-drops.js` | section 6 (target kinds, payload map, insertion marker, move of `_transfer` into `stackTransfer.js`) |
| **H11** | `schemas/*.gschema.xml`, `preferences/keys.js`, `prefs.js` | keys of 12.2 (`tools/check-settings.py` must stay at its baseline) |
| **H12** | `probeScenarios.js` | one registry line each for the new nested scenarios |

Conflict policy: the interaction controller is a **new file** that talks to the panel through four calls (`onKey`, `onCell`, `onHover`, `styleFor`) so that the `stackPanel.js` change is about fifteen lines; the grid-speed branch is merged first, then H1-H4/H8 are applied on top (they are small and the anchors above are stable names, not line numbers).

## 11. Pure modules: contracts

Every module below is a new top-level file of the extension, free of `gi://` imports (so `tests/<name>_check.js` runs it under plain `gjs -m`, as `stackModel.js` does), with a `tests/<name>_check.js` using `createChecker()` from `tests/harness.js`. Header comment of each file: what it decides and why it is pure. Plain English labels (the extension has no translations). No behaviour is shared with `stackModel.js`/`stackLayout.js` except the vocabulary: an item is addressed by its `number`, its 0-based position in reading order across all batches (the `cells[].number` of `stackLayout.js`).

### 11.1 `stackSelection.js`: selection model and keyboard navigation

A *selection* is a plain object `{ focus, anchor, selected }`: `focus` the item with the keyboard cursor (-1 for none), `anchor` the item a Shift range grows from (-1 for none), `selected` the sorted array of selected item numbers. The *shape* describes what is on screen:

```js
{ view: 'grid' | 'list' | 'fan', count, columns?, groupSizes?, visual?, pageRows? }
```

- `grid`: `columns` (number of columns) and `groupSizes` (items per batch, in order; every batch starts a new row, exactly the layout of `stackLayout.layoutGrid`; omit for a single batch).
- `list`: one item per row, in reading order (`groupSizes` is irrelevant).
- `fan`: `visual`, the item numbers from the one nearest the dock to the farthest (the order the fan draws them; "More..." is not an item). `Up` moves one step away from the dock, `Down` one step toward it, `Right` as `Up`, `Left` as `Down`. Docks on the top edge mirror `Up`/`Down` in the caller.
- `pageRows`: rows a PageUp/PageDown step (default 4).

```js
export const EMPTY_SELECTION   // { focus: -1, anchor: -1, selected: [] }
export function initialSelection(shape)   // what is selected when a dropdown opens
export function rowsOf(shape)             // number[][], the rows of the shape (grid rows, list rows, fan steps)
export function applyNav(sel, key, mods, shape)   // key: 'Up'|'Down'|'Left'|'Right'|'Home'|'End'|'PageUp'|'PageDown'; mods: {shift?, ctrl?}
export function selectAll(shape)
export function clickSelect(sel, number, mods, shape)   // -> { selection, open }
export function hoverSelect(sel, number, shape)    // pointer moved onto an item; with `shape`, a number outside 0..count-1 changes nothing
export function toggleFocus(sel)            // Ctrl+Space
export function typeSelect(names, buffer, from)   // number, or -1
export function actTargets(sel)             // the numbers a command acts on
export function reconcile(sel, shape)       // drop numbers >= count, keep the rest
```

Rules (decided; do not re-litigate in the implementation):

1. `initialSelection`: the dropdown always opens with something selected. `count` 0: `EMPTY_SELECTION`. grid and list: item 0. fan: the item nearest the dock, `visual[0]`. `anchor` equals `focus`; `selected` is `[focus]`.
2. No wrap-around anywhere: an arrow that would leave the content leaves the selection unchanged (Finder behaviour). `Home`/`End` go to the first/last item (in reading order; in the fan to `visual[0]`/`visual[last]`), `PageUp`/`PageDown` move `pageRows` rows keeping the column, clamped (to the first/last item).
3. Grid: `Left`/`Right` step one item in reading order across row ends and batch ends. `Up`/`Down` keep the column: from column c of a row go to column c of the previous/next row, where the previous/next row may belong to another batch; when that row is shorter than c+1 go to its last item. The first row has no `Up`, the last row no `Down`.
4. List: `Up`/`Down` step one; `Left`/`Right` do nothing (reserved: a later submenu disclosure).
5. Without modifiers a navigation key sets `focus = anchor = target` and `selected = [target]`. With `shift`: `focus = target`, `anchor` unchanged, `selected` = the contiguous range between `anchor` and `focus` in reading order. With `ctrl` (and not shift): only `focus` moves (`anchor` and `selected` unchanged), so the user can then toggle with `toggleFocus`. Shift beats ctrl when both are held.
6. `toggleFocus`: adds the focus item to `selected` or removes it; `anchor` becomes the focus item.
7. `clickSelect(sel, number, mods, shape)`: plain click selects only `number` and returns `open: true` (a plain click opens, as in macOS stacks); `ctrl` toggles `number` in `selected`, `anchor = focus = number`, `open: false`; `shift` selects the range from `anchor` (or from 0 when there is none) to `number`, `focus = number`, anchor unchanged, `open: false`.
8. `hoverSelect`: real pointer motion over an item makes it the only selected one, unless the selection holds more than one item (a multi-selection is not destroyed by the pointer passing over items). Same item: the same selection object content.
9. `typeSelect(names, buffer, from)`: `names` is the array of item names in reading order, `buffer` the characters typed within the last second (the caller owns the one-second timer). Matching is by prefix, case-insensitive (`toLocaleLowerCase`), ignoring one leading `.`. When `buffer` is one character repeated (`'aaa'`) it cycles: the next match after `from`. Otherwise the first item at or after `from` that matches, wrapping once past the end (the only wrap-around in the module); no match gives -1 (the caller keeps the selection). A `from` outside `0..names.length-1` starts at 0.
10. `rowsOf` and `applyNav` never throw on `count` 0, on `columns` 0 (treated as 1), or on a `focus` of -1 (the first navigation key then selects the first item, `Up`/`Left`/`End` the last).
11. `actTargets(sel)`: `selected` when not empty, else `[focus]` when `focus >= 0`, else `[]`.
12. `reconcile`: keeps the numbers < `count`; if the focus was dropped the new focus is the last remaining selected item or, when none remains, `initialSelection(shape)`'s.

### 11.2 `stackHotkeys.js`: hotkey map

The map is layout independent: Ctrl+C must work in the Russian layout. The glue converts a Clutter key event to a `press`:

```js
// press: { key, keycode, ctrl, shift, alt, super, text }
//   key      Clutter.keyval_name(event.get_key_symbol()), e.g. 'c', 'Cyrillic_es', 'Delete', 'Return', 'space'
//   keycode  event.get_key_code() (the xkb keycode, evdev code + 8: the same physical key in every layout)
//   text     String.fromCodePoint(Clutter.keysym_to_unicode(event.get_key_symbol())) or '' (the typed character)
export function latinKey(keycode, key)   // 'c' for keycode 54 whatever the layout; key lower-cased when the keycode is not a letter
export function commandFor(press, ctx)   // -> { command, ...args } | null
```

`ctx = { mode, stack: { kind: 'folder'|'recents', writable }, hasSelection, clipboardHasFiles }` with `mode` one of `'browse'` (default), `'preview'` (Quick Look open), `'rename'` (inline rename entry open), `'menu'` (a context menu open).

`latinKey`: when `key` is a single ASCII letter the result is that letter lower-cased (Dvorak and Colemak keep their printed letters, GTK's rule); only when the layout produces no ASCII letter (Cyrillic, Greek, ...) is the letter looked up in a fixed table of the xkb keycodes of the letters on a QWERTY board (Q=24 W=25 E=26 R=27 T=28 Y=29 U=30 I=31 O=32 P=33 A=38 S=39 D=40 F=41 G=42 H=43 J=44 K=45 L=46 Z=52 X=53 C=54 V=55 B=56 N=57 M=58); any other keycode returns the lower-cased `key` (so `Delete`, `F2`, `space`, `Return` stay as they are).

`commandFor` returns `null` (the caller propagates the event, never consumes it) for: any press with `super`; presses of modifier keys themselves (`Shift_L`, `Shift_R`, `Control_L`, `Control_R`, `Alt_L`, `Alt_R`, `Meta_L`, `Meta_R`, `Super_L`, `Super_R`, `ISO_Level3_Shift`, `ISO_Level5_Shift`, `ISO_Next_Group`, `ISO_Prev_Group`, `Mode_switch`, `Caps_Lock`, `Num_Lock`, `Scroll_Lock`, `Hyper_L`, `Hyper_R`); everything when `mode` is `'menu'`. So the layout switch (Super+Space, Alt+Shift, Ctrl+Shift, Caps Lock) and a tap of Super reach the Shell untouched.

Table, mode `'browse'` (`L` = `latinKey`, so Ctrl+С with a Cyrillic С is Ctrl+C):

| Press | Command | Condition |
|---|---|---|
| arrows, Home, End, Page_Up, Page_Down (alone or with Shift or Ctrl) | `{command:'nav', key:'Up'..., shift, ctrl}` | |
| Return, KP_Enter | `open` | hasSelection |
| Ctrl+O | `open` | hasSelection |
| Alt+Return, Ctrl+I | `properties` | folder stack, hasSelection |
| space | `quickLook` | hasSelection |
| Ctrl+space | `toggleFocus` | |
| Escape | `close` | |
| Ctrl+A | `selectAll` | |
| Ctrl+C | `copy` | folder stack, hasSelection |
| Ctrl+X | `cut` | folder stack writable, hasSelection |
| Ctrl+V | `paste` | folder stack writable, clipboardHasFiles |
| Delete, KP_Delete, Ctrl+BackSpace | `trash` | folder stack writable, hasSelection |
| Shift+Delete | `deletePermanently` | folder stack writable, hasSelection |
| Delete, KP_Delete, Ctrl+BackSpace | `removeFromRecents` | recents stack, hasSelection |
| F2 | `rename` | folder stack writable, exactly one item selected (the caller checks; the map only needs hasSelection) |
| Ctrl+Z | `undo` | |
| Ctrl+Shift+Z, Ctrl+Y | `redo` | |
| Ctrl+Shift+N | `newFolder` | folder stack writable |
| Ctrl+Shift+C | `copyPath` | folder stack, hasSelection |
| Ctrl+R | `showInFiles` | folder stack, hasSelection |
| Tab, ISO_Left_Tab | `{command:'nop'}` (consumed, focus never leaves the dropdown) | |
| a printable character (`press.text` non-empty, no ctrl, no alt) | `{command:'typeSelect', text}` | |
| anything else | `null` | |

A command whose condition is false returns `{ command: 'nop' }` (the key is consumed but does nothing) when the key is one of the table's, so a read-only stack never falls through to type-to-select (`Ctrl+X` is not text anyway). Key combinations with `alt` that are not in the table return `null`.

Mode `'preview'`: Escape and space: `closePreview`; Left and Up: `previewPrev`; Right and Down: `previewNext`; Return, KP_Enter: `open`; everything else `null`.
Mode `'rename'`: Return, KP_Enter: `commitRename`; Escape: `cancelRename`; everything else `null` (the entry takes it).

### 11.3 `stackClipboard.js`: clipboard and URI payloads

```js
export const COPIED_FILES_MIME = 'x-special/gnome-copied-files'
export function fileUri(path)                 // 'file:///home/u/a%20b.png' for '/home/u/a b.png'
export function buildCopiedFiles(uris, cut)   // 'copy\nfile:///a\nfile:///b' (or 'cut\n...'); null for an empty list
export function parseCopiedFiles(text)        // { cut, uris } | null
export function parseUriList(text)            // string[]   RFC 2483
export function toUriList(uris)               // 'a\r\nb\r\n'
export function pathsText(paths)              // newline-joined, no trailing newline
export function pasteMode(parsed)             // 'move' | 'copy'
```

- Nautilus 50 (`nautilus-clipboard.c`, read) accepts `x-special/gnome-copied-files` only when the first line is exactly `cut` or `copy` and no later line is empty and every line is a valid URI: `buildCopiedFiles` therefore has no trailing newline, percent-encodes with `encodeURIComponent` per path segment (UTF-8, so Cyrillic names are valid), and returns `null` for an empty list; `fileUri` must round-trip through `Gio.File.new_for_uri(uri).get_path()` for hostile names (spaces, `%`, `#`, `?`, `'`, `"`, `&`, a newline, Cyrillic) - the check proves that with real GIO.
- `parseCopiedFiles` is tolerant where other apps are sloppy: strips a trailing `\0` and one trailing `\n`/`\r\n`, accepts `\r\n` separators, ignores a blank line at the end, but returns `null` when the first line is not `cut`/`copy` or no URI follows, or a line is not `scheme:...`.
- `parseUriList`: CRLF or LF separated, a line starting with `#` is a comment, blank lines and surrounding spaces dropped. (`apps/file-drops.js` has a private copy; the extension slice that touches the helper makes it import this one.)
- `pathsText(['/a','/b'])` is `'/a\n/b'`, a single path has no newline.
- `pasteMode({cut:true})` is `'move'`, otherwise `'copy'`.

### 11.4 `uniqueName.js`: collision-safe names

```js
export function splitName(name)                 // { stem, ext } ext includes the dot or is ''
export function uniqueName(name, taken, style)  // taken: Set<string> | (name) => boolean; style: 'keep-both' (default) | 'copy'
```

`keep-both` (a transferred file meets a file of the same name): `a.png` -> `a 2.png` -> `a 3.png`; `copy` (a duplicate in the same folder): `a copy.png` -> `a copy 2.png` -> `a copy 3.png`. A name that already ends in the style's own suffix continues the series (`a 2.png` -> `a 3.png`, `a copy.png` -> `a copy 2.png`, not `a 2 2.png`). Extension: the last `.xxx` where `xxx` starts with a letter and has at most 8 letters or digits, plus a leading `.tar` for `.tar.gz` and the like; a leading dot (`.bashrc`) or a dot-only run is no extension; `v1.2.3` has none (`v1.2.3 2`). The comparison is exact (case-sensitive: the filesystems we target are). A name that is not taken is returned unchanged. A trailing number of more than 15 digits is not a series marker (it would lose precision as a JavaScript number) and stays literal stem text. The result never exceeds 255 bytes of UTF-8 (`NAME_MAX`): the stem is truncated on a code point boundary to leave room for the suffix and the extension (the extension is truncated too when it alone leaves no room for one stem character); an untaken name is returned as it came. Never loops forever: after 10000 candidates it returns candidate 10001 without probing it (a folder with ten thousand collisions is not a case worth more code).

### 11.5 `undoLog.js`: undo and redo of file operations

```js
export class UndoLog {
  constructor(limit = 20)
  push(entry)           // entry: { op, items: [{from, to}] }
  canUndo(); canRedo()
  undo()                // -> a plan to execute, or null
  redo()
  settle(plan, ok, actualItems?)   // the caller reports whether the plan ran; a failed plan is dropped from the log; on success `actualItems` ([{from,to}], what really happened) replaces the items of the plan's entry, so a redo that renamed a destination is undone against the real path
  clear()
  describe(entry)       // 'Moved 3 items to Trash' for the toast
}
```

`op` is one of `trash` (items `{from: original path, to: trash:// uri or path of the trashed file}`), `move`, `copy`, `rename`, `mkdir` (items `{to}`), `restore` is only ever produced by the log. The inverse of an entry is a *plan* `{ op, items }` the glue executes: `trash` -> `restore` (`from` = trash location, `to` = original path), `move` -> `move` back (`from` and `to` swapped), `copy` -> `trash` the `to` paths, `rename` -> `rename` back, `mkdir` -> `trash` the `to` path. `undo()` pops the newest entry onto the redo stack and returns its inverse plan; `redo()` returns the entry's own forward plan. `push` clears the redo stack and trims the oldest beyond `limit`. `settle(plan, false)` removes the entry the plan belonged to (and its redo twin) so a stale entry (the file was changed outside) cannot trap the user. `describe` uses the singular for one item (`Moved 1 item to Trash`) and `Copied`, `Moved`, `Renamed`, `Created folder`. Operation names are looked up as own properties only (`__proto__`, `constructor` and the like are ignored by `push` and `describe` gives `''`). Nothing here touches the filesystem.

### 11.6 `dropClassify.js` and `webLinks.js`: what was dropped

```js
// dropClassify.js
export function classifyPayload(payloads)   // payloads: { [mimetype]: string | Uint8Array } -> { kind, uris, links, text }
export function classifyFile(uri, info)     // info: { isDir, contentType, isLocal } -> 'folder' | 'app' | 'image' | 'file' | 'remote'
export function dropActionFor(kind, target) // target: 'stack' | 'trash' | 'app' | 'dock' | 'mount' -> 'move-or-copy' | 'trash' | 'open-with' | 'add-folder' | 'add-favorite' | 'add-link' | 'add-file' | 'refuse'

// webLinks.js
export function normalizeUrl(input)        // string | null  (http/https only)
export function urlTitle(link)             // the label of a dock link
export function decodeMozUrl(bytes)        // [{ url, title }] from text/x-moz-url (UTF-16LE 'url\ntitle[\nurl\ntitle...]')
export function linksFromPayloads(payloads)   // [{ url, title }] in order of preference
export function linkKey(url)               // stable id for de-duplication
export function addLink(links, link)       // new array; existing key keeps its position and adopts a better title
export function removeLink(links, key)
```

`classifyPayload` kinds, first match wins: `files` (a `text/uri-list` or `x-special/gnome-copied-files` whose every line is a `file://` URI; a `text/plain` of file URIs is only `text`, a web page controls text/plain and must not gain authority over trash or move), `url` (`text/x-moz-url`, `_NETSCAPE_URL`, or a `text/uri-list`/`text/plain` with http(s) URLs only), `text-url` (`text/plain` or `text/html` whose text contains a URL), `image` (only an `image/*` payload), `text` (any other text), `none`. `links` carries `{url, title}` objects (title '' when unknown); `uris` the `file://` URIs; `text` the plain text. Preference for the title: `text/x-moz-url` second line, `_NETSCAPE_URL` second line, the text of the first `<a href="...">...</a>` of `text/html` whose href equals the URL, then ''. `text/uri-list` with several http URLs yields several links. Titles are trimmed, whitespace-collapsed and capped at 120 characters.
`classifyFile`: `isLocal` false -> `remote` (checked first, so a remote image, folder or launcher is never trashed or pinned); then `isDir` -> `folder`; `contentType` `application/x-desktop` or a name ending `.desktop` -> `app`; `image/*` -> `image`; `isLocal` false -> `remote`; else `file`.
`dropActionFor(kind, target)` is the whole decision table below as a pure function (the table is repeated in `tests/drop_classify_check.js`).
`normalizeUrl`: trims; lower-cases scheme and host; removes the default port (80 for http, 443 for https); drops a lone trailing `/` of an empty path only when the input had no path; keeps path, query and fragment verbatim; a bare `host.tld/path` (a dot, no spaces, no scheme) gets `https://`; `javascript:`, `data:`, `file:`, `vbscript:`, any other scheme (compared explicitly, never through an object lookup: `constructor://x` is not a link), relative and empty input return `null`; **a backslash anywhere makes the input invalid** (browsers read `\` as `/`, so `https://evil.example\@good.example/` would show one host and open another); internationalised hosts are left as given. `linkKey(url)`: the normalized URL without the fragment and with the trailing slashes of the **path** removed (the query is kept verbatim: `?path=/` and `?path=` are two links). `addLink` fills a missing, empty or whitespace-only title (judged as `urlTitle` does) from the link being added and never replaces a real title. `urlTitle({url, title})`: the title, else the host without a leading `www.`, else the URL.

#### `dropActionFor(kind, target)`: the decision table

`kind` is a `classifyFile` result (`folder`, `app`, `image`, `file`, `remote`) or a `classifyPayload` kind that is not files (`url`, `text-url`, `text`, `image-data` for an `image` payload without a file, `none`); `target` is where the pointer let go.

| kind \ target | `stack` (folder stack, mounted volume) | `trash` | `app` (an app icon of the dock) | `dock` (between items, or on an item that takes nothing) |
|---|---|---|---|---|
| `folder` | `move-or-copy` | `trash` | `open-with` | `add-folder` |
| `file` | `move-or-copy` | `trash` | `open-with` | `add-file` |
| `image` | `move-or-copy` | `trash` | `open-with` | `add-file` |
| `app` (a `.desktop` file) | `move-or-copy` | `trash` | `open-with` | `add-favorite` |
| `remote` (a non-local file URI) | `move-or-copy` | `refuse` | `open-with` | `refuse` |
| `url`, `text-url` | `refuse` | `refuse` | `open-with` | `add-link` |
| `text`, `image-data`, `none` | `refuse` | `refuse` | `refuse` | `refuse` |

Every other `kind`/`target` pair returns `refuse`. `move-or-copy` is decided later by the transfer rules of section 6.3, not here. `mount` is accepted as an alias of `stack` for the `target` argument.

### 11.7 `dropSlot.js`: where on the dock a drop lands

```js
export function dropSlot(slots, x, y, vertical, opts)   // slots: [{ role, x, y, w, h, accepts }] in dock order
//   -> { kind: 'onto', index } | { kind: 'between', index } | { kind: 'none' }
```

`opts.ontoShare` (default 0.5): the middle `ontoShare` of an item along the dock's axis is "onto" it when that item `accepts` the drop (`accepts` true), otherwise the whole item is split at its midline into the gap before and the gap after. A pointer in the gap between two items is `between` with `index` the insertion index (the number of items before the gap). Off the dock (beyond its bounds by more than `opts.margin`, default 0) is `none`. Items whose `accepts` is false never produce `onto`. A slot with a non-finite x, y, w or h, or a w or h not above 0, is unmeasured: ignored for the bounds, never hit, but its index still counts; no measured slot gives `none`.

### 11.8 `folderStackEntries.js`: edits of the `folder-stacks` setting

```js
export function normalizeEntries(raw)                  // raw JSON value -> array of entries (objects or strings); anything else -> []
export function entryPath(entry)                       // string path of an entry
export function addFolder(entries, path, index, env, fields)   // env: { normalize(path) }; fields: optional extra entry fields (never override `path`); new array
export function removeFolder(entries, path, env)
export function moveFolder(entries, from, to)
```

`addFolder` appends (or inserts at `index` when given, clamped) a folder as a `{ ...fields, path }` object (`{ path }` without `fields`; section 7.2 passes `display`, `view`, `sort`, `group`) unless an entry already shows the same normalized path (then the entries are returned unchanged, same array). `removeFolder` removes every entry of that normalized path. `normalizeEntries` drops entries that are neither a non-empty string nor an object with a non-empty string `path`. Entry objects keep every field they have (`view`, `sort`, `display`, `group`, `title`, `icon`, and fields this document adds). No function mutates its input.

### 11.9 `stackMenuModel.js`: what the context menus hold

```js
export function itemMenu(ctx)         // ctx: { kind, count, isImage, stack: { kind, writable }, clipboardHasFiles, openWith: [{id, name}], inTrash }
export function backgroundMenu(ctx)   // ctx: { stack: { kind, writable, view, sort, group }, clipboardHasFiles, canUndo }
```

Both return an array of menu entries: `{ id, label, enabled, accel?, children? }` or the string `'-'` for a separator; no gi types. The exact entries are in section 4.7; `id`s are the command names of 11.2 (plus `openWith`, `sort`, `group`, `view` for the submenu parents and `sort:<value>`, `group:<value>`, `view:<value>`, `openWith:<appId>`, `wallpaper` for their entries). Disabled commands stay in the menu greyed; only an empty Open With is dropped; with `inTrash` Move to Trash becomes Delete Permanently (`deletePermanently`). Empty groups never leave two adjacent separators or a separator at either end. The **Recents** background menu is `Clear Recents` (`clearRecents`), a separator and `View as` (`view`) and nothing else.

### 11.10 Implementation notes: choices the implementers made where 11.1-11.9 were silent

These are now behaviour covered by the checks; wave-1 code relies on them.

- **stackSelection**: `selectAll` anchors on the first item and focuses the last; Shift navigation with no anchor starts from the old focus (else the target) and stores that as the anchor; Shift+click keeps the anchor unchanged, even -1, and starts from the first item of the reading order; PageUp with no focus selects the last item; type-to-select cycling needs at least two identical characters (counted by code point); a click or hover on a number outside the shape leaves the selection unchanged; `groupSizes` that do not add up to `count` are cut at `count` and the leftover items form a last batch; `reconcile` keeps a focus of -1 and turns a dropped anchor into the focus; in the fan "reading order" is the visual order and `Left`/`Right` are `Down`/`Up` steps.
- **stackHotkeys**: the `nav` command names its key in the `applyNav` vocabulary (`PageUp`, `PageDown`, not `Page_Up`); Ctrl+Shift+<nav key> and Alt+<nav key> are `null`; the preview and rename modes match the key alone (modifiers are ignored, so Ctrl+Space still closes the preview); text made only of whitespace is not printable (Shift+space is `null`); a bare space with no selection is `nop`; a missing `ctx.stack` is neither a folder nor a recents stack.
- **stackClipboard**: `parseCopiedFiles` drops every trailing blank line and any run of trailing NULs but a blank line between URIs is a malformed payload (`null`); `parseUriList` also accepts a lone CR as a separator; `fileUri` does not resolve relative paths (callers pass absolute ones).
- **uniqueName**: only ASCII letters and digits count as an extension; a ` 1` suffix is not a series marker (`a 1.png` gives `a 1 2.png`); the `copy` series of `a 2.png` gives `a 2 copy.png`; after 10000 candidates the result is candidate 10001.
- **undoLog**: plans carry an extra `id` so `settle(plan, false)` can find the entry and its redo twin; `push` ignores an entry whose op has no inverse (`restore`, unknown, `null`); the inverse of `copy` and of `mkdir` is a `trash` plan with items `[{ from: <the created path> }]`; `redo` also trims to the limit; `describe` returns `Created folder` for `mkdir`, `Restored N item(s)` for `restore` and `''` for an unknown op.
- **dropClassify / webLinks**: `dropActionFor` treats `mount` as an alias of `stack`; `classifyFile` tests directory and `.desktop` before `remote`, so a remote image stays `image`; a missing `isLocal` counts as local; a `text/uri-list` that mixes a file and a link is `text-url`; image plus other text is `text`; `image-data` is the glue's name for a file-less image. `normalizeUrl` never invents a slash (`https://example.com:443` gives `https://example.com`, `HTTP://Example.COM:80/` gives `http://example.com/`); a bare host needs a dot and a last label starting with a letter (`file.txt` becomes `https://file.txt`, accepted); a URL inside prose needs an explicit `http(s)://`, and trailing `. , ; : ! ? ' ] }` and an unbalanced `)` are stripped; `addLink` always returns a new array and never replaces an existing non-empty title.
- **dropSlot**: items own `[start, end)` along the axis and the last item also its end coordinate; the pointer must also lie within the dock's extent across the axis; `accepts` must be exactly `true`.
- **folderStackEntries**: `addFolder`, `removeFolder` and `moveFolder` return the same array when nothing changes; garbage entries are kept and never match; `addFolder` stores the path as given.
- **stackMenuModel**: `ctx.kind` is ignored; Set as Wallpaper is enabled only for `count === 1`; `inTrash` swaps Move to Trash for Delete Permanently (`deletePermanently`); there is no Redo entry; the background Open in Files is `showInFiles` with no accel; every Sort/Group/View child has a boolean `checked`.

**Known open findings (ticket [#78](https://github.com/alex-mextner/hyperdock/issues/78)):** a `text/uri-list` of file URIs next to browser markers is still classified as `files` (a web page can offer a file href); `latinKey` falls back to the keycode table for any non-letter key (Dvorak `;`, Bepo `.`); `settle` cannot tell an undo plan from a redo plan. Fix them before glue uses the modules; the contract text of 11.2, 11.5 and 11.6 changes with them.

## 12. Tests, settings and proofs

### 12.1 Pure checks (`make test`, no Shell)

| Check | Module | Covers |
|---|---|---|
| `stack_selection_check.js` | `stackSelection.js` | the numbered rules of 11.1: default selection, arrows over batches, Shift ranges, Ctrl move and toggle, click and hover rules, type-to-select, fan visual order, empty and -1 cases |
| `stack_hotkeys_check.js` | `stackHotkeys.js` | the whole table of 11.2, layout independence with real Cyrillic keysyms and xkb keycodes, nothing consumed for Super / layout switch / bare modifiers, read-only and Recents stacks, preview, rename and menu modes |
| `stack_clipboard_check.js` | `stackClipboard.js` | `fileUri` round-trips through real GIO and passes `GLib.uri_is_valid` for hostile names, Nautilus-strict payloads, sloppy producers |
| `unique_name_check.js` | `uniqueName.js` | keep-both and copy series, extensions, gaps in the taken set |
| `undo_log_check.js` | `undoLog.js` | inverse plans, redo, limit, failed plans dropped, strings |
| `drop_classify_check.js`, `web_links_check.js` | `dropClassify.js`, `webLinks.js` | the decision table cell by cell, payload kinds, Firefox UTF-16 `text/x-moz-url`, Chrome and plain payloads, hostile URLs, title rules |
| `drop_slot_check.js` | `dropSlot.js` | onto vs between, both axes, items that accept nothing |
| `folder_stack_entries_check.js` | `folderStackEntries.js` | add, remove, move, dedupe, string and object entries, immutability |
| `stack_menu_model_check.js` | `stackMenuModel.js` | menu contents per context, no stray separators for any flag combination |

### 12.2 Settings

| Key | Type, default | Used by |
|---|---|---|
| `dock-links` | `s`, `'[]'` | 8.1; added to `preferences/keys.js` with `widget_type: 'none'`-style bookkeeping as `folder-stacks` is, edited from the dock, listed read-only in prefs |
| `stack-preview-sushi` | `b`, `true` | 4.5: use Sushi for types the overlay cannot show |
| `file-drops` | existing, **default becomes `true`** | R8 must work out of the box; changed in slice S9 once the nested drop scenario passes |

Everything else reuses existing keys (`folder-stacks`, `downloads-stack-*`, `recents-stack-*`, `spring-loading`, `drag-off-remove`). `tools/check-settings.py` must stay at its baseline.

### 12.3 Nested-shell scenarios (real input, virtual devices, isolated shell)

All run through the isolated launcher (`prlimit --core=0`, temp `HOME`/`XDG_*`, private bus; the shared helper of ticket [#44](https://github.com/alex-mextner/hyperdock/issues/44) when it lands) and register one line each in `probeScenarios.js` (H12). Virtual devices: `seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE | KEYBOARD_DEVICE)`, `notify_keyval(time, keyval, Clutter.KeyState.PRESSED/RELEASED)`, `notify_button`, `notify_absolute_motion`. A stub `xdg-open` records what opened; a fake Sushi (a tiny D-Bus service implementing `org.gnome.NautilusPreviewer2` that records `ShowFile`) proves the Sushi path.

| Scenario | Proves |
|---|---|
| `stackint-select` | opens a Grid, List and Fan: the first item is selected (style pseudo-class on the cell, caption text); Down/Right/Home/End/PageDown/Shift+Down move and extend; the focused cell scrolls into view; type-to-select; Ctrl+click and Shift+click; a plain click opens (stub log); Esc closes the preview before the dropdown |
| `stackint-keys` | Space opens the overlay (actor `d2daStackPreview` exists, shows the focus item's name), arrows move it, Esc closes it; Ctrl+C then `St.Clipboard.get_content('x-special/gnome-copied-files')` equals `copy\n<uri>...`; Ctrl+X dims the cells and a paste into a second folder moves the file; Delete moves to the real (isolated) trash, the toast shows Undo, Ctrl+Z restores it byte-identical; F2 rename; Shift+Delete asks first; Ctrl+Shift+N creates a folder in rename; every one also with the key sent from the Russian layout (`notify_key` with the xkb keycode while the `ru` source is active) and **Super+Space still switches the layout while the dropdown is open** |
| `stackint-menu` | right click on a cell in each view opens the menu (actor with the entries of 4.7 in order); Open With lists the apps; Move to Trash works; right click on the background; the fan no longer opens the file on right click |
| `stackint-dragout` | per section 5: the helper window maps under the pointer, the sink client receives the URIs, a drop on the Trash item moves the file to the trash; Esc cancels |
| `stackint-dropin` | per section 6: payload kinds from a source client onto stack, trash, app, gap, empty dock, outside; collisions keep both; the folder-stacks / favorites / dock-links settings change as the table says |
| `stackint-links` | a web link item renders (title, badge), opens through the stub, its menu edits and removes it, the setting round-trips |

### 12.4 Visual proofs (each attached to its ticket, read back, re-captured until right)

Default selection in Grid, List and Fan; hover; multi-selection with the caption; cut dimming; the item context menu and the background menu; the Quick Look overlay with an image and with a text file; the drag in flight (drag icon with a count badge) and the drop highlight on a stack; the insertion marker between dock items for a folder, an app and a link; a web link item with its badge; a dropped folder stack as a pile; the Undo toast.

### 12.5 Only the user can verify (real session)

Drag from a dropdown into Files, Firefox/Chrome and a chat app on the real Wayland session (the nested shell has only the test clients); labels on the 150% fractional scale; Sushi's real window under the dropdown; Russian layout on the real keyboard. Each ticket lists them as a closing note; they are not claimed verified.

## 13. Slices, ownership and tickets

Wave 0 is this branch (feat/stack-interactions): the document and the pure modules with their checks. Wave 1 starts when the grid-speed (#37) and input-grab (#36) branches are in main; every slice below is one agent in one worktree; "owns" lists the files it creates, "touches" the existing files it edits through the numbered hooks of section 10.

| Slice | Ticket | Owns (new files) | Touches | Depends on |
|---|---|---|---|---|
| S0 pure modules + this document | [#53](https://github.com/alex-mextner/hyperdock/issues/53) | `stackSelection.js stackHotkeys.js stackClipboard.js uniqueName.js undoLog.js dropClassify.js webLinks.js dropSlot.js folderStackEntries.js stackMenuModel.js` + their checks | `docs/CI.md` | - |
| S1 default selection, arrows, hover, multi-select in Grid and List | [#54](https://github.com/alex-mextner/hyperdock/issues/54) | `stackInteraction.js` | H1-H4 (`stackPanel.js`) | S0, #36, #37 |
| S2 Fan: click instead of press, buttons, keys, selection | [#55](https://github.com/alex-mextner/hyperdock/issues/55) | `fanInteraction.js` | H5-H7 (`dockItemMenu.js`) | S1 |
| S3 right click: item and background menus (bug R2) | [#56](https://github.com/alex-mextner/hyperdock/issues/56) | `stackContextMenu.js` | H3, H5 | S0, S1 |
| S4 readable names and the caption (bug R3) | [#57](https://github.com/alex-mextner/hyperdock/issues/57) | `stackCaption.js` | H7, H8 | #37 |
| S5 file operations, clipboard glue, toast, dialogs | [#58](https://github.com/alex-mextner/hyperdock/issues/58) | `stackFileOps.js stackClipboardGlue.js stackToast.js stackDialogs.js` | - | S0 |
| S6 hotkeys on the selection: cut, copy, paste, delete, rename, undo | [#59](https://github.com/alex-mextner/hyperdock/issues/59) | (in `stackInteraction.js`) | - | S1, S5 |
| S7 Quick Look: overlay and Sushi | [#60](https://github.com/alex-mextner/hyperdock/issues/60) | `stackPreview.js stackSushi.js` | `stackInteraction.js` (mode `preview`) | S1 |
| S8 drag out of a dropdown (bug R1) | [#61](https://github.com/alex-mextner/hyperdock/issues/61) | `stackDragOut.js apps/drag-out.js` | H3, H5 | S1 |
| S9 drop onto a group, transfer rules, `file-drops` on by default (R8) | [#62](https://github.com/alex-mextner/hyperdock/issues/62) | `stackTransfer.js` | H10 | S0, S5 |
| S10 drop onto the dock: folders become stacks (R9, R10) | [#63](https://github.com/alex-mextner/hyperdock/issues/63) | `dockDropMarker.js` | H10, `stackDock.js` | S9 |
| S11 drop onto the dock: apps join the favourites, files open in the app under the pointer | [#64](https://github.com/alex-mextner/hyperdock/issues/64) | - | H10 | S9 |
| S12 web link dock items and dropping URLs (R9) | [#65](https://github.com/alex-mextner/hyperdock/issues/65) | `webLinkDock.js` | H9, H10, H11 | S0, S9 |
| S13 drop onto the dock: files, images, text, other things | [#66](https://github.com/alex-mextner/hyperdock/issues/66) | - | H10 | S12 |
| S14 folders inside dropdowns: navigation, back button, count badge (R10) | [#67](https://github.com/alex-mextner/hyperdock/issues/67) | `stackNav.js` | H3 | S1 |
| S15 spring-loading: hovering a stack for 600 ms during a drag opens it | [#68](https://github.com/alex-mextner/hyperdock/issues/68) | - | `interactions.js`, H10 | S9 |
| F1 fan draws the newest item nearest the dock | [#69](https://github.com/alex-mextner/hyperdock/issues/69) | - | `dockItemMenu.js` | - |
| F2 multi-format clipboard helper (text/uri-list next to gnome-copied-files) | [#70](https://github.com/alex-mextner/hyperdock/issues/70) | `apps/clipboard.js` | - | S5 |
| F3 sub-folder piles inside dropdowns | [#71](https://github.com/alex-mextner/hyperdock/issues/71) | - | - | S14 |
| F4 opt-in favicon and page-title fetch for web links | [#72](https://github.com/alex-mextner/hyperdock/issues/72) | - | - | S12 |
| F5 rubber-band selection in Grid | [#73](https://github.com/alex-mextner/hyperdock/issues/73) | - | - | S1 |

Parallelism: after S0, **S5, S9 and F1** do not depend on the popover branches' merge and can start at once; S1 and S2 start after #36 and #37 merge; S3, S6, S7, S8, S14 follow S1; S10-S13 and S15 follow S9. Two slices never edit the same existing file at the same hook: `stackPanel.js` is edited by S1 (H1-H4) first, then S3/S4/S8 add one line each at H3/H8; `dockItemMenu.js` by S2 first, then S3/S8; `fileDrops.js` by S9 first, then S10-S13, S15 add target kinds.
