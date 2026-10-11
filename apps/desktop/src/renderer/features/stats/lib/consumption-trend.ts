export function trendX(index: number, count: number, width = 1000) {
  return count > 0 ? (index + 0.5) / count * width : width / 2;
}

export function trendSegments(values: (number | null)[], maximum: number, width = 1000, height = 240) {
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  const scale = Number.isFinite(maximum) && maximum > 0 ? maximum
    : values.reduce<number>((peak, value) => typeof value === "number" && Number.isFinite(value) ? Math.max(peak, value) : peak, 1);
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value) || value < 0) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ x: trendX(index, values.length, width),
      y: height - Math.min(1, value / scale) * height });
  });
  if (current.length) segments.push(current);
  return segments;
}
