import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Base icon specifications centered at 0/0 for easy translate/scale.
// Dimensions chosen to match existing visuals; size is controlled via scale.
export function iconSpec(kind) {
  switch ((kind || '').toLowerCase()) {
    case 'balise':
      return { tag: 'circle', attrs: { class: 'balise', cx: 0, cy: 0, r: 3 }, viewBox: '-7 -7 14 14' };
    case 'signal':
      return { tag: 'rect', attrs: { class: 'signal', x: -5, y: -5, width: 10, height: 10, rx: 2 }, viewBox: '-7 -7 14 14' };
    case 'tds':
    case 'tdscomp':
      return { tag: 'path', attrs: { class: 'tdscomp', d: 'M0,-7 L7,0 L0,7 L-7,0 Z' }, viewBox: '-8 -8 16 16' };
    case 'node':
      return { tag: 'circle', attrs: { class: 'node', cx: 0, cy: 0, r: 3 }, viewBox: '-7 -7 14 14' };
    case 'arrow':
      return { tag: 'path', attrs: { class: 'arrow', d: 'M -7 -5 L 7 0 L -7 5', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, viewBox: '-8 -8 16 16' };
    default:
      return { tag: 'circle', attrs: { cx: 0, cy: 0, r: 2 }, viewBox: '-7 -7 14 14' };
  }
}

// Returns inline SVG markup for use in HTML (e.g., overlap menu). Width/height optional (CSS may size it).
export function iconSvg(kind, opts = {}) {
  const { className = 'ico', width, height, attrs = {} } = opts;
  const spec = iconSpec(kind);
  const attrPairs = Object.entries(spec.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  const extraPairs = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  const sizeAttrs = [width != null ? `width="${width}"` : null, height != null ? `height="${height}"` : null].filter(Boolean).join(' ');
  return `<svg class="${className}" viewBox="${spec.viewBox}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" ${sizeAttrs}>`+
         `<${spec.tag} ${attrPairs}${extraPairs ? ' ' + extraPairs : ''}/>`+
         `</svg>`;
}

// Appends a <g> containing the icon shape; caller can set translate/scale via transform.
// opts: { scale: number, className: string }
export function appendIconG(parentSel, kind, opts = {}) {
  const { scale = 1, className = '' } = opts;
  const spec = iconSpec(kind);
  // Important: do NOT include the kind class on the wrapper <g>,
  // to avoid selectAll('g.<kind>') matching inner icons.
  const g = parentSel.append('g').attr('class', ['icon', className].filter(Boolean).join(' '));
  const shape = g.append(spec.tag);
  for (const [k, v] of Object.entries(spec.attrs)) shape.attr(k, v);
  if (scale !== 1) g.attr('transform', `scale(${scale})`);
  return g;
}

// Ensure a reusable arrow marker exists on the given root SVG selection.
export function ensureArrowMarker(svgSel, id = 'mk-arrow') {
  const svgNode = svgSel?.node?.();
  if (!svgNode) return;
  let defs = d3.select(svgNode).select('defs');
  if (defs.empty()) defs = d3.select(svgNode).append('defs');
  let marker = defs.select(`marker#${id}`);
  if (marker.empty()) {
    marker = defs.append('marker')
      .attr('id', id)
      .attr('viewBox', '0 0 10 10')
      .attr('refX', '10')
      .attr('refY', '5')
      .attr('markerWidth', '6')
      .attr('markerHeight', '6')
      .attr('orient', 'auto');
    marker.append('path').attr('d', 'M 0 0 L 10 5 L 0 10 z');
  }
}
