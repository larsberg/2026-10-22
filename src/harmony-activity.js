import { rawSounds } from './raw-voices.js';
import { instrumentLevel } from './instrument-settings.js';

// Read the gate programmed into the currently sounding harmony, using exactly
// the same note properties as the synth. This stays high through the gate's
// rests, and follows edits, mutes, tempo changes and held-note resumes.
export function harmonyGateActivity(pattern, cycle, settings) {
  if (!(settings.volume > 0 && settings.keys > 0 && instrumentLevel(settings, 'keys') > 0)
    || !rawSounds.includes(settings.instruments?.keys?.sound)) return 0;
  let activity = 0;
  for (const hap of pattern.queryArc(cycle, cycle + 1e-6)) {
    const value = hap.value;
    if (value.layer === 'keys' && value.gain > 0 && value.gateMode === 'six')
      activity = Math.max(activity, Math.min(1, Math.max(0, value.gateDepth ?? .1)));
  }
  return activity;
}
