// Makes an overlay actor (badge, counter, progress bar) move with the icon it
// decorates. The dock draws icons on pooled "renderer" actors and every bounce
// (launch, attention) is a translation of that renderer, so an overlay that
// copies the renderer's translation follows any bounce with the same easing and
// no lag: the copy happens in the renderer's own notify::translation-* emission,
// not on the overlay's next update pass. Overlays that must stay put (the
// running-state dots) simply do not follow.
//
// No gi imports: tests/overlay_follow_check.js drives it with fake actors.

export class TranslationFollower {
  /** @param target the overlay actor that follows (also the signal owner) */
  constructor(target) {
    this._target = target;
    this._source = null;
    this._sync = () => this.sync();
  }

  /**
   * Follow `source` (rebinding when the pooled renderer changes) and copy its
   * translation now.
   */
  to(source) {
    if (source !== this._source) {
      this._unbind();
      this._source = source;
      source?.connectObject(
        'notify::translation-x', this._sync,
        'notify::translation-y', this._sync,
        this._target
      );
    }
    this.sync();
  }

  sync() {
    let source = this._source;
    if (!source) return;
    this._target.translationX = source.translationX;
    this._target.translationY = source.translationY;
  }

  _unbind() {
    this._source?.disconnectObject(this._target);
    this._source = null;
  }
}
