import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import {isHighlighted, selectionKeyForDatum} from '../utils/highlight.js';
import {iconSvg, appendIconG, ensureArrowMarker} from '../utils/icons.js';

export default class LocatedRendererD3 {
    constructor({mount, onSelect} = {}) {
        if (!mount) throw new Error('LocatedRendererD3: mount fehlt');
        this.mount = mount;
        this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};

        this.svg = d3.select(this.mount).append('svg').attr('role', 'img').attr('width', '100%').attr('height', '100%');
        this.root = this.svg.append('g').attr('class', 'viewport');

        // HTML-Overlay für Overlap-Popup (liegt über dem SVG)
        this.mount.style.position = (getComputedStyle(this.mount).position === 'static') ? 'relative' : getComputedStyle(this.mount).position;
        this._overlayRoot = d3.select(this.mount)
            .append('div')
            .attr('class', 'overlap-overlay')
            .style('position', 'absolute')
            .style('inset', '0')
            .style('pointer-events', 'none'); // nur das Popup selbst fängt Pointer-Events

        // Hilfs-Cleaner (verhindert Leichen bei Re-Render)
        this.closeOverlapMenu = () => {
            if (this._menuEl) {
                this._menuEl.remove();
                this._menuEl = null;
            }
            if (this._outsideClickHandler) {
                document.removeEventListener('mousedown', this._outsideClickHandler, true);
                document.removeEventListener('keydown', this._outsideKeyHandler, true);
                this._outsideClickHandler = null;
                this._outsideKeyHandler = null;
            }
        };


        // --- LAYER STACK (unten → oben) ----
        this.gEdges = this.root.append('g').attr('class', 'edges');               // 1: unten
        this.gNodes = this.root.append('g').attr('class', 'nodes');               // 2: nodes direkt über edges

        // Segmente (optional über edges/nodes, aber unter Elementen)
        this.gSegments = this.root.append('g').attr('class', 'segments');
        this.gSegLines = this.gSegments.append('g').attr('class', 'seg-lines');
        this.gSegArcs = this.gSegments.append('g').attr('class', 'seg-arcs');

        // Overlays (unter Elementen)
        this.gOver = this.root.append('g').attr('class', 'overlays');
        this.gSpeed = this.gOver.append('g').attr('class', 'speed');
        this.gTdsSec = this.gOver.append('g').attr('class', 'tds');

        // Elemente in definierter Reihenfolge: TDS → Signals → Balises
        this.gTdsElems = this.root.append('g').attr('class', 'elems tds');         // 3
        this.gSignalElems = this.root.append('g').attr('class', 'elems signals');  // 4
        this.gBaliseElems = this.root.append('g').attr('class', 'elems balises');  // 5

        // Labels (ganz oben)
        this.gLabels = this.root.append('g').attr('class', 'labels');              // 6


        // Ensure arrow marker exists in defs (shared)
        ensureArrowMarker(this.svg);

        this.zoom = d3.zoom().scaleExtent([0.1, 16]).on('zoom', (ev) => this.root.attr('transform', ev.transform));
        this.svg.call(this.zoom);

        this.lineGen = d3.line().x((d) => d.x).y((d) => d.y);

        this.svg.attr('viewBox', '0 0 1000 600').attr('preserveAspectRatio', 'xMidYMid meet');
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
        console.log("LocatedRendererD3.update", view, state);
        if (!view) return;
        // Bei jedem Update: evtl. offenes Popup schließen
        this.closeOverlapMenu?.();

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
        const selKey = (d) => selectionKeyForDatum(d);
        const applySelHighlight = (selection) =>
            selection
                .classed('is-selected', d => selSet.has(selKey(d)))
                .classed('is-highlighted', d => isHighlighted(d, selSet))
                .each(function(d) {
                    const selected = selSet.has(selKey(d));
                    const hl = isHighlighted(d, selSet);
                    d3.select(this)
                        .selectAll('circle,rect,path')
                        .classed('is-selected', selected)
                        .classed('is-highlighted', hl);
                });

        // reapply all highlights after transitions or FX updates
        let reapplyHighlights = () => {};
        const maintainHL = () => reapplyHighlights();



        // --- Filter-Flags robust ermitteln (Default = an) ---
        const f = (state && state.filters) ? state.filters : {};
        const pickBool = (obj, ...keys) => {
            for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) return !!obj[k];
            return true; // default ON, wenn Flag fehlt
        };

        const hideSelected = !!f.hideSelectedElements;
        const showEdges = pickBool(f, 'showEdges');
        const showSegments = !!f.showSegments;
        const arcsOnly = !!f.arcsOnly;
        const arrowOnSegments = (f.arrowOnSegments !== false);

        const showNodes = pickBool(f, 'showNodes');
        const showBal = pickBool(f, 'showBalises');
        const showSig = pickBool(f, 'showSignals');
        const showTds = pickBool(f, 'showTdsComponents');

        // Labels: Nodes & Elemente gesteuert über Names/IDs
        const showNames = pickBool(f, "showNames");
        const showIds = pickBool(f, "showIds")
        const showAnyLabel = showNames || showIds;


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



        // --- Edges ---
        const edges = Array.isArray(view.geo_edges) ? view.geo_edges.map(e => ({
            ...e,
            polyline: transformPolyline(e.polyline)
        })) : [];
        const cleanPolyline = (d) => (d.polyline || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

        // --- Edges ---
        const eSel = this.gEdges.selectAll('path.edge').data(edges, d => d.edgeId || d.id);
        eSel.exit().remove();
        const eMerged = eSel.enter().append('path').attr('class', 'edge')
            .merge(eSel)
            .attr('d', d => this.lineGen(cleanPolyline(d)))
            .attr('pointer-events', 'stroke')
            .on('click', (ev, d) => this.onSelect([d.edgeId || d.id]))
            .style('display', d => (showEdges && !(hideSelected && selSet.has(d.edgeId))) ? null: 'none');
        applySelHighlight(eMerged);
        eMerged.filter(d => isHighlighted(d, selSet)).raise();


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

        // --- Nodes (transformiert) ---
        const nodesRaw = Array.isArray(view.nodes) ? view.nodes.map(transform) : [];
        // Items mit Basis-Koordinate, damit Overlap-Index einheitlich funktioniert
        const nodeBase = showNodes ? nodesRaw.map(d => ({
            ...d, baseX: d.x, baseY: d.y, kind: 'node', key: d.id
        })) : [];

        // Render
        const nSel = this.gNodes.selectAll('g.node').data(nodeBase, d => d.id);
        nSel.exit().remove();
        const nEnter = nSel.enter().append('g').attr('class', 'node');
        nEnter.each(function() { appendIconG(d3.select(this), 'node'); });
        const nMerged = nEnter.merge(nSel)
            .attr('transform', d => `translate(${d.baseX},${d.baseY}) scale(${(2.5/3).toFixed(6)})`)
            .on('click', (ev, d) => onElemClick(d, ev));
        applySelHighlight(nMerged);
        nMerged.filter(d => isHighlighted(d, selSet)).raise();
        this.gNodes.selectAll('g.node')
            .style('display', d => (showNodes && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none');

        const composeLabel = (d) => {
            const nm = (showNames ? (d.name ?? d.label ?? null) : null);
            const id = (showIds ? (d.id ?? null) : null);
            if (nm && id && nm !== id) return `${nm} [${id}]`;
            if (nm) return `${nm}`;
            if (id) return `${id}`;
            return '';
        };
        const lNodes = this.gLabels.selectAll('text.node-label').data(nodeBase, d => d.id);
        lNodes.exit().remove();
        lNodes.enter().append('text').attr('class', 'label node-label').attr('dy', -6)
            .merge(lNodes)
            .attr('x', d => d.baseX)
            .attr('y', d => d.baseY)
            .text(d => showAnyLabel ? composeLabel(d) : '')
            .style('pointer-events', 'none')
            .style('display', d => (showAnyLabel && showNodes && !(hideSelected && selSet.has(d.id))) ? null : 'none');


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
            .text(d => showAnyLabel ? composeLabel(d) : '')
            .style('pointer-events', 'none')
            .style('display', d => (showAnyLabel && showEdges && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // --- Segment Labels (Names & IDs) ---
        const segLabelData = (showSegments && showAnyLabel) ? segsToDraw.map(s => {
            let x = 0, y = 0;
            if (s.kind === 'line') {
                x = (s.x1 + s.x2) / 2;
                y = (s.y1 + s.y2) / 2;
            } else {
                const ang = (s.ang1 + s.ang2) / 2;
                x = s.cx + s.r * Math.cos(ang);
                y = s.cy + s.r * Math.sin(ang);
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
            .text(d => showAnyLabel ? composeLabel(d) : '')
            .style('pointer-events', 'none')
            .style('display', d => (showAnyLabel && showSegments && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // --- Elemente (Balisen / Signale / TDS-Komponenten) ---
        const elems = view.elements || {};
        // Transformierte Grunddaten mit Basis-Koordinate (ohne Offset) + stabiler Key
        const makeKey = (d, fallback) => (d.id) ? d.id : (fallback);
        const balBase = showBal ? (elems.balises || []).map(d => {
            const p = transform({x: d.x, y: d.y});
            const key = `${d.edgeId}:${d.ikAB ?? (p.x + ',' + p.y)}`;
            return {...d, baseX: p.x, baseY: p.y, key: makeKey(d, key)};
        }) : [];
        const sigBase = showSig ? (elems.signals || []).map(d => {
            const p = transform({x: d.x, y: d.y});
            const key = `${d.edgeId}:${d.ikAB ?? (p.x + ',' + p.y)}`;
            return {...d, baseX: p.x, baseY: p.y, key: makeKey(d, key)};
        }) : [];
        const tdcBase = showTds ? (elems.tds_components || []).map(d => {
            const p = transform({x: d.x, y: d.y});
            const key = `${d.edgeId}:${d.ikAB ?? (p.x + ',' + p.y)}`;
            return {...d, baseX: p.x, baseY: p.y, key: makeKey(d, key)};
        }) : [];

        // Bildschirm-Geometrie für Pixel-Key (SVG→CSS-Pixel)
        const t = d3.zoomTransform(this.root.node());
        const rect = this.svg.node().getBoundingClientRect();
        const vb = (this.svg.attr('viewBox') || '0 0 1000 600').split(/\s+/).map(Number);
        const scaleX = rect.width / vb[2];
        const scaleY = rect.height / vb[3];

        // Hilfsfunktion: auf Bildschirm-Pixel runden (mit Zoom/Pan & ViewBox-Skalierung)
        const pxKey = (x, y) => {
            const [ux, uy] = t.apply([x, y]);
            return `${Math.round(ux * scaleX)}:${Math.round(uy * scaleY)}`;
        };

        // Overlap-Index aufbauen: Pixel-Key → Array von Elementen
        this._overlapIndex = new Map();
        const _pushOverlap = (d) => {
            const k = pxKey(d.baseX, d.baseY);
            const arr = this._overlapIndex.get(k) || [];
            arr.push(d);
            this._overlapIndex.set(k, arr);
        };

        // Elemente einspeisen (ggf. 'kind' setzen, falls nicht vorhanden)
        (balBase || []).forEach(d => {
            if (!d.kind) d.kind = 'balise';
            _pushOverlap(d);
        });
        (sigBase || []).forEach(d => {
            if (!d.kind) d.kind = 'signal';
            _pushOverlap(d);
        });
        (tdcBase || []).forEach(d => {
            if (!d.kind) d.kind = 'tds';
            _pushOverlap(d);
        });
        (nodeBase || []).forEach(d => {
            if (!d.kind) d.kind = "node";
            _pushOverlap(d);
        });

        // --- Labels der Elemente ---
        const elemLabelData = [];
        for (const arr of [balBase, sigBase, tdcBase]) {
            for (const d of arr) {
                elemLabelData.push({...d, x: d.baseX, y: d.baseY});
            }
        }

        const lElems = this.gLabels.selectAll('text.elem-label').data(elemLabelData, d => d.id || d.key);
        lElems.exit().remove();
        lElems.enter().append('text').attr('class', 'label elem-label').attr('dy', -8)
            .merge(lElems)
            .text(d => showAnyLabel ? composeLabel(d) : '')
            .style('display', d => (showAnyLabel && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none')
            .attr('x', d => d.x)
            .attr('y', d => d.y);

        // Hilfsfunktion: Klick -> bei Überlappung Popup, sonst direkte Selektion
        const onElemClick = (d, ev) => {
            // Alle Elemente, die am gleichen Bildschirm-Pixel liegen
            const key = pxKey(d.baseX, d.baseY);
            const bucket = this._overlapIndex.get(key) || [d];

            // Label-Komponist (verwende vorhandenes composeLabel, falls aktiv)
            const labelOf = (obj) => {
                try {
                    if (showAnyLabel && typeof composeLabel === 'function') return composeLabel(obj);
                } catch (_) {
                }
                return obj.name || obj.label || obj.id || obj.key || obj.edgeId || obj.kind || 'Element';
            };

            if (bucket.length > 1) {
                // Position: neben Cursor (innerhalb des Mount-Containers)
                const clientX = (ev && (ev.clientX !== undefined)) ? ev.clientX : 0;
                const clientY = (ev && (ev.clientY !== undefined)) ? ev.clientY : 0;
                this.openOverlapMenu({clientX, clientY}, bucket, labelOf);
                ev?.stopPropagation?.();
                ev?.preventDefault?.();
                return;
            }

            // Fallback: direkt selektieren
            const selId = d.id || d.key || d.edgeId;
            this.onSelect([selId]);
            ev?.stopPropagation?.();
        };


        this.gBaliseElems.style("display", showBal ? null : "none");
        this.gSignalElems.style("display", showSig ? null : "none");
        this.gTdsElems.style("display", showTds ? null : "none");
        this.gNodes.style("display", showNodes ? null : "none");


        // --- Balisen (finale Positionen, ohne Animation)
        const balSel = this.gBaliseElems.selectAll('g.balise').data(balBase, d => d.id || d.key);
        balSel.exit().remove();
        const balEnter = balSel.enter().append('g').attr('class', 'balise');
        balEnter.each(function() { appendIconG(d3.select(this), 'balise'); });
        const balMerged = balEnter.merge(balSel)
            .attr('transform', d => `translate(${d.baseX},${d.baseY}) scale(1)`) // base r=3
            .on('click', (ev, d) => onElemClick(d, ev))
            .style('display', d => (showBal && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none');

        applySelHighlight(balMerged);
        balMerged.filter(d => isHighlighted(d, selSet)).raise();


        // --- Signale ---
        const sigSel = this.gSignalElems.selectAll('g.signal').data(sigBase, d => d.id || d.key);
        sigSel.exit().remove();
        const sigEnter = sigSel.enter().append('g').attr('class', 'signal');
        sigEnter.each(function() { appendIconG(d3.select(this), 'signal'); });
        const sigMerged = sigEnter.merge(sigSel)
            .attr('transform', d => `translate(${d.baseX},${d.baseY}) scale(${(6/10).toFixed(6)})`)
            .on('click', (ev, d) => onElemClick(d, ev))
            .style('display', d => (showSig && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none');

        applySelHighlight(sigMerged);
        sigMerged.filter(d => isHighlighted(d, selSet)).raise();

        // --- TDS Komponenten ---
        const tdcSel = this.gTdsElems.selectAll('g.tdscomp').data(tdcBase, d => d.id || d.key);
        tdcSel.exit().remove();
        const tdcEnter = tdcSel.enter().append('g').attr('class', 'tdscomp');
        tdcEnter.each(function() { appendIconG(d3.select(this), 'tds'); });
        const tdcMerged = tdcEnter.merge(tdcSel)
            .attr('transform', d => `translate(${d.baseX},${d.baseY}) scale(${(5/7).toFixed(6)})`)
            .on('click', (ev, d) => onElemClick(d, ev))
            .style('display', d => (showTds && !(hideSelected && selSet.has(selKey(d)))) ? null : 'none');
        applySelHighlight(tdcMerged);
        tdcMerged.filter(d => isHighlighted(d, selSet)).raise();
        // position/scale handled above

        // ensure highlights persist
        reapplyHighlights = () => {
            applySelHighlight(eMerged);
            applySelHighlight(nMerged);
            applySelHighlight(balMerged);
            applySelHighlight(sigMerged);
            applySelHighlight(tdcMerged);
        };
        reapplyHighlights();

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

    openOverlapMenu(pos, items, labelOf) {
        this.closeOverlapMenu?.();

        // Menü-Container
        const rect = this.svg.node().getBoundingClientRect();
        const mx = Math.max(8, Math.min(rect.width - 8, pos.clientX - rect.left + 8));
        const my = Math.max(8, Math.min(rect.height - 8, pos.clientY - rect.top + 8));

        const menu = document.createElement('div');
        menu.className = 'overlap-menu';
        menu.style.position = 'absolute';
        menu.style.left = `${mx}px`;
        menu.style.top = `${my}px`;
        menu.style.pointerEvents = 'auto';
        menu.setAttribute('role', 'listbox');
        menu.tabIndex = 0;

        
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => (
            ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]
            )));

    
        const iconFor = (kind) => iconSvg(kind);

        menu.innerHTML = `
            <div class="overlap-menu-hd">Multiple elements at this position</div>
            <div class="overlap-menu-list">
                ${items.map((it, i) => `
                <button class="overlap-item" role="option" data-idx="${i}">
                    ${iconFor(it.kind)}
                    <span class="kind">${esc(it.kind || '')}</span>
                    <span class="label">${esc(labelOf(it))}</span>
                    <span class="id">${esc(it.id || it.key || it.edgeId || '')}</span>
                </button>
            `).join('')}
            </div>
           `;


        // Click → selektieren
        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('button.overlap-item');
            if (!btn) return;
            const it = items[+btn.dataset.idx];
            const selId = it.id || it.key || it.edgeId;
            if (selId != null) this.onSelect([selId]);
            this.closeOverlapMenu();
        });

        // Tastatur: ↑/↓ navigieren, Enter selektieren, ESC schließen
        this._outsideKeyHandler = (e) => {
            if (!this._menuEl) return;
            const focusables = Array.from(this._menuEl.querySelectorAll('button.overlap-item'));
            const idx = focusables.indexOf(document.activeElement);
            if (e.key === 'Escape') {
                this.closeOverlapMenu();
                e.preventDefault();
            } else if (e.key === 'ArrowDown') {
                const n = (idx + 1) % focusables.length;
                focusables[n].focus();
                e.preventDefault();
            } else if (e.key === 'ArrowUp') {
                const n = (idx - 1 + focusables.length) % focusables.length;
                focusables[n].focus();
                e.preventDefault();
            } else if (e.key === 'Enter' && idx >= 0) {
                focusables[idx].click();
                e.preventDefault();
            }
        };

        // Outside-Click schließt (Capture-Phase)
        this._outsideClickHandler = (e) => {
            if (!this._menuEl) return;
            if (!this._menuEl.contains(e.target)) this.closeOverlapMenu();
        };

        document.addEventListener('keydown', this._outsideKeyHandler, true);
        document.addEventListener('mousedown', this._outsideClickHandler, true);

        // In Overlay einhängen
        this._overlayRoot.node().appendChild(menu);
        this._menuEl = menu;

        // Fokus auf erstes Item
        const first = this._menuEl.querySelector('button.overlap-item');
        (first || this._menuEl).focus();
    }


}
