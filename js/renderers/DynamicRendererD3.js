import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import {appendIconG} from '../utils/graphSymbols.js';

const DEFAULT_EDGE_LENGTH = 100;
const LANE_SPACING = 120;
const COMPONENT_LANE_GAP = 3;
const BBOX_MARGIN = 200;
const NODE_ICON_SCALE = (5 / 3).toFixed(6);
const SIGNAL_ICON_SCALE = (6 / 10).toFixed(6);
const TDS_ICON_SCALE = (5 / 7).toFixed(6);
const DRAG_PROPAGATION_FALLOFF = 0.65;
const MAX_PROPAGATION_DEPTH = 6;

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

function computeBBox(nodes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
        if (!n) continue;
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    }
    if (!Number.isFinite(minX)) {
        return {
            min: {x: -100, y: -100},
            max: {x: 100, y: 100},
            width: 200,
            height: 200
        };
    }
    const min = {x: minX - BBOX_MARGIN, y: minY - BBOX_MARGIN};
    const max = {x: maxX + BBOX_MARGIN, y: maxY + BBOX_MARGIN};
    return {
        min,
        max,
        width: max.x - min.x,
        height: max.y - min.y
    };
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
        this._pinned = new Map();
        this._currentLayout = null;
        this._currentView = null;
        this._currentState = null;
        this._dragPrev = null;

        this.svg.attr('viewBox', '0 0 1000 600').attr('preserveAspectRatio', 'xMidYMid meet');
        this.zoom = d3.zoom().scaleExtent([0.1, 16]).on('zoom', (ev) => this.root.attr('transform', ev.transform));
        this.svg.call(this.zoom);
        this._didFit = false;

        this._dragBehavior = d3.drag()
            .subject((event, d) => ({x: d.x, y: d.y}))
            .on('start', (event, d) => this._onDragStart(event, d))
            .on('drag', (event, d) => this._onDrag(event, d))
            .on('end', (event, d) => this._onDragEnd(event, d));
    }

    _cleanupPinned(view) {
        if (!this._pinned.size) return;
        const validIds = new Set((view?.nodes || []).map((n) => n?.id).filter((id) => id != null));
        for (const id of [...this._pinned.keys()]) {
            if (!validIds.has(id)) {
                this._pinned.delete(id);
            }
        }
    }

    _cloneState(state) {
        if (!state) return {};
        return {
            ...state,
            filters: {...(state.filters || {})},
            selection: Array.isArray(state.selection) ? [...state.selection] : [],
            projectorOptions: {...(state.projectorOptions || {})}
        };
    }

    update(view, state = {}) {
        if (!view) return;

        this._currentView = view;
        this._currentState = this._cloneState(state);
        this._cleanupPinned(view);

        const layout = this._computeLayout(view);
        this._currentLayout = layout;
        this._nodeById = layout.nodeById;
        this._edgeById = layout.edgeById;

        const centerRequested = !!this._currentState?.projectorOptions?.centerGraph;
        if (layout.bbox && (centerRequested || !this._didFit)) {
            this._fitToBBox(layout.bbox);
            this._didFit = true;
        }

        this._render(layout, this._currentState, view);
    }

    _fitToBBox(b) {
        if (!b || !b.min || !b.max) return;
        const w = Math.max(1, b.max.x - b.min.x);
        const h = Math.max(1, b.max.y - b.min.y);
        this.svg.attr('viewBox', `${b.min.x} ${b.min.y} ${w} ${h}`);
        this.svg.call(this.zoom.transform, d3.zoomIdentity);
    }

    _computeLayout(view) {
        const nodesInput = Array.isArray(view?.nodes) ? view.nodes : [];
        const edgesInput = Array.isArray(view?.edges) ? view.edges : [];

        const adjacency = new Map();
        const rawNodeById = new Map();
        for (const node of nodesInput) {
            if (!node || node.id == null) continue;
            rawNodeById.set(node.id, node);
            adjacency.set(node.id, []);
        }

        const edgeRecords = [];
        for (const edge of edgesInput) {
            if (!edge || edge.id == null) continue;
            const sourceId = resolveNodeId(edge.source);
            const targetId = resolveNodeId(edge.target);
            if (!rawNodeById.has(sourceId) || !rawNodeById.has(targetId)) continue;
            const rawLen = Number(edge.lengthM);
            const length = Number.isFinite(rawLen) && rawLen > 0 ? rawLen : DEFAULT_EDGE_LENGTH;
            adjacency.get(sourceId).push({nodeId: targetId, length});
            adjacency.get(targetId).push({nodeId: sourceId, length});
            edgeRecords.push({
                id: edge.id,
                label: edge.label ?? null,
                sourceId,
                targetId,
                lengthM: length
            });
        }

        // Ensure isolated nodes have adjacency entries
        rawNodeById.forEach((_, id) => {
            if (!adjacency.has(id)) adjacency.set(id, []);
        });

        // Connected components
        const components = [];
        const componentIndex = new Map();
        const visited = new Set();
        for (const nodeId of rawNodeById.keys()) {
            if (visited.has(nodeId)) continue;
            const queue = [nodeId];
            const comp = [];
            visited.add(nodeId);
            while (queue.length) {
                const cur = queue.shift();
                comp.push(cur);
                for (const nbr of adjacency.get(cur) || []) {
                    if (visited.has(nbr.nodeId)) continue;
                    visited.add(nbr.nodeId);
                    queue.push(nbr.nodeId);
                }
            }
            const idx = components.push(comp) - 1;
            for (const id of comp) componentIndex.set(id, idx);
        }

        const nodeById = new Map();
        const nodes = [];
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
                    if (!compNodes.has(nbr.nodeId)) continue;
                    const weight = Number.isFinite(nbr.length) && nbr.length > 0 ? nbr.length : DEFAULT_EDGE_LENGTH;
                    const alt = currentDist + weight;
                    const prev = dist.get(nbr.nodeId);
                    if (!Number.isFinite(prev) || alt < prev - 1e-6) {
                        dist.set(nbr.nodeId, alt);
                        parent.set(nbr.nodeId, nodeId);
                        queue.push(nbr.nodeId);
                    }
                }
            }
            return {dist, parent};
        };

        const laneMap = new Map();
        let laneFloor = 0;
        for (const comp of components) {
            if (!comp.length) continue;
            const compSet = new Set(comp);
            let rootId = null;
            for (const id of comp) {
                const degree = (adjacency.get(id) || []).length;
                if (degree <= 1) {
                    rootId = id;
                    break;
                }
            }
            if (!rootId) rootId = comp[0];

            const {dist, parent} = runDijkstra(rootId, compSet);
            dist.set(rootId, dist.get(rootId) ?? 0);

            const children = new Map();
            for (const [childId, parentId] of parent.entries()) {
                if (!children.has(parentId)) children.set(parentId, []);
                children.get(parentId).push(childId);
            }

            const assignLane = (nodeId, lane) => {
                laneMap.set(nodeId, lane);
                const kids = children.get(nodeId) || [];
                if (!kids.length) return {min: lane, max: lane};
                if (kids.length === 1) return assignLane(kids[0], lane);
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
            for (const id of comp) {
                const lane = laneMap.get(id);
                laneMap.set(id, lane + shift);
            }
            laneFloor = (max + shift) + COMPONENT_LANE_GAP;

            for (const id of comp) {
                const original = rawNodeById.get(id);
                const lane = laneMap.get(id) ?? 0;
                const distVal = dist.get(id) ?? 0;
                const nodeCopy = {...original};
                nodeCopy.x = distVal;
                nodeCopy.y = lane * LANE_SPACING;
                nodeCopy.lane = lane;
                nodes.push(nodeCopy);
                nodeById.set(id, nodeCopy);
            }
        }

        const edgeById = new Map();
        for (const edge of edgeRecords) {
            edgeById.set(edge.id, edge);
        }

        const layout = {
            nodes,
            edges: edgeRecords,
            nodeById,
            edgeById,
            adjacency,
            components,
            componentIndex,
            placeOnEdge: (edgeId, distanceMeters) => {
                const record = edgeById.get(edgeId);
                if (!record) return {x: 0, y: 0};
                const src = nodeById.get(record.sourceId);
                const tgt = nodeById.get(record.targetId);
                if (!src || !tgt) return {x: 0, y: 0};
                const L = record.lengthM > 0 ? record.lengthM : DEFAULT_EDGE_LENGTH;
                const dist = Number(distanceMeters);
                const frac = clamp01(Number.isFinite(dist) ? dist / L : 0);
                return {
                    x: src.x + (tgt.x - src.x) * frac,
                    y: src.y + (tgt.y - src.y) * frac
                };
            }
        };

        this._applyPinnedConstraints(layout);
        layout.bbox = computeBBox(layout.nodes);
        return layout;
    }

    _applyPinnedConstraints(layout) {
        if (!this._pinned.size) return;
        const {nodeById, components, componentIndex} = layout;
        const componentPinned = new Map();
        for (const [nodeId, desired] of this._pinned.entries()) {
            const compIdx = componentIndex.get(nodeId);
            if (compIdx == null) continue;
            const node = nodeById.get(nodeId);
            if (!node) continue;
            if (!componentPinned.has(compIdx)) componentPinned.set(compIdx, []);
            componentPinned.get(compIdx).push({node, desired});
        }
        for (const [compIdx, pinnedEntries] of componentPinned.entries()) {
            if (!pinnedEntries.length) continue;
            let dx = 0;
            let dy = 0;
            if (pinnedEntries.length === 1) {
                const {node, desired} = pinnedEntries[0];
                dx = desired.x - node.x;
                dy = desired.y - node.y;
            } else {
                let sumX = 0;
                let sumY = 0;
                for (const {node, desired} of pinnedEntries) {
                    sumX += (desired.x - node.x);
                    sumY += (desired.y - node.y);
                }
                dx = sumX / pinnedEntries.length;
                dy = sumY / pinnedEntries.length;
            }
            const compNodes = components[compIdx] || [];
            for (const id of compNodes) {
                const node = nodeById.get(id);
                if (!node) continue;
                node.x += dx;
                node.y += dy;
            }
            for (const {node, desired} of pinnedEntries) {
                node.x = desired.x;
                node.y = desired.y;
            }
        }
    }

    _render(layout, state, view) {
        const filters = state?.filters || {};
        const selSet = new Set(state?.selection || []);
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
        const place = layout.placeOnEdge;
        const adjacency = layout.adjacency;

        const spanFor = (edgeId, startDist, endDist) => {
            const record = layout.edgeById.get(edgeId);
            if (!record) return null;
            const src = layout.nodeById.get(record.sourceId);
            const tgt = layout.nodeById.get(record.targetId);
            if (!src || !tgt) return null;
            const L = record.lengthM > 0 ? record.lengthM : DEFAULT_EDGE_LENGTH;
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
            .attr('x1', (d) => layout.nodeById.get(d.sourceId)?.x ?? 0)
            .attr('y1', (d) => layout.nodeById.get(d.sourceId)?.y ?? 0)
            .attr('x2', (d) => layout.nodeById.get(d.targetId)?.x ?? 0)
            .attr('y2', (d) => layout.nodeById.get(d.targetId)?.y ?? 0)
            .classed('is-selected', (d) => selSet.has(d.id))
            .on('click', (ev, d) => this.onSelect([d.id]))
            .style('display', (d) => (showEdges && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        const nodeSel = this.gNodes.selectAll('g.node').data(nodesData, (d) => d.id);
        nodeSel.exit().remove();
        const nodeEnter = nodeSel.enter().append('g').attr('class', 'node');
        nodeEnter.each(function () { appendIconG(d3.select(this), 'node'); });
        nodeEnter.append('title');
        const nodeMerged = nodeEnter.merge(nodeSel);
        nodeMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(${NODE_ICON_SCALE})`)
            .classed('is-selected', (d) => selSet.has(d.id))
            .classed('is-pinned', (d) => this._pinned.has(d.id))
            .style('display', (d) => (showNodes && !(hideSelected && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id]))
            .on('dblclick', (ev, d) => this._onNodeDblClick(ev, d));
        nodeMerged.select('title').text((d) => d.label || d.id);
        nodeMerged.each(function (d) {
            const selected = selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });
        nodeMerged.call(this._dragBehavior);

        const nodeLabels = this.gLabels.selectAll('text.node-label').data(nodesData, (d) => d.id);
        nodeLabels.exit().remove();
        const nodeLabelsMerged = nodeLabels.enter().append('text').attr('class', 'label node-label').attr('dy', -6).merge(nodeLabels);
        nodeLabelsMerged
            .attr('x', (d) => d.x)
            .attr('y', (d) => d.y)
            .text((d) => composeLabel(d))
            .style('display', (d) => (showAnyLabel && showNodes && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        const edgeLabelData = (showAnyLabel && showEdges)
            ? edgesData.map((edge) => {
                const s = layout.nodeById.get(edge.sourceId);
                const t = layout.nodeById.get(edge.targetId);
                if (!s || !t) return null;
                return {id: edge.id, label: edge.label ?? null, x: (s.x + t.x) / 2, y: (s.y + t.y) / 2};
            }).filter(Boolean)
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
        balEnter.each(function () { appendIconG(d3.select(this), 'balise'); });
        const balMerged = balEnter.merge(balSel);
        balMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(1)`)
            .classed('is-selected', (d) => !!d.id && selSet.has(d.id))
            .style('display', (d) => (showBal && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id || d.edgeId]));
        balMerged.each(function (d) {
            const selected = !!d.id && selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });

        const sigSel = this.gElems.selectAll('g.signal').data(signalData, (d) => d.id || `${d.edgeId}:${d.distanceFromA}`);
        sigSel.exit().remove();
        const sigEnter = sigSel.enter().append('g').attr('class', 'signal');
        sigEnter.each(function () { appendIconG(d3.select(this), 'signal'); });
        const sigMerged = sigEnter.merge(sigSel);
        sigMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(${SIGNAL_ICON_SCALE})`)
            .classed('is-selected', (d) => !!d.id && selSet.has(d.id))
            .style('display', (d) => (showSig && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id || d.edgeId]));
        sigMerged.each(function (d) {
            const selected = !!d.id && selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });

        const tdcSel = this.gElems.selectAll('g.tdscomp').data(tdsData, (d) => d.id || `${d.edgeId}:${d.distanceFromA}`);
        tdcSel.exit().remove();
        const tdcEnter = tdcSel.enter().append('g').attr('class', 'tdscomp');
        tdcEnter.each(function () { appendIconG(d3.select(this), 'tds'); });
        const tdcMerged = tdcEnter.merge(tdcSel);
        tdcMerged
            .attr('transform', (d) => `translate(${d.x},${d.y}) scale(${TDS_ICON_SCALE})`)
            .classed('is-selected', (d) => !!d.id && selSet.has(d.id))
            .style('display', (d) => (showTds && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none')
            .on('click', (ev, d) => this.onSelect([d.id || d.edgeId]));
        tdcMerged.each(function (d) {
            const selected = !!d.id && selSet.has(d.id);
            d3.select(this).selectAll('circle,rect,path').classed('is-selected', selected);
        });
    }

    _propagateDrag(anchorId, dx, dy) {
        if (!this._currentLayout || (!dx && !dy)) return;
        const {adjacency, nodeById} = this._currentLayout;
        const visited = new Set([anchorId]);
        const queue = [{id: anchorId, depth: 0}];
        while (queue.length) {
            const {id, depth} = queue.shift();
            if (depth >= MAX_PROPAGATION_DEPTH) continue;
            const nextDepth = depth + 1;
            const factor = Math.pow(DRAG_PROPAGATION_FALLOFF, nextDepth);
            for (const nbr of adjacency.get(id) || []) {
                const nodeId = nbr.nodeId;
                if (visited.has(nodeId)) continue;
                visited.add(nodeId);
                const node = nodeById.get(nodeId);
                if (node && !this._pinned.has(nodeId)) {
                    node.x += dx * factor;
                    node.y += dy * factor;
                }
                queue.push({id: nodeId, depth: nextDepth});
            }
        }
    }

    _onDragStart(event, d) {
        event.sourceEvent?.stopPropagation?.();
        this._dragPrev = {x: d.x, y: d.y};
        this._pinned.set(d.id, {x: d.x, y: d.y});
    }

    _onDrag(event, d) {
        event.sourceEvent?.stopPropagation?.();
        if (!this._currentLayout) return;
        const node = this._currentLayout.nodeById.get(d.id);
        if (!node) return;
        const prev = this._dragPrev || {x: node.x, y: node.y};
        const nx = event.x;
        const ny = event.y;
        const dx = nx - prev.x;
        const dy = ny - prev.y;
        node.x = nx;
        node.y = ny;
        this._pinned.set(d.id, {x: nx, y: ny});
        this._dragPrev = {x: nx, y: ny};
        this._propagateDrag(d.id, dx, dy);
        this._currentLayout.bbox = computeBBox(this._currentLayout.nodes);
        this._render(this._currentLayout, this._currentState, this._currentView);
    }

    _onDragEnd(event, d) {
        event.sourceEvent?.stopPropagation?.();
        this._dragPrev = null;
        this._settleLayout();
    }

    _onNodeDblClick(event, d) {
        event.stopPropagation();
        if (this._pinned.has(d.id)) {
            this._pinned.delete(d.id);
        } else {
            this._pinned.set(d.id, {x: d.x, y: d.y});
        }
        this._settleLayout();
    }

    _settleLayout() {
        if (!this._currentView) return;
        const nextState = this._cloneState(this._currentState);
        this.update(this._currentView, nextState);
    }
}


