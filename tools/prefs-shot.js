// gjs -m tools/prefs-shot.js <out.png> [--no-apps] <widget-id>...
//
// Renders the preferences groups holding the given widget ids (e.g.
// reveal-delay-ms, calendar-icon) from the real ui/*.ui files to a PNG without a
// Shell session: GDK_BACKEND=broadway with a private broadwayd (see
// tools/prefs-shot.sh). --no-apps feeds the Calendar/Clock rows the "nothing
// installed" state, the default uses the apps detected on this machine.
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import { describeWidgetApp } from '../widgetApps.js';
import { detectWidgetApp } from '../widgetAppsGio.js';

const [out, ...rest] = ARGV;
const noApps = rest.includes('--no-apps');
const ids = rest.filter((a) => a !== '--no-apps');
const root = GLib.path_get_dirname(
  GLib.path_get_dirname(import.meta.url.replace('file://', ''))
);

Gtk.init();
Adw.init();

const builder = new Gtk.Builder();
for (const f of ['general', 'appearance', 'tweaks', 'others'])
  builder.add_from_file(`${root}/ui/${f}.ui`);

for (const kind of ['calendar', 'clock']) {
  const row = builder.get_object(`${kind}-icon-row`);
  const state = describeWidgetApp(
    kind,
    noApps ? null : detectWidgetApp(kind)
  );
  row.set_sensitive(state.sensitive);
  row.set_subtitle(state.subtitle);
}

// the group holding a widget, detached from its page so it can be shown alone
const column = new Gtk.Box({
  orientation: Gtk.Orientation.VERTICAL,
  spacing: 18,
  margin_top: 18,
  margin_bottom: 18,
  margin_start: 18,
  margin_end: 18,
});
const shown = new Set();
for (const id of ids) {
  let w = builder.get_object(id);
  while (w && !(w instanceof Adw.PreferencesGroup)) w = w.get_parent();
  if (!w || shown.has(w)) continue;
  shown.add(w);
  let page = w;
  while (page && !(page instanceof Adw.PreferencesPage)) page = page.get_parent();
  page.remove(w);
  column.append(w);
}
const win = new Gtk.Window({ default_width: 720, child: column });
win.present();

const loop = GLib.MainLoop.new(null, false);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
  const paintable = new Gtk.WidgetPaintable({ widget: win });
  const snapshot = new Gtk.Snapshot();
  paintable.snapshot(snapshot, win.get_width(), win.get_height());
  const node = snapshot.to_node();
  const texture = win.get_native().get_renderer().render_texture(node, null);
  texture.save_to_png(out);
  loop.quit();
  return GLib.SOURCE_REMOVE;
});
loop.run();
