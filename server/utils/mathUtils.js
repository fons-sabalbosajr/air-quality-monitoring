/**
 * Numeric coercion and statistical helpers.
 */

function coerceNumber(v) {
  if (v == null) return null;
  if (typeof v === "number" && isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/[, ]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

function meanLast(values, windowSize) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const slice = values.slice(Math.max(0, values.length - windowSize));
  const sum = slice.reduce((a, b) => a + b, 0);
  return slice.length ? sum / slice.length : 0;
}

module.exports = { coerceNumber, meanLast };
