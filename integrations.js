import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// these are hacks to make Hyperdock compatible with other Extensions
//
export const Integrations = class {
  enable() {
    this.hookBms();
  }

  disable() {
    this.releaseBms();
  }

  hookBms(hook = true) {
    if (!hook) {
      this.extension.docks.forEach((dock) => {
        dock.animator._bms = null;
      });
    }

    let bms = Main.extensionManager.lookup('blur-my-shell@aunetx');
    this._bms = bms;
    if (bms && bms.stateObj && bms.metadata.version >= 70) {
      let obj = bms.stateObj;
      if (obj._dash_to_dock_blur) {
        if (!obj._dash_to_dock_blur.update_size_orig) {
          obj._dash_to_dock_blur.update_size_orig =
            obj._dash_to_dock_blur.update_size;
        }
        // the glass platter replaces Blur my Shell's blur
        if (
          hook &&
          this.extension.blur_background &&
          !this.extension.glass_material
        ) {
          obj._dash_to_dock_blur.update_size = () => {};
        } else if (obj._dash_to_dock_blur.update_size_orig) {
          obj._dash_to_dock_blur.update_size =
            obj._dash_to_dock_blur.update_size_orig;
        }
      }
    }
  }

  releaseBms() {
    this.hookBms(false);
    this._bms = null;
  }

  bms_update_size(animator) {
    let dock = animator.dock;

    // blur my shell
    let bms = dock.get_children().find((child) => {
      let name = child.get_name();
      return name === 'bms-dash-backgroundgroup';
    });

    animator._bms = bms;

    if (!bms) {
      return;
    }

    bms.visible =
      dock.extension.blur_background && !dock.extension.glass_material;
    if (!bms.visible) {
      return;
    }

    // compatible blur-my-shell version 70
    // bms version 70 supports 46,47..up
    if (
      dock.extension.integrations._bms &&
      dock.extension.integrations._bms.metadata.version >= 70
    ) {
      let bg_offset_x = dock._background.x;
      let bg_offset_y = dock._background.y;
      let rw = dock.renderArea.width;
      let rh = dock.renderArea.height;

      let meta_background = bms.first_child.first_child;
      if (!meta_background) {
        // this should exists
        return;
      }

      // bottom layout
      switch (dock._position) {
        case 'left':
        case 'top':
          bms.x = 0;
          bms.y = 0;
          bms.first_child.x = 0;
          bms.first_child.y = 0;
          bms.first_child.set_clip(
            bg_offset_x,
            bg_offset_y,
            dock._background.width - (dock.extension.border_thickness && 0),
            dock._background.height - (dock.extension.border_thickness && 0)
          );
          break;
        case 'right':
          bms.x = 0;
          bms.y = 0;
          bms.first_child.x = -meta_background.width + rw;
          bms.first_child.y = 0;
          bms.first_child.set_clip(
            -bms.first_child.x + bg_offset_x,
            0 + bg_offset_y,
            dock._background.width - (dock.extension.border_thickness && 0),
            dock._background.height - (dock.extension.border_thickness && 0)
          );
          break;
        case 'bottom':
        default:
          bms.x = 0;
          bms.y = 0;
          bms.first_child.x = 0;
          bms.first_child.y = -meta_background.height + rh;
          bms.first_child.set_clip(
            0 + bg_offset_x,
            -bms.first_child.y + bg_offset_y,
            dock._background.width - (dock.extension.border_thickness && 0),
            dock._background.height - (dock.extension.border_thickness && 0)
          );
          break;
      }

      let opacity = (dock.extension.background_color[3] ?? 0.5) * 54 + 200;
      meta_background.opacity = opacity;

      animator._blur_effects = bms.first_child.get_effects();
      if (animator._blur_effects) {
        animator._blur_effects.forEach((e) => {
          if (e.constructor.name == 'CornerEffect') {
            e.radius = dock.extension.computed_border_radius;
          }
        });
      }

      return;
    }

    // bms version incompatible
    bms.visible = false;
  }
};
