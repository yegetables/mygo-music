/**
 * Imperative high-frequency audio runtime shared across visual components
 * (FogBackdrop, SmokeScrubber, RetroPlayer, StageLyrics) so 30/60fps animations
 * never trigger React tree re-renders on every tick.
 */
class AudioRuntime {
  private basePosMs = 0;
  private syncedAt = performance.now();
  private playing = false;
  private buffering = false;
  private durationMs = 0;

  private rawBass = 0;
  private smoothBass = 0;
  private lastLevelAt = 0;
  private live = false;

  syncPlayback(positionMs: number, durationMs: number, playing: boolean, buffering: boolean) {
    this.basePosMs = Math.max(0, positionMs || 0);
    this.syncedAt = performance.now();
    this.playing = playing;
    this.buffering = buffering;
    if (durationMs > 0) {
      this.durationMs = durationMs;
    }
  }

  seek(positionMs: number) {
    this.basePosMs = Math.max(0, positionMs || 0);
    this.syncedAt = performance.now();
  }

  pushAudioLevel(bass: number, live: boolean) {
    this.rawBass = Math.max(0, Math.min(1, Number.isFinite(bass) ? bass : 0));
    this.live = live;
    this.lastLevelAt = performance.now();
  }

  /** Returns smoothly interpolated playback position in ms for 60fps animations. */
  getSmoothPositionMs(): number {
    if (!this.playing || this.buffering) {
      return this.basePosMs;
    }
    const elapsed = Math.max(0, performance.now() - this.syncedAt);
    const est = this.basePosMs + Math.min(elapsed, 1500);
    return this.durationMs > 0 ? Math.min(est, this.durationMs) : est;
  }

  isPlaying(): boolean {
    return this.playing && !this.buffering;
  }

  /**
   * Returns asymmetrically smoothed bass energy in [0, 1], matching desktop
   * barState.step (fast attack k=18, slower decay k=6). Falls back to 0 when
   * no live metering is active or playback pauses.
   */
  sampleBass(dtSec: number): number {
    const dt = Math.max(0.001, Math.min(dtSec, 0.1));
    const stale = performance.now() - this.lastLevelAt > 300;
    const target = this.playing && !this.buffering && this.live && !stale ? this.rawBass : 0;
    const k = target > this.smoothBass ? 18 : 6;
    const step = 1 - Math.exp(-k * dt);
    this.smoothBass += (target - this.smoothBass) * step;
    if (this.smoothBass < 0.001 && target === 0) {
      this.smoothBass = 0;
    }
    return this.smoothBass;
  }
}

export const audioRuntime = new AudioRuntime();
