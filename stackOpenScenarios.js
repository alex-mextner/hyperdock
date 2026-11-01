'use strict';

// How fast a stack dropdown opens, and how its grid is laid out, measured in
// the nested smoke shell (D2DA_PROBE_SCENARIO=stackopen, driven by
// tools/stacks-shell.sh with D2DA_STACKS_BIG=1). For each of Downloads and
// Screenshots it clicks the dock item with the virtual pointer and records
//   firstPaintMs  the click to the first frame drawn with the panel in it
//   readyMs       the click to every visible picture holding its texture
//   blockMs       the longest stretch the main loop did not answer a 4 ms
//                 timer while that happened (a frozen shell is "slow" too)
// then scrolls to the end and records the same. `say` lines carry the numbers;
// the checks are generous ceilings, the numbers are for comparing runs.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { pointerFor } from './stackScenarios.js';
import { gridGeometry, gridProblems } from './stackGridScenarios.js';
import { thumbnailable } from './thumbQueue.js';

const S = 'stackopen';
// generous: the nested shell draws in software and shares the machine
const FIRST_FRAME_MS = 1500;
const MAX_STALL_MS = 1000;
const now = () => GLib.get_monotonic_time() / 1000;

// the longest main-loop stall since start()
function watchdog() {
  let last = now();
  let worst = 0;
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4, () => {
    const t = now();
    worst = Math.max(worst, t - last);
    last = t;
    return GLib.SOURCE_CONTINUE;
  });
  return {
    worst: () => Math.round(worst),
    reset: () => {
      last = now();
      worst = 0;
    },
    stop: () => GLib.source_remove(id),
  };
}

function collect(actor, type, out = []) {
  if (actor instanceof type) out.push(actor);
  actor.get_children().forEach((c) => collect(c, type, out));
  return out;
}

// the pictures (not icons) of the panel's cells that are in the scroll's view
function visiblePictures(panel) {
  const scroll = panel._scroll;
  const [sx, sy] = scroll.get_transformed_position();
  const [sw, sh] = scroll.get_transformed_size();
  return collect(scroll, St.Bin).filter((bin) => {
    const child = bin.get_child?.();
    if (!child || child instanceof St.Widget) return false;
    const [x, y] = bin.get_transformed_position();
    const [w, h] = bin.get_transformed_size();
    return y + h > sy && y < sy + sh && x + w > sx && x < sx + sw;
  });
}

// visible cells still waiting for a picture: their thumbnail is being made,
// or made but its texture has not arrived
function picturesPending(panel) {
  const waiting = panel._content
    .realizedItems()
    .filter((item) => thumbnailable(item.type) && !item.thumb && !item.thumbFailed).length;
  return waiting + visiblePictures(panel).filter((bin) => !bin.get_child().content).length;
}

// the stack's first page as the thumbnail service sees it
function thumbState(stack) {
  const page = (stack.files ?? []).slice(0, 40).filter((item) => thumbnailable(item.type));
  return { pictures: page.length, made: page.filter((i) => i.thumb).length, failed: page.filter((i) => i.thumbFailed).length };
}

// a file the shell has never seen: no thumbnail known, none on disk
function forgetThumbnails(stack) {
  for (const item of stack.files ?? []) {
    item.thumb = null;
    item.thumbFailed = false;
  }
  const cache = GLib.build_filenamev([GLib.get_user_cache_dir(), 'thumbnails']);
  GLib.spawn_command_line_sync(`find ${GLib.shell_quote(cache)} -name '*.png' -delete`);
}

// resolves after the first frame drawn with the dropdown in it
function nextPaint(dock) {
  return new Promise((resolve) => {
    const id = global.stage.connect('after-paint', () => {
      // a frame with the dropdown in it, not one of the hover animation before it
      if (!dock._stackPanel) return;
      global.stage.disconnect(id);
      resolve(now());
    });
  });
}

async function until(h, ms, test) {
  const end = now() + ms;
  while (now() < end) {
    if (test()) return true;
    await h.sleep(10);
  }
  return test();
}

// click the stack's item and time what follows
async function timedOpen(d, dock, h, wd, item) {
  // the dock magnifies under the pointer: chase the icon
  for (let i = 0; i < 3; i++) await d.moveTo(...d.centreOf(item._renderer ?? item));
  wd.reset();
  const paint = nextPaint(dock);
  const t0 = now();
  d.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
  await h.sleep(24);
  d.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
  const opened = await until(h, 30000, () => !!dock._stackPanel);
  if (!opened) return { opened: false };
  const panel = dock._stackPanel;
  const firstPaintMs = Math.round((await paint) - t0);
  const ready = await until(h, 60000, () => picturesPending(panel) === 0);
  return {
    opened: true,
    panel,
    firstPaintMs,
    readyMs: ready ? Math.round(now() - t0) : null,
    blockMs: wd.worst(),
    pictures: visiblePictures(panel).length,
    failed: panel._content.realizedItems().filter((i) => i.thumbFailed && i.type.startsWith('image/')).length,
    first: panel._content
      .realizedItems()
      .slice(0, 6)
      .map((i) => `${i.name}:${i.type}:${i.date?.tv_sec}/${i.created}:${i.thumb ? 'thumb' : i.thumbFailed ? 'failed' : 'none'}`),
  };
}

async function scrollToEnd(h, wd, panel) {
  const adj = panel._scroll.vadjustment;
  wd.reset();
  const t0 = now();
  adj.value = adj.upper - adj.page_size;
  await h.sleep(50);
  const ready = await until(h, 60000, () => picturesPending(panel) === 0);
  return { scrollReadyMs: ready ? Math.round(now() - t0) : null, scrollBlockMs: wd.worst() };
}

async function closeDropdown(dock, h) {
  dock._destroyList?.();
  dock._stackPanel?.close();
  await h.sleep(500);
}

// timing of the stack's model refresh (what a new file triggers)
async function modelRefresh(services, stack, wd) {
  wd.reset();
  const t0 = now();
  await services.checkFolderStack(stack);
  return { refreshMs: Math.round(now() - t0), refreshBlockMs: wd.worst(), files: stack.total };
}

async function measureStack(d, dock, ext, h, wd, stack, label) {
  const item = dock._folderIcons?.get(stack.key);
  if (!item) return h.check(S, `${label}: the stack item exists`, false);
  h.say({ scenario: S, label, model: await modelRefresh(ext.services, stack, wd), warmed: thumbState(stack) });
  for (const run of ['cold', 'warm']) {
    // cold: no thumbnail of the folder exists anywhere, as for fresh files
    if (run === 'cold') {
      await until(h, 60000, () => ext.services.thumbnails.isIdle());
      forgetThumbnails(stack);
    }
    const r = await timedOpen(d, dock, h, wd, item);
    h.check(S, `${label} ${run}: the dropdown opens`, r.opened);
    if (!r.opened) continue;
    const { panel, ...numbers } = r;
    h.say({ scenario: S, label, run, ...numbers });
    h.check(S, `${label} ${run}: the visible pictures all load`, numbers.readyMs !== null, numbers);
    h.check(S, `${label} ${run}: no fixture picture failed thumbnailing`, numbers.failed === 0, numbers);
    // the old code froze the shell for 2-8 s here; the ceilings leave room for a loaded machine
    h.check(S, `${label} ${run}: first frame within ${FIRST_FRAME_MS} ms`, numbers.firstPaintMs < FIRST_FRAME_MS, numbers);
    h.check(S, `${label} ${run}: the main loop never stalls ${MAX_STALL_MS} ms`, numbers.blockMs < MAX_STALL_MS, numbers);
    if (run === 'cold') {
      await h.sleep(600);
      await h.shot(`stackopen-${label}`);
      h.say({ scenario: S, label, geometry: gridGeometry(panel) });
      const problems = gridProblems(gridGeometry(panel));
      h.check(S, `${label}: cells stand on one column grid, none overlaps`, problems.length === 0, problems);
      const scrolled = await scrollToEnd(h, wd, panel);
      h.check(S, `${label}: the end of the list loads`, scrolled.scrollReadyMs !== null, scrolled);
      h.say({ scenario: S, label, run: 'scroll', ...scrolled });
      await h.shot(`stackopen-${label}-end`);
    }
    await d.park();
    await closeDropdown(dock, h);
  }
}

export async function stackOpenScenario(ext, h) {
  const dock = ext.docks?.[0];
  if (!dock) return h.check(S, 'a dock exists', false);
  await h.closeOverview();
  await h.sleep(4000);
  const d = pointerFor(dock, h);
  const wd = watchdog();
  try {
    const stacks = ext.services?.folderStacks ?? [];
    for (const [index, stack] of stacks.entries()) {
      if (stack.isDownloads) ext._settings.set_int('downloads-stack-view', 1);
      await h.sleep(2500);
      await measureStack(d, dock, ext, h, wd, stack, `${index}-${stack.title}`.replace(/\W+/g, '-'));
    }
  } finally {
    wd.stop();
  }
}
