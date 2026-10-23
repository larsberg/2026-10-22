import { createRawScore } from '../src/raw-score.js';
import { rawAudioSettings } from '../src/raw-audio-settings.js';
import { createHammockVoices } from '../src/hammock-voices.js';

// Silent OfflineAudioContext render of the same instruments/effects as the tab.
// Never constructs a live AudioContext or connects to a speaker destination.
export async function renderRawAudio({ startBar = 0, bars = 8, sampleRate = 22050 } = {}) {
  const settings = rawAudioSettings(), seconds = bars * 240 / settings.bpm;
  const context = new OfflineAudioContext(2, Math.ceil((seconds + .8) * sampleRate), sampleRate);
  const master = context.createGain(), compressor = context.createDynamicsCompressor(), limiter = context.createWaveShaper();
  master.gain.value = settings.volume;
  compressor.threshold.value = -14; compressor.knee.value = 8; compressor.ratio.value = 6;
  compressor.attack.value = .003; compressor.release.value = .12;
  limiter.curve = Float32Array.from({ length: 4097 }, (_, i) => Math.max(-.85, Math.min(.85, i / 2048 - 1)));
  master.connect(compressor).connect(limiter).connect(context.destination);
  const voices = createHammockVoices(context, master);
  for (const h of createRawScore().queryArc(startBar, startBar + bars).filter(h => h.hasOnset()))
    voices.trigger(h.value, (Number(h.whole.begin) - startBar) * 2,
      Number(h.whole.end.sub(h.whole.begin)) * 2, settings);
  const buffer = await context.startRendering();
  voices.dispose();
  return buffer;
}

export function measureRender(buffer) {
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1), rate = buffer.sampleRate;
  let peak = 0, sum = 0, sumL = 0, sumR = 0, cross = 0, bad = 0, clipped = 0;
  const perBar = [];
  for (let i = 0; i < left.length; i++) {
    const l = left[i], r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) bad++;
    peak = Math.max(peak, Math.abs(l), Math.abs(r)); sum += l*l + r*r;
    sumL += l*l; sumR += r*r; cross += l*r;
    if (Math.max(Math.abs(l), Math.abs(r)) >= .8499) clipped++;
    const bar = Math.floor(i / (2 * rate)); perBar[bar] = (perBar[bar] ?? 0) + (l*l + r*r) / (4 * rate);
  }
  return { sampleRate: rate, seconds: buffer.duration, peak, rms: Math.sqrt(sum / (2 * left.length)),
    correlation: cross / Math.sqrt(sumL * sumR), nonfiniteSamples: bad, clippedSamples: clipped,
    barRms: perBar.map(Math.sqrt) };
}
