'use strict';

// Pure helpers behind the live Calendar and Clock icons: which app they draw
// over, whether to pin it, and when the date has to be redrawn. Free of gi://
// imports and of any clock/timer of its own so tests/widget_apps_check.js
// runs them under plain node; services.js and the prefs glue
// (widgetAppsGio.js) inject the real GLib/Gio pieces.

// Milliseconds from `now` to the next local midnight, at least one second so a
// timer that fires a hair early cannot re-arm itself in a busy loop. Built
// from calendar fields, so a 23 h or 25 h DST day is measured correctly.
export function nextMidnightDelayMs(now) {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(1000, next.getTime() - now.getTime());
}

// One-shot timer chained to the next midnight. schedule(fn, ms) -> handle,
// cancel(handle), now() -> Date, onMidnight() redraws the date widgets.
// rearm() is for resume-from-suspend and timezone/clock changes: the pending
// timer is stale then, so redraw at once and aim at the next midnight again.
export let MidnightTicker = class {
  constructor({ schedule, cancel, now, onMidnight }) {
    this._schedule = schedule;
    this._cancel = cancel;
    this._now = now;
    this._onMidnight = onMidnight;
    this._handle = null;
  }

  start() {
    this._arm();
  }

  rearm() {
    this._arm();
    this._redraw();
  }

  stop() {
    if (this._handle === null) return;
    this._cancel(this._handle);
    this._handle = null;
  }

  _arm() {
    this.stop();
    this._handle = this._schedule(() => {
      this._handle = null;
      this._arm();
      this._redraw();
    }, nextMidnightDelayMs(this._now()));
  }

  // the next midnight is armed before the redraw, so a throwing redraw
  // cannot end the chain
  _redraw() {
    try {
      this._onMidnight();
    } catch (e) {
      console.error('d2da: midnight redraw', e);
    }
  }
};

// The app a live widget draws over: the first installed id of `candidates`
// (source 'app'), else the default handler of the matching mime type
// (source 'handler': the widget is drawn over that app's icon). null when
// neither exists.
export function pickWidgetApp(candidates, isInstalled, handlerId) {
  for (const id of candidates) {
    if (isInstalled(id)) return { id, source: 'app' };
  }
  return handlerId ? { id: handlerId, source: 'handler' } : null;
}

// Auto-pin rule. A switch turning on (off -> on, `wasEnabled` is its state
// before this change) pins its app when it is missing from the favorites; a
// switch that stays on never re-pins what the user took off the dock since.
// Turning it off NEVER unpins, whoever pinned it: an icon the user may have
// grown used to must not vanish silently, so there is deliberately no
// 'unpin' outcome and no record of which pins were ours.
export function decidePin({ enabled, wasEnabled, appId, favorites }) {
  if (!enabled || wasEnabled || !appId) return 'none';
  return favorites.includes(appId) ? 'none' : 'pin';
}

const KIND_TEXT = {
  calendar: {
    what: 'Show a calendar widget with today\'s date.',
    missing: 'GNOME Calendar',
    install: 'gnome-calendar',
  },
  clock: {
    what: 'Show an analog clock widget.',
    missing: 'GNOME Clocks',
    install: 'gnome-clocks',
  },
};

// Prefs row state for a widget switch: whether it can be used and the
// subtitle naming the detected app, or how to install one when none is found.
// `detected` is detectWidgetApp()'s result; `tr` is the prefs gettext;
// `enabled` keeps a switch that is already on usable (to switch it off) after
// its app was uninstalled.
export function describeWidgetApp(kind, detected, tr = (s) => s, enabled = false) {
  const t = KIND_TEXT[kind];
  if (!detected) {
    return {
      sensitive: !!enabled,
      subtitle: `${tr(t.what)} ${t.missing} (${t.install}) ${tr('is not installed; install it to use this.')}`,
    };
  }
  const note =
    detected.source === 'handler'
      ? tr('Drawn over its icon (default handler); pinned to the dock when switched on.')
      : tr('Pinned to the dock automatically when switched on.');
  return {
    sensitive: true,
    subtitle: `${tr(t.what)} ${tr('Uses:')} ${detected.name}. ${note}`,
  };
}
