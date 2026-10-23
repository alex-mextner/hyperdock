# Hyperdock

A GNOME Shell 40+ Extension

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/icedman)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/icedman)

![Contributors](https://img.shields.io/github/contributors/alex-mextner/hyperdock?color=dark-green) ![Forks](https://img.shields.io/github/forks/alex-mextner/hyperdock?style=social) ![Stargazers](https://img.shields.io/github/stars/alex-mextner/hyperdock?style=social) ![Issues](https://img.shields.io/github/issues/alex-mextner/hyperdock) ![License](https://img.shields.io/github/license/alex-mextner/hyperdock) ![GitHub Downloads](https://img.shields.io/github/downloads/alex-mextner/hyperdock/total)

![Screen Shot](https://raw.githubusercontent.com/alex-mextner/hyperdock/mac-tahoe/screenshots/Screenshot%20from%202024-03-19%2015-31-27.png)

### Announcement/Warning

Maintenance and GNOME version compatibility updates are now primarily assisted by AI.

Due to GNOME Extensions reviewer policies regarding AI tooling, updates will no longer be submitted to extensions.gnome.org and will be published exclusively through this repository. Releases will include simple installation instructions.

If you prefer strictly human-written code, feel free to skip this extension. If you enjoy having updates keep pace with new GNOME releases and want to help fund the AI compute tokens keeping it alive, support via [Buy Me A Coffee](https://www.buymeacoffee.com/icedman) or [Ko-fi](https://ko-fi.com/icedman) is greatly appreciated.

### Notice

* Supports GNOME Shell 50 only (Ubuntu 26.04). For older GNOME versions use upstream [dash2dock-lite](https://github.com/icedman/dash2dock-lite).

### Features

* Multi-monitor support (new!)
* Dash docked at the desktop
* Animated dock icons
* Resize icons
* Autohide/intellihide; the hidden dock needs the pointer resting on the screen edge for `reveal-delay-ms` (default 300 ms, 0-2000, 0 = instant; with pressure sense the push must also be reached)
* Dock positions: bottom, top, left, right
* Scroll wheel to cycle windows
* Click to maximize/minimize windows
* Style top panel
* Panel mode
* Show/Hide Apps icon
* Analog clock
* Dynamic calendar
* Dynamic trash icon
* Mounted devices
* Downloads icon with fan animation (new!)
* Icon color effects (Tint, Monochrome)
* Custom icons

### Third-Party Compatibility

* [Compiz Magic Lamp Animation](https://github.com/PR3SIDENT/gnome-shell-extension-compiz-alike-magic-lamp-effect)
* [Blur my Shell](https://github.com/aunetx/blur-my-shell)

### Prerequisites

* GNOME Shell (version 42+)

### Installation

#### Quick Install (Recommended)

Run the one-line installer in your terminal. It automatically detects your GNOME Shell version, presents compatible releases, downloads, installs, and offers to enable the extension:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/alex-mextner/hyperdock/mac-tahoe/install.sh)
```
or

```bash
curl -sSL https://raw.githubusercontent.com/alex-mextner/hyperdock/mac-tahoe/install.sh | bash
```

---

#### Manual Installation from Source

1. Clone this repository:
   ```bash
   git clone https://github.com/alex-mextner/hyperdock.git
   ```
2. Build and install using the `Makefile`:
   ```bash
   cd hyperdock
   make
   ```

## Theme Support

Export your settings under **Style** > **Themes Button** > **"Export"**...

This will be saved to `/tmp/theme.json`. Edit this JSON file and save it under `~/.config/d2da/themes` or at `{extension_path}/themes` so that it becomes available in the extension settings app.

## Custom Icons

Create a folder under `~/.config/d2da/icons` and place your SVG icons there. Then create a file under `~/.config/d2da/icons.json` using the following format:

```json
{
  "icons": {
     "view-app-grid-symbolic": "icons/show-apps-icon.svg",
     "user-trash": "icons/my-own-trash.svg",
     "user-trash-full": "icons/my-own-trash-full.svg"
  }
}
```

You may also use **icon names** from your favorite icon theme using the following format:

```json
{
  "icons": {
     "view-app-grid-symbolic": "show-apps-icon",
     "user-trash": "trash",
     "user-trash-full": "trash-full"
  }
}
```

The icons `show-apps-icon`, `trash`, and `trash-full` must be available in your icon theme folder.

Alternatively, you may override icons via app ID:

```json
{
   "apps": {
      "spotify_spotify": "icons/spotify.svg"
   }
}
```

Check the logs to see the icon names currently being used by Hyperdock. Search for log text such as:

```sh
Icon created "user-trash"
```

## Custom Config

Create a file `config.json` under the folder `~/.config/d2da/`

```json
{
  "file-explorer": "nemo",
  "icon-size": "24"
}
```

* Disable then enable the extension to load the configuration
* `file-explorer` overrides the default "nautilus"
* `icon-size` overrides the icon scale from the preferences panel

## Custom CSS

Create a file `style.css` under the folder `~/.config/d2da/`

For now, you will have to use Looking Glass (GNOME's built-in debugger) to inspect class names and styles.

## Blurred Background

The blurred background feature requires **ImageMagick** to be installed on the system. This generates the blurred image based on the desktop wallpaper.

## Installing over a symlink

`make install` and `make install-zip` refuse to run when `~/.local/share/gnome-shell/extensions/hyperdock@alex-mextner.github.com` is a symlink, since installing would empty the checkout it points to; remove the link first to install a copy.

## Bug Reporting

When reporting bugs, please include the following details:

* Linux Flavor/Distribution and version
* GNOME version (e.g. 50.1)
* Hyperdock release number

Check for any exceptions in the logs by running the following in the terminal:

```bash
journalctl /usr/bin/gnome-shell -f -o cat
```

To check for incompatibilities with other extensions, try running Hyperdock with all other extensions disabled.

To check for lag or inefficiency, run the following in the terminal and observe `gnome-shell` CPU usage:

```bash
top -d 0.5
```

On a Dell XPS 13 (i5-6200U), CPU usage is about 50% with icon quality set to High, frame rate set to High, and shadows enabled.

Please be specific about the errors encountered, and attach screenshots if possible.

## Testing Rig

* Ubuntu 26.04 (GNOME 50, Wayland)

## License

Distributed under the GPL 3.0 License. See [LICENSE](LICENSE) for more information.

## Migrating from dash2dock-lite

Hyperdock is a separate extension from upstream Dash2Dock Animated and no longer shares its identity:

| | upstream | hyperdock |
|---|---|---|
| uuid | `dash2dock-lite@icedman.github.com` | `hyperdock@alex-mextner.github.com` |
| schema id | `org.gnome.shell.extensions.dash2dock-lite` | `org.gnome.shell.extensions.hyperdock` |
| dconf path | `/org/gnome/shell/extensions/dash2dock-lite/` | `/org/gnome/shell/extensions/hyperdock/` |

Disable the old extension, then carry your settings over:

```bash
dconf dump /org/gnome/shell/extensions/dash2dock-lite/ \
  | dconf load /org/gnome/shell/extensions/hyperdock/
```

`ubuntu-tweak apply` does this automatically.
