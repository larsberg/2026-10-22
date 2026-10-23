export const pinNoiseFields = [
  ["enabled", "Enable noise field", true],
  ["preview", "Show pin multiplier", false],
  ["forceStrength", "Noise force strength", 20, 0, 100, 0.1],
  ["amount", "Pin variation", 1, 0, 1, 0.01],
  ["bassStep", "Z offset per bass hit", 0.35, -5, 5, 0.01],
  ["audioScale", "Harmony controls noise scale", false],
  ["audioScaleMin", "Minimum noise scale", 0.4, 0, 20, 0.01],
  ["audioScaleMax", "Maximum noise scale", 2, 0, 20, 0.01],
  ["offsetX", "Offset X", 0, -1000000, 1000000, 0.01],
  ["offsetY", "Offset Y", 0, -1000000, 1000000, 0.01],
  ["offsetZ", "Offset Z", 0, -1000000, 1000000, 0.01],
  ["scaleX", "Scale X", 0.6, -20, 20, 0.01],
  ["scaleY", "Scale Y", 0.6, -20, 20, 0.01],
  ["scaleZ", "Scale Z", 0.6, -20, 20, 0.01],
];
export const pinNoiseDefaults = Object.fromEntries(
  pinNoiseFields.map(([key, , initial]) => [key, initial]),
);

export function validatePinNoise(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pin noise settings.");
  const next = { ...pinNoiseDefaults, ...value },
    result = {};
  // Older controls allowed 0–100 although the pin blend uses 0–1.
  if (value.forceStrength === undefined && next.amount > 1 && next.amount <= 100) next.amount = 1;
  for (const [key, label, initial, min, max] of pinNoiseFields) {
    const field = next[key];
    if (
      typeof initial === "boolean"
        ? typeof field !== "boolean"
        : !Number.isFinite(field) || field < min || field > max
    )
      throw new Error(`Invalid pin noise ${label}.`);
    result[key] = field;
  }
  if (result.audioScaleMin > result.audioScaleMax) throw new Error("Minimum noise scale must not exceed maximum noise scale.");
  return result;
}
