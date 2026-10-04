export function speechLevel(samples: Float32Array<ArrayBuffer>): number {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  // Suppress near silence without discarding quieter speech.
  return Math.sqrt(Math.min(1, Math.max(0, (rms - 0.0015) / 0.08)));
}

export function followVoiceLevel(current: number, target: number, elapsed: number): number {
  const response = target > current ? 0.05 : 0.22;
  return current + (target - current) * (1 - Math.exp(-elapsed / response));
}
