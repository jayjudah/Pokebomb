let ctx: AudioContext | null = null;

/** Short chirp + buzz so you know a card landed without looking at the screen. */
export function chirp(ok = true) {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 440;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  } catch {
    /* audio blocked; not a big deal */
  }
  navigator.vibrate?.(ok ? 40 : [30, 40, 30]);
}
