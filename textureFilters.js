import Clutter from 'gi://Clutter';

// Mipmapped minification (TRILINEAR) for textures the dock draws scaled down
// or rotated: plain bilinear skips texels and shimmers while the scale moves.
export function smoothScaling(actor) {
  actor.set_content_scaling_filters(
    Clutter.ScalingFilter.TRILINEAR,
    Clutter.ScalingFilter.LINEAR
  );
  return actor;
}
