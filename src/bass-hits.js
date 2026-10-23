// Note onsets come from the audio scheduler at their audible time. The bass-only
// envelope also catches amplitude gates inside sustained notes. Hysteresis and a
// refractory period keep oscillator cycles and the same attack from retriggering.
export function createBassHitDetector() {
  let epoch, lastTime, lastHit = -Infinity, lastEvent = -Infinity;
  let peak = 0, valley = 0, armed = false, warmupUntil = 0;
  function reset() {
    epoch = lastTime = undefined;lastHit = lastEvent = -Infinity;
    peak = valley = warmupUntil = 0;armed = false;
  }
  function update(sample, events = []) {
    if (!sample?.playing || !Number.isFinite(sample.time)) { reset();return 0; }
    const { time } = sample, level = Math.max(0, sample.level || 0);
    if (epoch !== sample.epoch || lastTime === undefined || time < lastTime || time - lastTime > .25) {
      // Resuming a held note is not a new hit. Genuine scheduled onsets still
      // count immediately, but wait for the envelope to settle after a restart.
      peak = valley = level;armed = false;warmupUntil = time + .08;
      lastHit = lastEvent = -Infinity;epoch = sample.epoch;
    }
    lastTime = time;
    let hits = 0;
    for (const event of events) {
      if (event.layer !== 'bass' || !Number.isFinite(event.time) || event.time <= lastEvent || event.time > time || event.time < time - .2) continue;
      lastEvent = event.time;
      if (event.time - lastHit < .085) continue;
      hits++;lastHit = event.time;peak = valley = level;armed = false;
    }
    peak = Math.max(peak, level);
    if (level < peak * .7) {
      if (!armed) valley = level;
      armed = true;valley = Math.min(valley, level);
    }
    if (!hits && armed && time >= warmupUntil && time - lastHit >= .085 && level > .002 && level > valley * 1.45 && level - valley > .002) {
      hits++;lastHit = time;peak = valley = level;armed = false;
    }
    return hits;
  }
  return { update, reset };
}
