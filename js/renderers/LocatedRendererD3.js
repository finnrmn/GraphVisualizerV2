import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { isHighlighted, selectionKeyForDatum } from '../utils/highlight.js';

export default class LocatedRendererD3 {
    constructor({mount, onSelect} = {}) {
        if (!mount) throw new Error('LocatedRendererD3: mount fehlt');
        this.mount = mount;
        this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};

        this.svg = d3.select(this.mount).append('svg').attr('role', 'img').attr('width', '100%').attr('height', '100%');
        this.root = this.svg.append('g').attr('class', 'viewport');

        // Layer
        this.gEdges = this.root.append('g').attr('class', 'edges');
        this.gOver = this.root.append('g').attr('class', 'overlays');
        // FX-Layer (Cluster-Hinweise) – liegt über Overlays, unter Elementen
        this.gFX = this.root.append('g').attr('class', 'clusterfx');
        this.gElems = this.root.append('g').attr('class', 'elems');
        this.gLabels = this.root.append('g').attr('class', 'labels');
        this.gSegments = this.root.append("g").attr("class", "segments");
        this.gSegLines = this.gSegments.append("g").attr("class", "seg-lines");
        this.gSegArcs = this.gSegments.append("g").attr("class", "seg-arcs");
        // Sub-Layer
        this.gSpeed = this.gOver.append('g').attr('class', 'speed');
        this.gTdsSec = this.gOver.append('g').attr('class', 'tds');

        // Marker (Platzhalter)
        const defs = this.svg.append('defs');
        defs.append('symbol').attr('id', 'sym-balise').append('path').attr('d', 'M0,-6 L6,6 L-6,6 Z');
        defs.append('symbol').attr('id', 'sym-signal').append('rect').attr('x', '-5').attr('y', '-5').attr('width', '10').attr('height', '10').attr('rx', '2');
        defs.append('symbol').attr('id', 'sym-tds').append('path').attr('d', 'M0,-7 L7,0 L0,7 L-7,0 Z');
        defs.append("marker")
            .attr("id", "mk-arrow")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", "10")
            .attr("refY", "5")
            .attr("markerWidth", "6")
            .attr("markerHeight", "6")
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z");


        this.zoom = d3.zoom().scaleExtent([0.1, 16]).on('zoom', (ev) => this.root.attr('transform', ev.transform));
        this.svg.call(this.zoom);

        this.lineGen = d3.line().x((d) => d.x).y((d) => d.y);

        this.svg.attr('viewBox', '0 0 1000 600').attr('preserveAspectRatio', 'xMidYMid meet');
        this._didFit = false;
        // Cluster-Zustand: key (rounded baseXY) -> expanded boolean
        this._clusterState = new Map();
    }

    _fitToBBox(b) {
        if (!b || !b.min || !b.max) return;
        const w = Math.max(1, b.max.x - b.min.x);
        const h = Math.max(1, b.max.y - b.min.y);
        this.svg.attr('viewBox', `${b.min.x} ${b.min.y} ${w} ${h}`);
        this.svg.call(this.zoom.transform, d3.zoomIdentity);
    }

    update(view, state = {}) {
        console.log("LocatedRendererD3.update", view, state);
        if (!view) return;
        // Flip/Center Optionen auslesen
        const opts = state.projectorOptions || {};
        let flipX = !!opts.flipX;
        let flipY = !!opts.flipY;
        let centerGraph = !!opts.centerGraph;
        console.log("flipX", flipX, "flipY", flipY, "centerGraph", centerGraph);


        // BBox für Transformationen
        const bbox = view.bbox && view.bbox.min && view.bbox.max ? view.bbox : null;
        let tx = 0, ty = 0;
        let sx = 1, sy = 1;
        if (flipX && bbox) {
            sx = -1;
            tx = bbox.min.x + bbox.max.x;
        }
        if (flipY && bbox) {
            sy = -1;
            ty = bbox.min.y + bbox.max.y;
        }

        // Center Graph or first-time auto-fit
        if (bbox) {
            if (centerGraph) {
                this._fitToBBox(bbox);
                this._didFit = true;
            } else if (!this._didFit) {
                this._fitToBBox(bbox);
                this._didFit = true;
            }
        }

        // Hilfsfunktion für Transformation
        function transform(p) {
            if (!p) return p;
            let x = p.x, y = p.y;
            if (flipX && bbox) x = tx - x;
            if (flipY && bbox) y = ty - y;
            return {...p, x, y};
        }

        // One-shot zoom to specific XY (from controller.projectorOptions.zoomTo)
        const zt = (opts && opts.zoomTo && Number.isFinite(opts.zoomTo.x) && Number.isFinite(opts.zoomTo.y)) ? opts.zoomTo : null;
        if (zt) {
            const p = transform({x: opts.zoomTo.x, y: opts.zoomTo.y});
            const bw = bbox ? Math.max(1, bbox.max.x - bbox.min.x) : 1000;
            const bh = bbox ? Math.max(1, bbox.max.y - bbox.min.y) : 600;
            const w = Math.max(50, bw / 8);
            const h = Math.max(50, bh / 8);
            this.svg.attr('viewBox', `${p.x - w / 2} ${p.y - h / 2} ${w} ${h}`);
            this.svg.call(this.zoom.transform, d3.zoomIdentity);
            this._didFit = true;
        }

        // Hilfsfunktion für Polyline
        function transformPolyline(arr) {
            return Array.isArray(arr) ? arr.map(transform) : arr;
        }

        // Auswahl-/Highlight-Helfer
        const selSet = new Set(state.selection || []);
        const selKey = selectionKeyForDatum;
        const applySelHighlight = (selection) =>
            selection
                .classed('is-selected', d => selSet.has(selKey(d)))
                .classed('is-highlighted', d => isHighlighted(d, selSet));
        const maintainHL = function() { applySelHighlight(d3.select(this)); };

        // --- Edges ---
        const edges = Array.isArray(view.geo_edges) ? view.geo_edges.map(e => ({...e, polyline: transformPolyline(e.polyline)})) : [];
        const cleanPolyline = (d) => (d.polyline || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

    // --- Edges ---
    // (bereits oben deklariert und transformiert)


        const eSel = this.gEdges.selectAll('path.edge').data(edges, d => d.edgeId || d.id);
        eSel.exit().remove();
        const eMerged = eSel.enter().append('path').attr('class', 'edge')
            .merge(eSel)
            .attr('d', d => this.lineGen(cleanPolyline(d)))
            .attr('pointer-events', 'stroke')
            .on('click', (ev, d) => this.onSelect([d.edgeId || d.id]));
        applySelHighlight(eMerged);
        // keep highlighted edges visible during animations/overlaps
        eMerged.filter(d => isHighlighted(d, selSet)).raise();

        const f = (state && state.filters) ? state.filters : {};
        const showEdges = (f.showEdges !== false); // default = an
        const hideSelected = !!f.hideSelectedElements;
        this.gEdges.style("display", showEdges ? null : "none");
        this.gEdges.selectAll('path.edge')
            .style('display', d => (showEdges && !(hideSelected && selSet.has(d.edgeId || d.id))) ? null : 'none');

// --- Segmente ---
        const showSegments = !!f.showSegments;
        const arcsOnly = !!f.arcsOnly;
        const arrowOnSegments = (f.arrowOnSegments !== false);

        // Click priority: when edges are visible, disable segment clicks; when edges off and segments on, enable segment clicks
        this.gEdges.style("pointer-events", showEdges ? "auto" : "none");
        this.gSegments.style("pointer-events", showEdges ? "none" : (showSegments ? "auto" : "none"));

// Datenquelle
        const allSegsRaw = Array.isArray(view.geo_segments) ? view.geo_segments : [];
        const orientationFlipped = !!((flipX && !flipY) || (!flipX && flipY));
        const allSegs = allSegsRaw.map(s => {
            if (!s) return s;
            if (s.kind === "line") {
                const p1 = transform({x: s.x1, y: s.y1});
                const p2 = transform({x: s.x2, y: s.y2});
                return {...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y};
            } else if (s.kind === "arc") {
                const p1 = transform({x: s.x1, y: s.y1});
                const p2 = transform({x: s.x2, y: s.y2});
                const c = transform({x: s.cx, y: s.cy});
                const sweep = orientationFlipped ? -(s.sweep ?? 0) : (s.sweep ?? 0);
                return {...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx: c.x, cy: c.y, sweep};
            }
            return s;
        });
        const segsToDraw = showSegments
            ? (arcsOnly ? allSegs.filter(s => s && s.kind === "arc") : allSegs)
            : [];

        this.gSegments.style("display", showSegments ? null : "none");

// Lines
        const lineSel = this.gSegLines.selectAll("line.seg-line")
            .data(segsToDraw.filter(s => s.kind === "line"), d => d.id);
        lineSel.exit().remove();
        lineSel.enter().append("line").attr("class", "seg-line")
            .merge(lineSel)
            .attr("x1", d => d.x1).attr("y1", d => d.y1)
            .attr("x2", d => d.x2).attr("y2", d => d.y2)
            .attr("marker-end", arrowOnSegments ? "url(#mk-arrow)" : null)
            .on('click', (ev, d) => this.onSelect([d.id]))
            .style('display', d => (showSegments && !(hideSelected && selSet.has(d.id))) ? null : 'none');

// Arcs als SVG-Arc-Path (M… A rx ry 0 laf sf x y)
        const arcSel = this.gSegArcs.selectAll("path.seg-arc")
            .data(segsToDraw.filter(s => s.kind === "arc"), d => d.id);
        arcSel.exit().remove();
        arcSel.enter().append("path").attr("class", "seg-arc")
            .merge(arcSel)
            .attr("d", d => {
                // Winkeldifferenz normalisieren
                let dAng = d.ang2 - d.ang1;
                // Sweepzeichen beachten (in Daten vorhanden), aber large-arc-flag hängt von |Δ| ab
                const abs = Math.abs(dAng);
                const laf = (abs % (2 * Math.PI)) > Math.PI ? 1 : 0;
                const sf = (d.sweep >= 0) ? 1 : 0; // 1 = CCW
                return `M ${d.x1} ${d.y1} A ${d.r} ${d.r} 0 ${laf} ${sf} ${d.x2} ${d.y2}`;
            })
            .attr("fill", "none")
            .attr("marker-end", arrowOnSegments ? "url(#mk-arrow)" : null)
            .on('click', (ev, d) => this.onSelect([d.id]))
            .style('display', d => (showSegments && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // --- Nodes (optional) ---
        const nodes = Array.isArray(view.nodes) ? view.nodes.map(transform) : [];
        const nSel = this.gElems.selectAll('circle.node').data(nodes, d => d.id);
        nSel.exit().remove();
        const nMerged = nSel.enter().append('circle').attr('class', 'node').attr('r', 2.5)
            .merge(nSel)
            .attr('cx', d => d.x)
            .attr('cy', d => d.y)
            .on('click', (ev, d) => this.onSelect([d.id]));
        applySelHighlight(nMerged);
        nMerged.filter(d => isHighlighted(d, selSet)).raise();

        // Labels: Nodes & Elemente gesteuert über Names/IDs
        const showNames = (f.showNames !== false);
        const showIds = !!f.showIds;
        const showAnyLabel = showNames || showIds;

        const composeLabel = (d) => {
            if (!showAnyLabel) return '';
            const nm = (showNames ? (d.name ?? d.label ?? null) : null);
            const id = (showIds ? (d.id ?? null) : null);
            if (nm && id && nm !== id) return `${nm} [${id}]`;
            if (nm) return `${nm}`;
            if (id) return `${id}`;
            return '';
        };

        // Node-Labels
        const lNodes = this.gLabels.selectAll('text.node-label').data(nodes, d => d.id);
        lNodes.exit().remove();
        lNodes.enter().append('text').attr('class', 'label node-label').attr('dy', -6)
            .merge(lNodes)
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .text(d => composeLabel(d))
            .style('display', d => (showAnyLabel && (f.showNodes !== false) && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // Sichtbarkeit von Knoten (Kreise) unabhängig von Labels
        const showNodes = (f.showNodes !== false);
        this.gElems.selectAll('circle.node')
            .style('display', d => (showNodes && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // --- Edge Labels (Names & IDs) ---
        const topEdges = Array.isArray(view.top_edges) ? view.top_edges : [];
        const edgeNameById = new Map(topEdges.map(e => [e.id, e.label || e.name || null]));
        const edgeLabelData = (showEdges && showAnyLabel) ? edges.map(ge => {
            const pts = cleanPolyline(ge);
            const mid = Math.max(0, Math.floor((pts.length - 1) / 2));
            const p = pts[mid] || pts[0] || {x: 0, y: 0};
            const edgeId = ge.edgeId || ge.id;
            return {id: edgeId, name: edgeNameById.get(edgeId) || null, x: p.x, y: p.y};
        }) : [];
        const lEdges = this.gLabels.selectAll('text.edge-label').data(edgeLabelData, d => d.id);
        lEdges.exit().remove();
        lEdges.enter().append('text').attr('class', 'label edge-label').attr('dy', -4)
            .merge(lEdges)
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .text(d => composeLabel(d))
            .style('display', d => (showAnyLabel && showEdges && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // --- Segment Labels (Names & IDs) ---
        const segLabelData = (showSegments && showAnyLabel) ? segsToDraw.map(s => {
            let x = 0, y = 0;
            if (s.kind === 'line') {
                x = (s.x1 + s.x2) / 2; y = (s.y1 + s.y2) / 2;
            } else {
                const ang = (s.ang1 + s.ang2) / 2; x = s.cx + s.r * Math.cos(ang); y = s.cy + s.r * Math.sin(ang);
            }
            const name = s.kind === 'arc' ? 'Arc' : 'Line';
            return {id: s.id, name, x, y};
        }) : [];
        const lSegs = this.gLabels.selectAll('text.seg-label').data(segLabelData, d => d.id);
        lSegs.exit().remove();
        lSegs.enter().append('text').attr('class', 'label seg-label').attr('dy', -6)
            .merge(lSegs)
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .text(d => composeLabel(d))
            .style('display', d => (showAnyLabel && showSegments && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // --- Elemente (Balisen / Signale / TDS-Komponenten) ---
        const elems = view.elements || {};
        const showBal = (f.showBalises !== false);
        const showSig = (f.showSignals !== false);
        const showTds = (f.showTdsComponents !== false);

        // Transformierte Grunddaten mit Basis-Koordinate (ohne Offset) + stabiler Key
        const makeKey = (d, fallback) => (d.id) ? d.id : (fallback);
        const balBase = showBal ? (elems.balises || []).map(d => { const p = transform({x: d.x, y: d.y}); const key = `${d.edgeId}:${d.ikAB ?? (p.x+','+p.y)}`; return {...d, baseX: p.x, baseY: p.y, key: makeKey(d, key)}; }) : [];
        const sigBase = showSig ? (elems.signals || []).map(d => { const p = transform({x: d.x, y: d.y}); const key = `${d.edgeId}:${d.ikAB ?? (p.x+','+p.y)}`; return {...d, baseX: p.x, baseY: p.y, key: makeKey(d, key)}; }) : [];
        const tdcBase = showTds ? (elems.tds_components || []).map(d => { const p = transform({x: d.x, y: d.y}); const key = `${d.edgeId}:${d.ikAB ?? (p.x+','+p.y)}`; return {...d, baseX: p.x, baseY: p.y, key: makeKey(d, key)}; }) : [];

        // Einheitliche Selektions-Identität (nur aus Auswahl abgeleitet)
        const selKey = (d) => selectionKeyForDatum(d);

        // Clusterbildung nach gerundeter Basisposition
        const roundKey = (x, y) => `${Math.round(x)}:${Math.round(y)}`;
        const clusters = new Map(); // key -> {x,y, items:[{...}]}
        const pushToCluster = (arr, type) => {
            for (const d of arr) {
                const ck = roundKey(d.baseX, d.baseY);
                if (!clusters.has(ck)) clusters.set(ck, {x: d.baseX, y: d.baseY, items: []});
                clusters.get(ck).items.push({...d, __type: type});
                if (!this._clusterState.has(ck)) this._clusterState.set(ck, false);
            }
        };
        pushToCluster(balBase, 'balise');
        pushToCluster(sigBase, 'signal');
        pushToCluster(tdcBase, 'tdscomp');

        // Offset-Berechnung für expandierte Cluster (n>1)
        const posByKey = new Map(); // item.key -> {x,y}
        const labelPosByKey = new Map();
        const rings = []; // FX: Kreise für expandierte Cluster
        clusters.forEach((cl, ck) => {
            const n = cl.items.length;
            const expanded = this._clusterState.get(ck) === true;
            const R = expanded && n > 1 ? 14 : 0; // Radius in SVG-Einheiten
            if (expanded && n > 1) {
                rings.push({cx: cl.x, cy: cl.y, r: R + 8, id: ck});
            }
            cl.items.forEach((it, i) => {
                const ang = n > 1 && R > 0 ? (2 * Math.PI * i) / n : 0;
                const dx = R * Math.cos(ang), dy = R * Math.sin(ang);
                const fx = cl.x + dx, fy = cl.y + dy;
                posByKey.set(it.key, {x: fx, y: fy});
                labelPosByKey.set(it.key, {x: fx, y: fy});
            });
        });

        // --- Labels der Elemente --- (an finale Positionen)
        const elemLabelData = [];
        for (const arr of [balBase, sigBase, tdcBase]) {
            for (const d of arr) {
                const p = posByKey.get(d.key) || {x: d.baseX, y: d.baseY};
                elemLabelData.push({...d, x: p.x, y: p.y});
            }
        }
        const lElems = this.gLabels.selectAll('text.elem-label').data(elemLabelData, d => d.id || d.key);
        lElems.exit().remove();
        lElems.enter().append('text').attr('class', 'label elem-label').attr('dy', -8)
            .merge(lElems)
            .text(d => composeLabel(d))
            .style('display', d => (showAnyLabel && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none')
            .transition().duration(250)
            .attr('x', d => d.x)
            .attr('y', d => d.y);

        // Hilfsfunktion: Klick-Logik für Elemente in Clustern
        const onElemClick = (d, ev) => {
            const ck = roundKey(d.baseX, d.baseY);
            const isExpanded = this._clusterState.get(ck) === true;
            if (!isExpanded) {
                // 1) War kollabiert -> nur expandieren, KEINE Selektion
                this._clusterState.set(ck, true);
                // Neu zeichnen, damit die Elemente auseinandergehen
                this.update(view, state);
                // Event verbrauchen
                if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
                return;
            }
            // 2) War expandiert -> dieses Element selektieren und danach wieder kollabieren
            this._clusterState.set(ck, false);
            const selId = d.id || d.key || d.edgeId;
            this.onSelect([selId]);
        };

        // --- FX: Ringe für expandierte Cluster ---
        const ringSel = this.gFX.selectAll('circle.cluster-ring').data(rings, d => d.id);
        ringSel.exit().remove();
        const ringEnter = ringSel.enter().append('circle').attr('class', 'cluster-ring')
            .attr('fill', 'none').attr('stroke', '#94a3b8').attr('stroke-dasharray', '4 3').attr('stroke-width', 1)
            .on('click', (ev, d) => {
                // Klick auf den Ring: Cluster ohne Selektion wieder zusammenklappen
                this._clusterState.set(d.id, false);
                this.update(view, state);
                if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
            });
        ringEnter
            .merge(ringSel)
            .classed('is-focused', true)
            .transition().duration(250)
            .attr('cx', d => d.cx).attr('cy', d => d.cy).attr('r', d => d.r);

        // --- Balisen (finale Positionen, animiert)
        const balSel = this.gElems.selectAll('circle.balise').data(balBase, d => d.id || d.key);
        balSel.exit().remove();
        const balEnter = balSel.enter().append('circle').attr('class', 'balise').attr('r', 3)
            .on('click', (ev, d) => onElemClick(d, ev));
        const balMerged = balEnter.merge(balSel)
            .style('display', d => (showBal && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none');
        applySelHighlight(balMerged);
        balMerged.filter(d => isHighlighted(d, selSet)).raise();
        balMerged.transition().duration(250)
            .attr('cx', d => (posByKey.get(d.key)?.x ?? d.baseX))
            .attr('cy', d => (posByKey.get(d.key)?.y ?? d.baseY))
            .on('start', maintainHL)
            .on('interrupt', maintainHL)
            .on('end', maintainHL);

        // --- Signale ---
        const sigSel = this.gElems.selectAll('rect.signal').data(sigBase, d => d.id || d.key);
        sigSel.exit().remove();
        const sigEnter = sigSel.enter().append('rect').attr('class', 'signal').attr('width', 6).attr('height', 6).attr('rx', 1)
            .on('click', (ev, d) => onElemClick(d, ev));
        const sigMerged = sigEnter.merge(sigSel)
            .style('display', d => (showSig && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none');
        applySelHighlight(sigMerged);
        sigMerged.filter(d => isHighlighted(d, selSet)).raise();
        sigMerged.transition().duration(250)
            .attr('x', d => ((posByKey.get(d.key)?.x ?? d.baseX) - 3))
            .attr('y', d => ((posByKey.get(d.key)?.y ?? d.baseY) - 3))
            .on('start', maintainHL)
            .on('interrupt', maintainHL)
            .on('end', maintainHL);

        // --- TDS Komponenten ---
        const tdcSel = this.gElems.selectAll('path.tdscomp').data(tdcBase, d => d.id || d.key);
        tdcSel.exit().remove();
        const tdcEnter = tdcSel.enter().append('path').attr('class', 'tdscomp').attr('d', 'M0,-5 L5,0 L0,5 L-5,0 Z')
            .on('click', (ev, d) => onElemClick(d, ev));
        const tdcMerged = tdcEnter.merge(tdcSel)
            .style('display', d => (showTds && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none');
        applySelHighlight(tdcMerged);
        tdcMerged.filter(d => isHighlighted(d, selSet)).raise();
        tdcMerged.transition().duration(250)
            .attr('transform', d => {
                const p = posByKey.get(d.key) || {x: d.baseX, y: d.baseY};
                return `translate(${p.x},${p.y})`;
            })
            .on('start', maintainHL)
            .on('interrupt', maintainHL)
            .on('end', maintainHL);

        // --- Overlays ---
        const speed = (view.overlays?.speed || []).filter((s) => s && s.startXY && s.endXY).map(s => ({
            ...s,
            startXY: transform(s.startXY),
            endXY: transform(s.endXY)
        }));
        const sSel = this.gSpeed.selectAll('line.speed').data(speed, (d) => `${d.edgeId}:${d.startXY.x},${d.startXY.y}-${d.endXY.x},${d.endXY.y}:${d.speedKmh ?? ''}`);
        sSel.exit().remove();
        sSel.enter().append('line').attr('class', 'speed')
            .merge(sSel)
            .attr('x1', (d) => d.startXY.x).attr('y1', (d) => d.startXY.y)
            .attr('x2', (d) => d.endXY.x).attr('y2', (d) => d.endXY.y);

        const tds = (view.overlays?.tds_sections || []).filter((t) => t && t.startXY && t.endXY).map(t => ({
            ...t,
            startXY: transform(t.startXY),
            endXY: transform(t.endXY)
        }));
        const tSel = this.gTdsSec.selectAll('line.tds').data(tds, (d) => d.id || `${d.edgeId}:${d.startXY.x},${d.startXY.y}-${d.endXY.x},${d.endXY.y}`);
        tSel.exit().remove();
        tSel.enter().append('line').attr('class', 'tds')
            .merge(tSel)
            .attr('x1', (d) => d.startXY.x).attr('y1', (d) => d.startXY.y)
            .attr('x2', (d) => d.endXY.x).attr('y2', (d) => d.endXY.y);
    }
}
