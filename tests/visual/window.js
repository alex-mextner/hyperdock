// gjs -m tests/visual/window.js <app-id>
// A bare GTK4 window with the given application id, so the nested shell counts the
// matching fixture app (tests/visual/apps/<app-id>.desktop) as running. Test fixture
// for tools/visual-shell.sh, never shipped.
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System, { programArgs } from 'system';

const id = programArgs[0];
// the Wayland app id GTK reports is the program name
GLib.set_prgname(id);
const app = new Gtk.Application({ application_id: id });
app.connect('activate', () => {
  const window = new Gtk.ApplicationWindow({ application: app, title: id, default_width: 260, default_height: 160 });
  window.present();
});
app.run([]);
System.exit(0);
