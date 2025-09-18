import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import {appendIconG} from '../utils/graphSymbols.js';

const DEFAULT_EDGE_LENGTH = 100;
const LANE_SPACING = 120;
const COMPONENT_LANE_GAP = 3;
const BBOX_MARGIN = 200;
const NODE_ICON_SCALE = (5 / 3).toFixed(6);
const SIGNAL_ICON_SCALE = (6 / 10).toFixed(6);
const TDS_ICON_SCALE = (5 / 7).toFixed(6);

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function resolveNodeId(ref) {
    if (ref && typeof ref === 'object') return ref.id ?? null;
    return ref ?? null;
}

export default class DynamicRendererD3 {
    constructor({mount, onSelect} = {}) {
        if (!mount) throw new Error('DynamicRendererD3: mount fehlt');
        this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
        this.svg = d3.select(mount)
            .append('svg')
            .attr('role', 'img')
            .attr('width', '100%')
            .attr('height', '100%');
        this.root = this.svg.append('g').attr('class', 'viewport');

        this.gLinks = this.root.append('g').attr('class', 'links');
        this.gNodes = this.root.append('g').attr('class', 'nodes');
        this.gElems = this.root.append('g').attr('class', 'elems');
        this.gLabels = this.root.append('g').attr('class', 'labels');
        this.gSpeed = this.root.append('g').attr('class', 'speed');
        this.gTdsSec = this.root.append('g').attr('class', 'tds');

        this._nodeById = new Map();
        this._edgeById = new Map();
        this._placeOnEdge = () => ({x: 0, y: 0});

        this.svg.attr('viewBox', '0 0 1000 600').attr('preserveAspectRatio', 'xMidYMid meet');
        this.zoom = d3.zoom().scaleExtent([0.1, 16]).on('zoom', (ev) => this.root.attr('transform', ev.transform));
        this.svg.call(this.zoom);
        this._didFit = false;
    }
    _fitToBBox(b) {
        if (!b || !b.min || !b.max) return;
        const w = Math.max(1, b.max.x - b.min.x);
        const h = Math.max(1, b.max.y - b.min.y);
        this.svg.attr('viewBox', `${b.min.x} ${b.min.y} ${w} ${h}`);
        this.svg.call(this.zoom.transform, d3.zoomIdentity);
    }

    update(view, state = {}) {
        if (!view) return;
        const layout = this._computeLayout(view);
        this._nodeById = layout.nodeById;
        this._edgeById = layout.edgeById;
        this._placeOnEdge = layout.placeOnEdge;

        const shouldCenter = state?.projectorOptions?.centerGraph;
        if (layout.bbox && (shouldCenter || !this._didFit)) {
            this._fitToBBox(layout.bbox);
            this._didFit = true;
        }

        this._draw(view, state, layout);
    }

    _computeLayout(view) {
        const nodes = Array.isArray(view?.nodes) ? view.nodes : [];
        const edges = Array.isArray(view?.edges) ? view.edges : [];

        const nodeById = new Map();
        for (const node of nodes) {
            if (!node || node.id == null) continue;
            nodeById.set(node.id, node);
        }

        const adjacency = new Map();
        const edgeById = new Map();
        const edgeRecords = [];

        const ensureAdj = (id) => {
            if (!adjacency.has(id)) adjacency.set(id, []);
            return adjacency.get(id);
        };
        for (const edge of edges) {
            if (!edge || edge.id == null) continue;
            const sourceId = resolveNodeId(edge.source);
            const targetId = resolveNodeId(edge.target);
            if (!nodeById.has(sourceId) || !nodeById.has(targetId)) continue;
            const rawLen = Number(edge.lengthM);
            const length = Number.isFinite(rawLen) && rawLen > 0 ? rawLen : DEFAULT_EDGE_LENGTH;

            ensureAdj(sourceId).push({id: targetId, edgeId: edge.id, length});
            ensureAdj(targetId).push({id: sourceId, edgeId: edge.id, length});

            const record = {
                id: edge.id,
                label: edge.label ?? null,
                sourceId,
                targetId,
                lengthM: length
            };
            edgeById.set(edge.id, record);
            edgeRecords.push(record);
        }

        nodeById.forEach((_, id) => { if (!adjacency.has(id)) adjacency.set(id, []); });

        const components = [];
        const visited = new Set();
        for (const nodeId of nodeById.keys()) {
            if (visited.has(nodeId)) continue;
            const queue = [nodeId];
            const comp = new Set();
            visited.add(nodeId);
            while (queue.length) {
                const cur = queue.shift();
                comp.add(cur);
                for (const nbr of adjacency.get(cur) || []) {
                    if (!visited.has(nbr.id)) {
                        visited.add(nbr.id);
                        queue.push(nbr.id);
                    }
                }
            }
            components.push(comp);
        }

        const distMap = new Map();
        const laneMap = new Map();
        let laneFloor = 0;

        const runDijkstra = (rootId, compNodes) => {
            const dist = new Map();
            const parent = new Map();
            const settled = new Set();
            const queue = [rootId];
            dist.set(rootId, 0);
            while (queue.length) {
                let bestIdx = 0;
                for (let i = 1; i < queue.length; i++) {
                    const a = dist.get(queue[i]) ?? Infinity;
                    const b = dist.get(queue[bestIdx]) ?? Infinity;
                    if (a < b) bestIdx = i;
                }
                const nodeId = queue.splice(bestIdx, 1)[0];
                if (settled.has(nodeId)) continue;
                settled.add(nodeId);
                const currentDist = dist.get(nodeId) ?? 0;
                for (const nbr of adjacency.get(nodeId) || []) {
                    if (!compNodes.has(nbr.id)) continue;
                    const weight = Number.isFinite(nbr.length) && nbr.length > 0 ? nbr.length : DEFAULT_EDGE_LENGTH;
                    const alt = currentDist + weight;
                    const prev = dist.get(nbr.id);
                    if (!Number.isFinite(prev) || alt < prev - 1e-6) {
                        dist.set(nbr.id, alt);
                        parent.set(nbr.id, nodeId);
                        queue.push(nbr.id);
                    }
                }
            }
            return {dist, parent};
        };
        for (const compNodes of components) {
            if (!compNodes.size) continue;
            let rootId = null;
            for (const id of compNodes) {
                const deg = (adjacency.get(id) || []).length;
                if (deg <= 1) { rootId = id; break; }
            }
            if (!rootId) {
                rootId = compNodes.values().next().value;
            }
            const {dist, parent} = runDijkstra(rootId, compNodes);
            dist.set(rootId, dist.get(rootId) ?? 0);

            for (const id of compNodes) {
                distMap.set(id, dist.get(id) ?? 0);
            }

            const children = new Map();
            for (const [childId, parentId] of parent.entries()) {
                if (!children.has(parentId)) children.set(parentId, []);
                children.get(parentId).push(childId);
            }

            const assignLane = (nodeId, lane) => {
                laneMap.set(nodeId, lane);
                const kids = children.get(nodeId) || [];
                if (!kids.length) {
                    return {min: lane, max: lane};
                }
                if (kids.length === 1) {
                    const res = assignLane(kids[0], lane);
                    return {min: Math.min(lane, res.min), max: Math.max(lane, res.max)};
                }
                const sorted = [...kids].sort((a, b) => {
                    const da = dist.get(a) ?? 0;
                    const db = dist.get(b) ?? 0;
                    if (da !== db) return da - db;
                    return String(a).localeCompare(String(b));
                });
                let minLane = lane;
                let maxLane = lane;
                const start = lane - (sorted.length - 1) / 2;
                sorted.forEach((childId, idx) => {
                    const childLane = start + idx;
                    const res = assignLane(childId, childLane);
                    minLane = Math.min(minLane, res.min);
                    maxLane = Math.max(maxLane, res.max);
                });
                return {min: minLane, max: maxLane};
            };

            const {min, max} = assignLane(rootId, 0);
            const shift = laneFloor - min;
            for (const id of compNodes) {
                const lane = laneMap.get(id);
                if (lane == null) {
                    laneMap.set(id, laneFloor);
                    continue;
                }
                laneMap.set(id, lane + shift);
            }
            laneFloor = (max + shift) + COMPONENT_LANE_GAP;
        }

        const nodeArray = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [nodeId, node] of nodeById.entries()) {
            const dist = distMap.get(nodeId) ?? 0;
            const lane = laneMap.get(nodeId) ?? 0;
            const x = dist;
            const y = lane * LANE_SPACING;
            node.x = x;
            node.y = y;
            node.lane = lane;
            nodeArray.push(node);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        const edgeArray = [];
        for (const record of edgeRecords) {
            const src = nodeById.get(record.sourceId);
            const tgt = nodeById.get(record.targetId);
            if (!src || !tgt) continue;
            record.x1 = src.x;
            record.y1 = src.y;
            record.x2 = tgt.x;
            record.y2 = tgt.y;
            edgeArray.push(record);
        }

        if (!Number.isFinite(minX)) {
            minX = -100;
            maxX = 100;
            minY = -100;
            maxY = 100;
        }

        const bbox = {
            min: {x: minX - BBOX_MARGIN, y: minY - BBOX_MARGIN},
            max: {x: maxX + BBOX_MARGIN, y: maxY + BBOX_MARGIN}
        };
        bbox.width = bbox.max.x - bbox.min.x;
        bbox.height = bbox.max.y - bbox.min.y;

        const placeOnEdge = (edgeId, distanceMeters) => {
            const edge = edgeById.get(edgeId);
            if (!edge) return {x: 0, y: 0};
            const src = nodeById.get(edge.sourceId);
            const tgt = nodeById.get(edge.targetId);
            if (!src || !tgt) return {x: 0, y: 0};
            const L = edge.lengthM > 0 ? edge.lengthM : DEFAULT_EDGE_LENGTH;
            const distNum = Number(distanceMeters);
            const distMeters = Number.isFinite(distNum) ? distNum : 0;
            const frac = clamp01(distMeters / L);
            return {
                x: src.x + (tgt.x - src.x) * frac,
                y: src.y + (tgt.y - src.y) * frac
            };
        };

        return {
            nodeById,
            edgeById,
            nodes: nodeArray,
            edges: edgeArray,
            bbox,
            placeOnEdge
        };
    }
    _draw(view, state, layout) {
        const filters = state?.filters ?? {};
        const selSet = new Set(state?.selection ?? []);
        const hideSelected = !!filters.hideSelectedElements;
        const showEdges = filters.showEdges !== false;
        const showNodes = filters.showNodes !== false;
        const showBal = filters.showBalises !== false;
        const showSig = filters.showSignals !== false;
        const showTds = filters.showTdsComponents !== false;
        const showNames = filters.showNames !== false;
        const showIds = !!filters.showIds;
        const showAnyLabel = showNames || showIds;

        const composeLabel = (d) => {
            if (!showAnyLabel) return '';
            const nm = showNames ? (d.name ?? d.label ?? d.type ?? d.kind ?? null) : null;
            const id = showIds ? (d.id ?? null) : null;
            if (nm && id && nm !== id) return `${nm} [${id}]`;
            if (nm) return `${nm}`;
            if (id) return `${id}`;
            return '';
        };

        const nodesData = layout.nodes;
        const edgesData = layout.edges;
        const place = (edgeId, dist) => layout.placeOnEdge(edgeId, dist);

        const spanFor = (edgeId, startDist, endDist) => {
            const edge = layout.edgeById.get(edgeId);
            if (!edge) return null;
            const src = layout.nodeById.get(edge.sourceId);
            const tgt = layout.nodeById.get(edge.targetId);
            if (!src || !tgt) return null;
            const L = edge.lengthM > 0 ? edge.lengthM : DEFAULT_EDGE_LENGTH;
            const startNum = Number(startDist);
            const endNum = Number(endDist);
            let s = Number.isFinite(startNum) ? startNum : 0;
            let e = Number.isFinite(endNum) ? endNum : s;
            if (e < s) {
                const tmp = s;
                s = e;
                e = tmp;
            }
            const f1 = clamp01(s / L);
            const f2 = clamp01(e / L);
            return {
                x1: src.x + (tgt.x - src.x) * f1,
                y1: src.y + (tgt.y - src.y) * f1,
                x2: src.x + (tgt.x - src.x) * f2,
                y2: src.y + (tgt.y - src.y) * f2
            };
        };

        const linkSel = this.gLinks.selectAll('line.link').data(edgesData, (d) => d.id);
        linkSel.exit().remove();
        const linkEnter = linkSel.enter().append('line').attr('class', 'link');
        const linkMerged = linkEnter.merge(linkSel);
        linkMerged
            .attr('x1', (d) => d.x1)
            .attr('y1', (d) => d.y1)
            .attr('x2', (d) => d.x2)
            .attr('y2', (d) => d.y2)
            .classed('is-selected', (d) => selSet.has(d.id))
            .on('click', (ev, d) => this.onSelect([d.id]))
            .style('display', (d) => (showEdges && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        const nodeSel = this.gNodes.selectAll('g.node').data(nodesData, (d) => d.id);
        nodeSel.exit().remove();
        const nodeEnter = nodeSel.enter().append('g').attr('class', 'node');
        nodeEnter.each(function() { appendIconG(d3.select(this), 'node'); });
        nodeEnter.append('title');
        const nodeMerged = nodeEnter.merge(nodeSel);
        nodeMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(${NODE_ICON_SCALE})`)
            .classed('is-selected', (d) => selSet.has(d.id))
            .style('display', (d) => (showNodes && !(hideSelected && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id]));
        nodeMerged.select('title').text((d) => d.label || d.id);
        nodeMerged.each(function(d) {
            const selected = selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });

        const nodeLabels = this.gLabels.selectAll('text.node-label').data(nodesData, (d) => d.id);
        nodeLabels.exit().remove();
        const nodeLabelsMerged = nodeLabels.enter().append('text').attr('class', 'label node-label').attr('dy', -6).merge(nodeLabels);
        nodeLabelsMerged
            .attr('x', (d) => d.x)
            .attr('y', (d) => d.y)
            .text((d) => composeLabel(d))
            .style('display', (d) => (showAnyLabel && showNodes && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        const edgeLabelData = (showAnyLabel && showEdges)
            ? edgesData.map((edge) => ({
                id: edge.id,
                label: edge.label ?? null,
                x: (edge.x1 + edge.x2) / 2,
                y: (edge.y1 + edge.y2) / 2
            }))
            : [];
        const edgeLabels = this.gLabels.selectAll('text.edge-label').data(edgeLabelData, (d) => d.id);
        edgeLabels.exit().remove();
        const edgeLabelsMerged = edgeLabels.enter().append('text').attr('class', 'label edge-label').attr('dy', -4).merge(edgeLabels);
        edgeLabelsMerged
            .attr('x', (d) => d.x)
            .attr('y', (d) => d.y)
            .text((d) => composeLabel(d))
            .style('display', (d) => (showAnyLabel && showEdges && !(hideSelected && selSet.has(d.id))) ? null : 'none');
        const projectElementList = (arr) => {
            if (!Array.isArray(arr)) return [];
            return arr.map((el) => {
                const pos = place(el.edgeId, el.distanceFromA);
                if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
                return {...el, x: pos.x, y: pos.y};
            }).filter(Boolean);
        };
        const baliseData = showBal ? projectElementList(view?.elements?.balises) : [];
        const signalData = showSig ? projectElementList(view?.elements?.signals) : [];
        const tdsData = showTds ? projectElementList(view?.elements?.tds_components) : [];

        const elementLabelData = [];
        if (showBal) elementLabelData.push(...baliseData);
        if (showSig) elementLabelData.push(...signalData);
        if (showTds) elementLabelData.push(...tdsData);

        const elemLabels = this.gLabels.selectAll('text.elem-label').data(elementLabelData, (d) => d.id || `${d.edgeId}:${d.distanceFromA}`);
        elemLabels.exit().remove();
        const elemLabelsMerged = elemLabels.enter().append('text').attr('class', 'label elem-label').attr('dy', -8).merge(elemLabels);
        elemLabelsMerged
            .attr('x', (d) => d.x)
            .attr('y', (d) => d.y)
            .text((d) => composeLabel(d))
            .style('display', (d) => (showAnyLabel && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none');

        const speedRaw = Array.isArray(view?.overlays?.speed) ? view.overlays.speed : [];
        const speedData = speedRaw.map((seg) => {
            const span = spanFor(seg.edgeId, seg.startDistanceM, seg.endDistanceM);
            if (!span) return null;
            return {...seg, span};
        }).filter(Boolean);
        const speedSel = this.gSpeed.selectAll('line.speed').data(speedData, (d) => d.id || `${d.edgeId}:${d.startDistanceM}-${d.endDistanceM}`);
        speedSel.exit().remove();
        const speedMerged = speedSel.enter().append('line').attr('class', 'speed').merge(speedSel);
        speedMerged
            .attr('x1', (d) => d.span.x1)
            .attr('y1', (d) => d.span.y1)
            .attr('x2', (d) => d.span.x2)
            .attr('y2', (d) => d.span.y2)
            .attr('stroke-linecap', 'round')
            .style('display', showEdges ? null : 'none');

        const tdsRaw = Array.isArray(view?.overlays?.tds_sections) ? view.overlays.tds_sections : [];
        const tdsSegments = tdsRaw.map((seg) => {
            const span = spanFor(seg.edgeId, seg.startDistanceM, seg.endDistanceM);
            if (!span) return null;
            return {...seg, span};
        }).filter(Boolean);
        const tdsSel = this.gTdsSec.selectAll('line.tds').data(tdsSegments, (d) => d.id || `${d.edgeId}:${d.startDistanceM}-${d.endDistanceM}`);
        tdsSel.exit().remove();
        const tdsMerged = tdsSel.enter().append('line').attr('class', 'tds').merge(tdsSel);
        tdsMerged
            .attr('x1', (d) => d.span.x1)
            .attr('y1', (d) => d.span.y1)
            .attr('x2', (d) => d.span.x2)
            .attr('y2', (d) => d.span.y2)
            .attr('stroke-linecap', 'round')
            .style('display', showEdges ? null : 'none');
        const balSel = this.gElems.selectAll('g.balise').data(baliseData, (d) => d.id || `${d.edgeId}:${d.distanceFromA}`);
        balSel.exit().remove();
        const balEnter = balSel.enter().append('g').attr('class', 'balise');
        balEnter.each(function() { appendIconG(d3.select(this), 'balise'); });
        const balMerged = balEnter.merge(balSel);
        balMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(1)`)
            .classed('is-selected', (d) => !!d.id && selSet.has(d.id))
            .style('display', (d) => (showBal && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id || d.edgeId]));
        balMerged.each(function(d) {
            const selected = !!d.id && selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });

        const sigSel = this.gElems.selectAll('g.signal').data(signalData, (d) => d.id || `${d.edgeId}:${d.distanceFromA}`);
        sigSel.exit().remove();
        const sigEnter = sigSel.enter().append('g').attr('class', 'signal');
        sigEnter.each(function() { appendIconG(d3.select(this), 'signal'); });
        const sigMerged = sigEnter.merge(sigSel);
        sigMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(${SIGNAL_ICON_SCALE})`)
            .classed('is-selected', (d) => !!d.id && selSet.has(d.id))
            .style('display', (d) => (showSig && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id || d.edgeId]));
        sigMerged.each(function(d) {
            const selected = !!d.id && selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });

        const tdcSel = this.gElems.selectAll('g.tdscomp').data(tdsData, (d) => d.id || `${d.edgeId}:${d.distanceFromA}`);
        tdcSel.exit().remove();
        const tdcEnter = tdcSel.enter().append('g').attr('class', 'tdscomp');
        tdcEnter.each(function() { appendIconG(d3.select(this), 'tds'); });
        const tdcMerged = tdcEnter.merge(tdcSel);
        tdcMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(${TDS_ICON_SCALE})`)
            .classed('is-selected', (d) => !!d.id && selSet.has(d.id))
            .style('display', (d) => (showTds && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id || d.edgeId]));
        tdcMerged.each(function(d) {
            const selected = !!d.id && selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });
    }
}
