import { defaultInstruments } from './instrument-settings.js';

export const referenceScoreInfo = Object.freeze({
  title: 'Look No Further · generative study', bpm: 82, bars: 80,
  source: 'SUUNS — Look No Further (supplied official-video MP3)',
  // A reduction of the measured contours and register changes, not a claim
  // that the mixed recording contains these exact, discrete chord voicings.
  harmony: 'D/F falling bass; E4 guitar figure; C♯4/D4/G♯4 variation; low F3/E♭3 voice',
});
export function referenceAudioSettings() {
  const instruments = defaultInstruments();
  const tune = (key, values) => Object.assign(instruments[key], values);
  tune('kick', { sound: 'suuns-kick', level: 1, decay: 1, cutoff: 5000, drive: 0 });
  tune('snare', { sound: 'suuns-snare', level: 1, decay: 1, cutoff: 6500, drive: 0, reverb: .035 });
  tune('hat', { sound: 'suuns-hat', level: .8, decay: 1, cutoff: 10000, reverb: .02 });
  tune('bass', { sound: 'suuns-bass', level: 1, decay: 1, cutoff: 1500, resonance: .45, drive: 0, reverb: 0 });
  tune('keys', { sound: 'suuns-guitar', level: 1, decay: 1, cutoff: 6000, drive: 0, reverb: .06, delay: .08, delayBeats: .5, feedback: .18 });
  tune('melody', { sound: 'suuns-voice', level: 1, decay: 1, cutoff: 5000, drive: 0, reverb: .08, delay: .04, delayBeats: .5, feedback: .15 });
  return { enabled: false, bpm: referenceScoreInfo.bpm, volume: .5, drums: .9, bass: .85, keys: .55, melody: .8, instruments };
}

