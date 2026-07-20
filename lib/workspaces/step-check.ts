/**
 * Host-owned numeric step checks using scaled arithmetic to avoid float false fails
 * (e.g. 7.00000000001 vs step 0.1 from min 0) while still rejecting true off-step values.
 */

function decimalPlaces(value: number) {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  if (text.includes("e") || text.includes("E")) {
    const [base, expRaw] = text.toLowerCase().split("e");
    const exp = Number(expRaw);
    const baseDecimals = (base.split(".")[1] ?? "").length;
    return Math.max(0, baseDecimals - exp);
  }
  return (text.split(".")[1] ?? "").length;
}

export function stepScale(min: number, step: number) {
  return 10 ** Math.max(decimalPlaces(min), decimalPlaces(step), 0);
}

/** True when value lies on min + n*step for integer n (scaled float-safe). */
export function isOnStep(value: number, min: number, step: number) {
  if (![value, min, step].every(Number.isFinite) || step <= 0) return false;
  const scale = stepScale(min, step);
  const scaledStep = step * scale;
  if (!(scaledStep > 0)) return false;
  const n = ((value - min) * scale) / scaledStep;
  return Math.abs(n - Math.round(n)) <= 1e-6;
}

export function nearestOnStep(value: number, min: number, max: number, step: number) {
  if (![value, min, max, step].every(Number.isFinite) || step <= 0 || max < min) return value;
  const scale = stepScale(min, step);
  const scaledMin = Math.round(min * scale);
  const scaledMax = Math.round(max * scale);
  const scaledStep = Math.round(step * scale);
  if (scaledStep <= 0) return value;
  const scaledValue = Math.round(value * scale);
  const clamped = Math.min(scaledMax, Math.max(scaledMin, scaledValue));
  const steps = Math.round((clamped - scaledMin) / scaledStep);
  return (scaledMin + steps * scaledStep) / scale;
}
