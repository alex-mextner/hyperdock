// gjs -m tests/app_grid_pile_dock_check.js - when two launcher ids are the same
// app (pure logic, no GNOME Shell). Cases come from the leaks found on a real
// dock: snap `pkg_app` ids, reverse-DNS ids, user launchers next to system ones.
// Exits 1 on failure.
import { assert, createSuite } from './mini_test.js';
import { appKeys, dockKeys, meets } from '../appGridPileDock.js';

const { test, run } = createSuite();

const same = (a, b) => meets(appKeys(b.id, b.wmClass), new Set(appKeys(a.id, a.wmClass))) &&
  meets(appKeys(a.id, a.wmClass), new Set(appKeys(b.id, b.wmClass)));

test('snap and flatpak "package_app" ids match the plain id', () => {
  assert.ok(same({ id: 'firefox_firefox.desktop' }, { id: 'firefox.desktop' }));
  assert.ok(same({ id: 'thunderbird_thunderbird.desktop' }, { id: 'thunderbird.desktop' }));
  assert.ok(same({ id: 'telegram-desktop_telegram-desktop.desktop' }, { id: 'telegram-desktop.desktop' }));
});

test('other underscores do not make ids the same app', () => {
  assert.ok(!same({ id: 'first-package_app.desktop' }, { id: 'second-package_app.desktop' }));
  assert.ok(!same({ id: 'com.example.photo_editor.desktop' }, { id: 'org.other.video_editor.desktop' }));
});

test('a reverse-DNS id matches its program name', () => {
  assert.ok(same({ id: 'org.mozilla.firefox.desktop' }, { id: 'firefox.desktop' }));
  assert.ok(same({ id: 'org.mozilla.firefox.desktop' }, { id: 'firefox_firefox.desktop' }));
});

test('a short reverse-DNS program name still matches', () => {
  assert.ok(same({ id: 'org.videolan.VLC.desktop' }, { id: 'vlc_vlc.desktop' }));
});

test('two reverse-DNS apps with one program name stay two apps', () => {
  assert.ok(!same({ id: 'org.gnome.Calculator.desktop' }, { id: 'org.example.Calculator.desktop' }));
});

test('ids differing only in case or the suffix match', () => {
  assert.ok(same({ id: 'Firefox.desktop' }, { id: 'firefox' }));
});

test('the same window class matches launchers with unrelated ids', () => {
  assert.ok(same({ id: 'a.desktop', wmClass: 'Google-chrome' }, { id: 'b.desktop', wmClass: 'google-chrome' }));
});

test('a window class never matches a program name', () => {
  assert.ok(!same({ id: 'org.vendora.Editor.desktop', wmClass: 'VendorAEditor' }, { id: 'org.vendorb.Editor.desktop', wmClass: 'Editor' }));
});

test('different apps do not match', () => {
  assert.ok(!same({ id: 'google-chrome.desktop', wmClass: 'Google-chrome' }, { id: 'chrome-hifjf-Default.desktop', wmClass: 'crx_hifjf' }));
  assert.ok(!same({ id: 'org.gnome.Nautilus.desktop' }, { id: 'org.gnome.Settings.desktop' }));
  assert.ok(!same({ id: 'org.telegram.desktop.desktop' }, { id: 'org.gnome.desktop.desktop' }), 'generic last parts say nothing');
  assert.ok(!same({ id: 'vlc_vlc.desktop' }, { id: 'vlc-record.desktop' }));
});

test('empty and missing ids have no keys; dockKeys unions all entries', () => {
  assert.deepEqual(appKeys(''), []);
  assert.deepEqual(appKeys(null), []);
  const keys = dockKeys([{ id: 'org.mozilla.firefox.desktop' }, { id: 'y_y.desktop', wmClass: 'Z' }]);
  for (const key of ['a:firefox', 'i:y', 'w:z', 'i:y_y']) assert.ok(keys.has(key), key);
});

run();
