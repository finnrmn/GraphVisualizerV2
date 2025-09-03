import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

export default class DynamicRendererD3 {
    constructor({mount, onSelect} = {}) {
        if (!mount) throw new Error('DynamicRendererD3: mount fehlt');
        this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
        this.svg = d3.select(mount).append('svg').attr('role', 'img').attr('width', '100%').attr('height', '100%');
        this.root = this.svg.append('g').attr('class', 'viewport');

        this.gLinks = this.root.append("g").attr("class", "links");
        this.gNodes = this.root.append("g").attr("class", "nodes");
        this.gElems = this.root.append("g").attr("class", "elems");
        this.gLabels = this.root.append("g").attr("class", "labels");
        this.gSpeed = this.root.append("g").attr("class", "speed");
        this.gTdsSec = this.root.append("g").attr("class", "tds");

        this._nodeById = new Map();
        this._edgeById = new Map();

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
        if (view.bbox && !this._didFit && view.bbox.min && view.bbox.max) {
            this._didFit = true;
            this._fitToBBox(view.bbox);
        }
        // Indexe erneuern
        this._nodeById.clear();
        view.nodes.forEach(n => this._nodeById.set(n.id, n));
        this._edgeById.clear();
        view.edges.forEach(e => this._edgeById.set(e.id, e));

        // ---- Simulation initialisieren/aktualisieren
        if (!this._sim) {
            this._sim = d3.forceSimulation(view.nodes)
                .force("link", d3.forceLink(view.edges).id(d => d.id).distance(e => (e.lengthM || 200) / 3))
                .force("charge", d3.forceManyBody().strength(-100))
                .force("center", d3.forceCenter(500, 300))
                .force("collide", d3.forceCollide(8));

            // Startpositionen aus x0/y0 wenn vorhanden
            view.nodes.forEach(n => {
                if (Number.isFinite(n.x0) && Number.isFinite(n.y0)) {
                    n.x = n.x0;
                    n.y = n.y0;
                }
            });

            this._sim.on("tick", () => this._drawDynamic(view, state));
        } else {
            this._sim.nodes(view.nodes);
            this._sim.force("link").links(view.edges);
            this._sim.alpha(0.7).restart();
        }

        // erste Zeichnung sofort
        this._drawDynamic(view, state);
    }

    _drawDynamic(view, state) {
        const f = (state && state.filters) ? state.filters : {};
        const hideSelected = !!f.hideSelectedElements;
        const selSet = new Set(state.selection || []);
        const showEdges = (f.showEdges !== false);
        const showNodes = (f.showNodes !== false);
        // Links
        const linkSel = this.gLinks.selectAll("line.link").data(view.edges, d => d.id);
        linkSel.exit().remove();
        linkSel.enter().append("line").attr("class", "link")
            .merge(linkSel)
            .attr("x1", d => this._nodeById.get(d.source.id ?? d.source)?.x)
            .attr("y1", d => this._nodeById.get(d.source.id ?? d.source)?.y)
            .attr("x2", d => this._nodeById.get(d.target.id ?? d.target)?.x)
            .attr("y2", d => this._nodeById.get(d.target.id ?? d.target)?.y)
            .classed("is-selected", d => state.selection?.includes?.(d.id))
            .on("click", (ev, d) => this.onSelect([d.id]))
            .style("display", d => (showEdges && !(hideSelected && selSet.has(d.id))) ? null : "none");

        // Nodes
        const nodeSel = this.gNodes.selectAll("circle.node").data(view.nodes, d => d.id);
        nodeSel.exit().remove();
        nodeSel.enter().append("circle").attr("class", "node").attr("r", 5)
            .merge(nodeSel)
            .attr("cx", d => d.x).attr("cy", d => d.y)
            .classed("is-selected", d => selSet.has(d.id))
            .call(sel => sel.append("title").text(d => d.label || d.id))
            .on("click", (ev, d) => this.onSelect([d.id]))
            .style("display", d => (showNodes && !(hideSelected && selSet.has(d.id))) ? null : "none");

        // --- Overlays in der topo-Ansicht (proportional entlang der Links)
        const edgeXY = (edge, frac) => {
            const s = this._nodeById.get(edge.source.id ?? edge.source);
            const t = this._nodeById.get(edge.target.id ?? edge.target);
            if (!s || !t) return {x: 0, y: 0};
            return {x: s.x + (t.x - s.x) * frac, y: s.y + (t.y - s.y) * frac};
        };

        // Speedsegments
        const speeds = view.overlays?.speed || [];
        const spSel = this.gSpeed.selectAll("line.speed").data(speeds, (d, i) => d.id || `${d.edgeId}:${i}`);
        spSel.exit().remove();
        spSel.enter().append("line").attr("class", "speed")
            .merge(spSel)
            .each((d, i, nodes) => {
                const e = this._edgeById.get(d.edgeId);
                const L = e?.lengthM || 1;
                const f1 = Math.max(0, Math.min(1, (d.startDistanceM ?? 0) / L));
                const f2 = Math.max(0, Math.min(1, (d.endDistanceM ?? L) / L));
                const p1 = edgeXY(e, f1), p2 = edgeXY(e, f2);
                d3.select(nodes[i])
                    .attr("x1", p1.x).attr("y1", p1.y)
                    .attr("x2", p2.x).attr("y2", p2.y)
                    .attr("stroke-linecap", "round");
            });

        // TDS Sections
        const tds = view.overlays?.tds_sections || [];
        const tsSel = this.gTdsSec.selectAll("line.tds").data(tds, d => d.id || `${d.edgeId}:${d.startDistanceM}-${d.endDistanceM}`);
        tsSel.exit().remove();
        tsSel.enter().append("line").attr("class", "tds")
            .merge(tsSel)
            .each((d, i, nodes) => {
                const e = this._edgeById.get(d.edgeId);
                const L = e?.lengthM || 1;
                const f1 = Math.max(0, Math.min(1, (d.startDistanceM ?? 0) / L));
                const f2 = Math.max(0, Math.min(1, (d.endDistanceM ?? L) / L));
                const p1 = edgeXY(e, f1), p2 = edgeXY(e, f2);
                d3.select(nodes[i]).attr("x1", p1.x).attr("y1", p1.y).attr("x2", p2.x).attr("y2", p2.y).attr("stroke-linecap", "round");
            });

        // Elemente (Balises / Signals / TDS-Components) – proportional entlang des Links
        const showBal = state.filters?.showBalises !== false;
        const showSig = state.filters?.showSignals !== false;
        const showTds = state.filters?.showTdsComponents !== false;

        const place = (edgeId, distM) => {
            const e = this._edgeById.get(edgeId);
            const L = e?.lengthM || 1;
            const f = Math.max(0, Math.min(1, (distM ?? 0) / L));
            return edgeXY(e, f);
        };

        // Labels: Nodes & Elemente gesteuert über Names/IDs
        const showNames = (state.filters?.showNames !== false);
        const showIds = !!state.filters?.showIds;
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
        const lNodes = this.gLabels.selectAll('text.node-label').data(view.nodes, d => d.id);
        lNodes.exit().remove();
        lNodes.enter().append('text').attr('class', 'label node-label').attr('dy', -6)
            .merge(lNodes)
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .text(d => composeLabel(d))
            .style('display', d => (showAnyLabel && showNodes && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // Edge Labels (Names & IDs)
        const edgeLabelData = (showAnyLabel && showEdges) ? view.edges.map(e => {
            const s = this._nodeById.get(e.source.id ?? e.source);
            const t = this._nodeById.get(e.target.id ?? e.target);
            if (!s || !t) return null;
            return {id: e.id, name: e.label || null, x: (s.x + t.x) / 2, y: (s.y + t.y) / 2};
        }).filter(Boolean) : [];
        const lEdges = this.gLabels.selectAll('text.edge-label').data(edgeLabelData, d => d.id);
        lEdges.exit().remove();
        lEdges.enter().append('text').attr('class', 'label edge-label').attr('dy', -4)
            .merge(lEdges)
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .text(d => composeLabel(d))
            .style('display', d => (showAnyLabel && showEdges && !(hideSelected && selSet.has(d.id))) ? null : 'none');

        // Elemente Labels (entlang der Links positioniert)
        const elemLabelData = [];
        if (showBal) (view.elements?.balises || []).forEach(d => { const p = place(d.edgeId, d.distanceFromA); elemLabelData.push({...d, x: p.x, y: p.y}); });
        if (showSig) (view.elements?.signals || []).forEach(d => { const p = place(d.edgeId, d.distanceFromA); elemLabelData.push({...d, x: p.x, y: p.y}); });
        if (showTds) (view.elements?.tds_components || []).forEach(d => { const p = place(d.edgeId, d.distanceFromA); elemLabelData.push({...d, x: p.x, y: p.y}); });

        const lElems = this.gLabels.selectAll('text.elem-label').data(elemLabelData, d => d.id || `${d.edgeId}:${d.distanceFromA}`);
        lElems.exit().remove();
        lElems.enter().append('text').attr('class', 'label elem-label').attr('dy', -8)
            .merge(lElems)
            .attr('x', d => d.x)
            .attr('y', d => d.y)
            .text(d => composeLabel(d))
            .style('display', d => (showAnyLabel && !(hideSelected && d.id && selSet.has(d.id))) ? null : 'none');

        // Balises
        const balData = showBal ? (view.elements?.balises || []) : [];
        const balSel = this.gElems.selectAll("circle.balise").data(balData, d => d.id || `${d.edgeId}:${d.distanceFromA}`);
        balSel.exit().remove();
        balSel.enter().append("circle").attr("class", "balise").attr("r", 3)
            .merge(balSel)
            .attr("cx", d => place(d.edgeId, d.distanceFromA).x)
            .attr("cy", d => place(d.edgeId, d.distanceFromA).y)
            .classed("is-selected", d => !!d.id && selSet.has(d.id))
            .on("click", (ev, d) => this.onSelect([d.id || d.edgeId]))
            .style("display", d => (showBal && !(hideSelected && d.id && selSet.has(d.id))) ? null : "none");

        // Signals
        const sigData = showSig ? (view.elements?.signals || []) : [];
        const sigSel = this.gElems.selectAll("rect.signal").data(sigData, d => d.id || `${d.edgeId}:${d.distanceFromA}`);
        sigSel.exit().remove();
        sigSel.enter().append("rect").attr("class", "signal").attr("width", 6).attr("height", 6).attr("rx", 1)
            .merge(sigSel)
            .attr("x", d => place(d.edgeId, d.distanceFromA).x - 3)
            .attr("y", d => place(d.edgeId, d.distanceFromA).y - 3)
            .classed("is-selected", d => !!d.id && selSet.has(d.id))
            .on("click", (ev, d) => this.onSelect([d.id || d.edgeId]))
            .style("display", d => (showSig && !(hideSelected && d.id && selSet.has(d.id))) ? null : "none");

        // TDS Components
        const tdcData = showTds ? (view.elements?.tds_components || []) : [];
        const tdcSel = this.gElems.selectAll("path.tdscomp").data(tdcData, d => d.id || `${d.edgeId}:${d.distanceFromA}`);
        tdcSel.exit().remove();
        tdcSel.enter().append("path").attr("class", "tdscomp").attr("d", "M0,-5 L5,0 L0,5 L-5,0 Z")
            .merge(tdcSel)
            .attr("transform", d => {
                const p = place(d.edgeId, d.distanceFromA);
                return `translate(${p.x},${p.y})`;
            })
            .classed("is-selected", d => !!d.id && selSet.has(d.id))
            .on("click", (ev, d) => this.onSelect([d.id || d.edgeId]))
            .style("display", d => (showTds && !(hideSelected && d.id && selSet.has(d.id))) ? null : "none");
    }

}


