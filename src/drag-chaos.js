const layers = ['bass', 'keys', 'melody', 'kick', 'snare', 'hat'];
const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
export function randomDragNote(random = Math.random) {
  const layer = layers[Math.floor(random() * layers.length)], pitched = ['bass', 'keys', 'melody'].includes(layer);
  const midi = (layer === 'bass' ? 24 : layer === 'melody' ? 43 : 48) + Math.floor(random() * 36);
  return { value: { layer, ...(pitched ? { note: names[midi % 12] + (Math.floor(midi / 12) - 1) } : {}),
    gain: .2 + random() * .45, detune: (random() - .5) * 70, timbreSeed: Math.floor(random() * 32), vowel: Math.floor(random() * 3), chaos: true },
    duration: .05 + random() * .16 };
}
