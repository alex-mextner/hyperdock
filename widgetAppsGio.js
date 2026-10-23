'use strict';

// Gio side of the Calendar/Clock widget app detection. Shared by the shell
// side (services.js) and the prefs window, so it may only use Gio, which both
// processes have. The decisions themselves live in widgetApps.js.

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';

import { pickWidgetApp } from './widgetApps.js';

const WIDGET_APPS = Object.freeze({
  calendar: {
    candidates: ['org.gnome.Calendar.desktop'],
    mimeType: 'text/calendar',
  },
  clock: { candidates: ['org.gnome.clocks.desktop'], mimeType: null },
});

// -> { id, name, source: 'app' | 'handler' } or null when no app is installed
export function detectWidgetApp(kind) {
  const spec = WIDGET_APPS[kind];
  const handler = spec.mimeType
    ? Gio.AppInfo.get_default_for_type(spec.mimeType, false)
    : null;
  const picked = pickWidgetApp(
    spec.candidates,
    (id) => GioUnix.DesktopAppInfo.new(id) !== null,
    handler?.get_id() ?? null
  );
  if (!picked) return null;
  const info =
    picked.source === 'app' ? GioUnix.DesktopAppInfo.new(picked.id) : handler;
  return { ...picked, name: info?.get_display_name() ?? picked.id };
}
