'use strict';

// Pure icon sizing for Dock.relayout: fits the preferred icon size and
// spacing to the monitor length. No Shell imports, so it stays testable and
// keeps dock.js under the file-length limit.

/**
 * @param {object} p
 * @param {number} p.preferredSize icon size before fitting
 * @param {number} p.iconCount     number of laid out icons
 * @param {number} p.iconSpacing   extension icon_spacing (0 = none)
 * @param {number} p.animationSpread extension animation_spread
 * @param {boolean} p.vertical     dock runs along the monitor height
 * @param {number} p.monitorLength monitor height (vertical) or width
 * @param {number} p.scaleFactor   monitor geometry scale
 * @returns {{iconSize: number, iconSizeSpaced: number, iconStyle: string,
 *   scaleDown: number, projectedWidth: number, margins: number}}
 */
export function computeIconMetrics({
  preferredSize,
  iconCount,
  iconSpacing,
  animationSpread,
  vertical,
  monitorLength,
  scaleFactor,
}) {
  let margins = 0;
  let iconStyle = '';
  if (iconSpacing > 0) {
    let margin = 8 * iconSpacing;
    if (vertical) {
      iconStyle = `margin-top: ${margin}px; margin-bottom: ${margin}px;`;
    } else {
      iconStyle = `margin-left: ${margin}px; margin-right: ${margin}px;`;
    }
    margins = margin * 2 * iconCount;
  }

  let iconSize = preferredSize;
  //! why not use icon_spacing? animation spread should only be when animated
  let iconSizeSpaced = iconSize + 2 + 8 * animationSpread;

  let projectedWidth =
    iconSize +
    // (this.animated ? iconSizeSpaced : 0) +
    iconSizeSpaced * (iconCount > 3 ? iconCount : 3);
  projectedWidth += margins;

  let scaleDown = 1.0;
  let limit = vertical ? 0.96 : 0.98; // use dock_size_limit
  let maxWidth = monitorLength * limit;
  if (projectedWidth * scaleFactor > maxWidth * 0.98) {
    scaleDown = (maxWidth - iconSize / 2) / (projectedWidth * scaleFactor);
  }

  iconSize *= scaleDown;
  iconSizeSpaced *= scaleDown;
  projectedWidth *= scaleDown;

  // make multiple of 2
  iconSize = Math.floor(iconSize / 2) * 2;
  iconSizeSpaced = Math.floor(iconSizeSpaced / 2) * 2;
  projectedWidth = Math.floor(projectedWidth / 2) * 2;

  return { iconSize, iconSizeSpaced, iconStyle, scaleDown, projectedWidth, margins };
}
