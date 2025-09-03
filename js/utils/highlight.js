// js/utils/highlight.js
// Centralized helpers for highlight state derived only from selection.

/**
 * Compute a stable selection identity for any datum drawn in the located view.
 * Priority: explicit id → edgeId → key (fallback used by renderer).
 */
export function selectionKeyForDatum(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.id != null && d.id !== '') return d.id;
  if (d.edgeId != null && d.edgeId !== '') return d.edgeId;
  if (d.key != null && d.key !== '') return d.key;
  return null;
}

/**
 * Returns true iff the datum should be highlighted, based solely on selection.
 * @param {*} d - bound datum from D3 selection
 * @param {Iterable<string>} selection - array or Set of selected ids
 */
export function isHighlighted(d, selection) {
  const key = selectionKeyForDatum(d);
  if (key == null) return false;
  const selSet = selection instanceof Set ? selection : new Set(selection || []);
  return selSet.has(key);
}

