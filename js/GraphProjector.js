// GraphProjector.v2.js (M2 fixed)
// Aufgabe: Aus dem GraphDataStore (normalisiert/indiziert) kompakte, renderer‑freundliche Views erzeugen.
//  - Located View: echte Geometrie (Polylinien + Bögen gesampelt) + projizierte Elemente + optionale Segmente
//  - Dynamic View: reine Topologie (Knoten/Kanten) + Längen/Abstände (A->B)
//  - Zusätze: Bounding‑Box, optionale Filter, QA‑Overlays
//
// WICHTIG: Der Projector kennt KEIN DOM und KEIN Rendering‑Framework.
// Er gibt nur schlanke JSON‑Objekte zurück, die z.B. Canvas/SVG/WebGL‑Renderer konsumieren.

import GraphDataStore from "./GraphDataStore.js";

export default class GraphProjector {
    /** @param {GraphDataStore} store */
    constructor(store) {
        if (!(store instanceof GraphDataStore)) {
            throw new Error("GraphProjector: store muss eine GraphDataStore-Instanz sein.");
        }
        this.store = store;
    }

    // ---------------------------------------------------------------------------
    // LOCATED VIEW
    // ---------------------------------------------------------------------------
    /**
     * Erzeugt eine Geo-View (echte Geometrie) mit optionalen Overlays.
     * @param {Object} [opts]
     * @param {number}  [opts.maxChord=1]             Maximale Sehnenlänge beim Arc-Sampling (Meter)
     * @param {boolean} [opts.includeTopEdges=true]   Topologie-Metadaten der Edges mitgeben
     * @param {boolean} [opts.includeSpeed=true]      Statische Speed-Segmente projizieren
     * @param {boolean} [opts.includeTdsSections=true] TDS-Abschnitte projizieren
     * @param {boolean} [opts.includeTrackPoints=false]
     * @param {boolean} [opts.includeStations=false]
     * @param {boolean} [opts.includeSegments=false]  Segmentierte Geometrie (Line/Arc) ausgeben
     * @param {Function}[opts.edgeFilter]             Prädikat (edge)=>boolean zur Filterung
     * @returns {Object} located view (nodes, geo_edges, elements, overlays, bbox {min,max}, geo_segments?)
     */
    makeLocatedView(opts = {}) {
        const maxChord = Number.isFinite(opts.maxChord) ? opts.maxChord : 1;
        const includeTopEdges = opts.includeTopEdges !== false;
        const includeSpeed = opts.includeSpeed !== false;
        const includeTdsSections = opts.includeTdsSections !== false;
        const includeTrackPoints = opts.includeTrackPoints === true;
        const includeStations = opts.includeStations === true;
        const includeSegments = opts.includeSegments === true;
        const edgeFilter = typeof opts.edgeFilter === "function" ? opts.edgeFilter : null;

        const nodes = [];
        const geo_edges = [];
        const top_edges = includeTopEdges ? [] : undefined;
        const geo_segments = includeSegments ? [] : undefined;

        const elements = {
            balises: [],
            signals: [],
            tds_components: [],
            track_points: includeTrackPoints ? [] : undefined,
            stations: includeStations ? [] : undefined,
        };

        const overlays = {
            speed: includeSpeed ? [] : undefined,
            tds_sections: includeTdsSections ? [] : undefined,
        };

        // ---- Nodes
        for (const n of this.store.getAllNodes()) {
            const p = this.store.getNodeXY(n.id);
            if (!p) continue;
            nodes.push({id: n.id, x: p.x, y: p.y, label: n.s_name || n.id});
        }

        // Helper zum Ermitteln eines IK (0..1) aus unterschiedlichen Feldern
        const ikFrom = (edgeId, obj, keyIK, keyM) => {
            const tIK = _num(obj?.[keyIK]);
            if (Number.isFinite(tIK)) return tIK;
            const m = _num(obj?.[keyM]);
            const L = this._edgeLength(edgeId);
            if (Number.isFinite(m) && Number.isFinite(L) && L > 0) return m / L;
            return null;
        };

        // ---- Edges + optionale Segmente + Inhalte/Overlays
        for (const edge of this.store.getAllEdges()) {
            if (edgeFilter && !edgeFilter(edge)) continue;

            // Polyline der Edge (gesampelt)
            const poly = this.store.getEdgePolyline(edge.id, maxChord);
            if (Array.isArray(poly) && poly.length >= 2) {
                geo_edges.push({edgeId: edge.id, polyline: poly});
            }

            // TopEdges (optional)
            if (includeTopEdges && top_edges) {
                top_edges.push({
                    id: edge.id,
                    a: edge.nodeIdA,
                    b: edge.nodeIdB,
                    label: this.store.getEdgeLabel(edge.id)
                });
            }

            // Segmente (optional)
            if (includeSegments && geo_segments) {
                const segs = this.store.getEdgeSegmentsOrdered(edge.id); // liefert stabile ids & edgeId
                for (const s of segs) {
                    if (s.kind === "line") {
                        geo_segments.push({
                            id: s.id, edgeId: s.edgeId, kind: "line",
                            x1: s.p1.x, y1: s.p1.y, x2: s.p2.x, y2: s.p2.y, len: s.len
                        });
                    } else if (s.kind === "arc") {
                        geo_segments.push({
                            id: s.id, edgeId: s.edgeId, kind: "arc",
                            x1: s.p1.x, y1: s.p1.y, x2: s.p2.x, y2: s.p2.y,
                            cx: s.center.x, cy: s.center.y, r: s.r,
                            ang1: s.ang1, ang2: s.ang2, sweep: s.sweep, len: s.len
                        });
                    }
                }
            }

            // --- Elemente: Balisen / Signale / TDS-Komponenten (über IK projizieren)
            for (const b of this.store.getBalisesByEdge(edge.id)) {
                const ik = _num(b.intrinsicAB ?? b.intrinsicRef ?? b.ikAB);
                const p = Number.isFinite(ik) ? this.store.projectIntrinsicToXY(edge.id, ik) : null;
                if (!p) continue;
                elements.balises.push({id: (b.id || `${edge.id}:${(ik ?? 0).toFixed(5)}`), name: b.name ?? null, edgeId: edge.id, ikAB: ik, x: p.x, y: p.y});
            }
            for (const s of this.store.getSignalsByEdge(edge.id)) {
                const ik = _num(s.intrinsicAB ?? s.intrinsicRef ?? s.ikAB);
                const p = Number.isFinite(ik) ? this.store.projectIntrinsicToXY(edge.id, ik) : null;
                if (!p) continue;
                elements.signals.push({
                    id: (s.id || `${edge.id}:${(ik ?? 0).toFixed(5)}`),
                    name: s.name || s.dbName || null,
                    edgeId: edge.id,
                    kind: s.kind || null,
                    ikAB: ik,
                    x: p.x,
                    y: p.y
                });
            }
            for (const tc of this.store.getTdsComponentsByEdge(edge.id)) {
                const ik = _num(tc.intrinsicAB ?? tc.intrinsicRef ?? tc.ikAB);
                const p = Number.isFinite(ik) ? this.store.projectIntrinsicToXY(edge.id, ik) : null;
                if (!p) continue;
                elements.tds_components.push({
                    id: tc.id || null,
                    edgeId: edge.id,
                    type: tc.componentType || null,
                    name: tc.name || null,
                    ikAB: ik,
                    x: p.x,
                    y: p.y
                });
            }

            // ---- Overlays (Speed / TDS Sections) – IK oder Meter → XY
            if (includeSpeed && overlays.speed) {
                for (const sp of this.store.getSpeedByEdge(edge.id)) {
                    const t1 = ikFrom(edge.id, sp, "startIK", "startDistanceM") ?? ikFrom(edge.id, sp, "startIntrinsic", "startPosM");
                    const t2 = ikFrom(edge.id, sp, "endIK", "endDistanceM") ?? ikFrom(edge.id, sp, "endIntrinsic", "endPosM");
                    if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue;
                    const p1 = this.store.projectIntrinsicToXY(edge.id, t1);
                    const p2 = this.store.projectIntrinsicToXY(edge.id, t2);
                    if (p1 && p2) overlays.speed.push({
                        id: sp.id ?? `${edge.id}:${t1}-${t2}`,
                        edgeId: edge.id,
                        startXY: p1,
                        endXY: p2,
                        speedKmh: _num(sp.speedKmh)
                    });
                }
            }
            if (includeTdsSections && overlays.tds_sections) {
                for (const ts of this.store.getTdsSectionsByEdge(edge.id)) {
                    const t1 = ikFrom(edge.id, ts, "startIK", "startDistanceM") ?? ikFrom(edge.id, ts, "startIntrinsicAB", "startPosM");
                    const t2 = ikFrom(edge.id, ts, "endIK", "endDistanceM") ?? ikFrom(edge.id, ts, "endIntrinsicAB", "endPosM");
                    if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue;
                    const p1 = this.store.projectIntrinsicToXY(edge.id, t1);
                    const p2 = this.store.projectIntrinsicToXY(edge.id, t2);
                    if (p1 && p2) overlays.tds_sections.push({
                        id: ts.id ?? `${edge.id}:${t1}-${t2}`,
                        edgeId: edge.id,
                        startXY: p1,
                        endXY: p2
                    });
                }
            }
        } // <-- Ende Edges‑Schleife

        // ---- BBox aus Nodes + Geo-Edges
        const bbox = this._computeBBox(nodes, geo_edges);

        return {nodes, geo_edges, top_edges, elements, overlays, bbox, geo_segments};
    }

    // ---------------------------------------------------------------------------
    // DYNAMIC VIEW
    // ---------------------------------------------------------------------------
    /**
     * Erzeugt eine topologische View (ohne echte Geometrie), mit A->B-Längen/Abständen.
     * @param {Object} [opts]
     * @param {boolean} [opts.includeSpeed=true]
     * @param {boolean} [opts.includeTdsSections=true]
     * @param {Function}[opts.edgeFilter]
     * @returns {Object} dynamic view (nodes, edges, elements, overlays)
     */
    makeDynamicView(opts = {}) {
        const includeSpeed = opts.includeSpeed !== false;
        const includeTdsSections = opts.includeTdsSections !== false;
        const edgeFilter = typeof opts.edgeFilter === "function" ? opts.edgeFilter : null;

        const nodes = [];
        const edges = [];
        const elements = {balises: [], signals: [], tds_components: []};
        const overlays = {speed: includeSpeed ? [] : undefined, tds_sections: includeTdsSections ? [] : undefined};

        // Nodes (mit optionalen Start‑Hints aus Geo)
        for (const n of this.store.getAllNodes()) {
            const hint = this._xyFromNode(n);
            nodes.push({id: n.id, label: n.s_name || n.id, x0: hint?.x ?? null, y0: hint?.y ?? null});
        }

        // Edges & Inhalte
        for (const e of this.store.getAllEdges()) {
            if (edgeFilter && !edgeFilter(e)) continue;

            edges.push({
                id: e.id,
                label: this.store.getEdgeLabel(e.id) || null,
                source: e.nodeIdA || null,
                target: e.nodeIdB || null,
                lengthM: _num(e.lengthM) ?? null
            });

            const edgeId = e.id;
            const L = this._edgeLength(edgeId);

            for (const b of this.store.getBalisesByEdge(edgeId)) {
                const m = (Number.isFinite(L) && Number.isFinite(b?.intrinsicAB)) ? b.intrinsicAB * L : null;
                elements.balises.push({id: b.id || null, edgeId, distanceFromA: m});
            }
            for (const s of this.store.getSignalsByEdge(edgeId)) {
                const m = (Number.isFinite(L) && Number.isFinite(s?.intrinsicAB)) ? s.intrinsicAB * L : null;
                elements.signals.push({id: s.id || null, edgeId, kind: s.kind || null, distanceFromA: m});
            }
            for (const tc of this.store.getTdsComponentsByEdge(edgeId)) {
                const m = (Number.isFinite(L) && Number.isFinite(tc?.intrinsicAB)) ? tc.intrinsicAB * L : null;
                elements.tds_components.push({
                    id: tc.id || null,
                    edgeId,
                    type: tc.componentType || null,
                    distanceFromA: m
                });
            }

            if (includeSpeed && overlays.speed) {
                for (const seg of this.store.getSpeedByEdge(edgeId)) {
                    const sM = _num(seg.startPosM) ?? (Number.isFinite(L) && Number.isFinite(seg.startIntrinsic) ? seg.startIntrinsic * L : null);
                    const eM = _num(seg.endPosM) ?? (Number.isFinite(L) && Number.isFinite(seg.endIntrinsic) ? seg.endIntrinsic * L : null);
                    overlays.speed.push({
                        edgeId,
                        startDistanceM: sM,
                        endDistanceM: eM,
                        speedKmh: _num(seg.speedKmh) ?? null
                    });
                }
            }

            if (includeTdsSections && overlays.tds_sections) {
                for (const ts of this.store.getTdsSectionsByEdge(edgeId)) {
                    const sM = (Number.isFinite(L) && Number.isFinite(ts?.startIntrinsicAB)) ? ts.startIntrinsicAB * L : null;
                    const eM = (Number.isFinite(L) && Number.isFinite(ts?.endIntrinsicAB)) ? ts.endIntrinsicAB * L : null;
                    overlays.tds_sections.push({id: ts.id || null, edgeId, startDistanceM: sM, endDistanceM: eM});
                }
            }
        }

        return {nodes, edges, elements, overlays};
    }

    // ---------------------------------------------------------------------------
    // HILFSFUNKTIONEN
    // ---------------------------------------------------------------------------
    _xyFromNode(n) {
        if (!n || !n.geoCo) return null;
        const x = Number(n.geoCo.x), y = Number(n.geoCo.y);
        return (Number.isFinite(x) && Number.isFinite(y)) ? {x, y} : null;
    }

    _projectAB(edgeId, ik) {
        const t = _num(ik);
        if (!Number.isFinite(t)) return null;
        return this.store.projectIntrinsicToXY(edgeId, t);
    }

    _edgeLength(edgeId) {
        const L = this.store.getEdgeLength(edgeId);
        if (Number.isFinite(L)) return L;
        // Fallback: Polyline‑Länge schätzen
        const poly = this.store.getEdgePolyline(edgeId, 8);
        if (!Array.isArray(poly) || poly.length < 2) return null;
        let sum = 0;
        for (let i = 0; i < poly.length - 1; i++) {
            const a = poly[i], b = poly[i + 1];
            sum += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return sum || null;
    }

    _computeBBox(nodes, geo_edges) {
        let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
        const bump = (p) => {
            if (!p) return;
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        };

        for (const n of nodes) bump(n);
        for (const ge of geo_edges) for (const p of ge.polyline) bump(p);

        if (!isFinite(minX)) return {min: null, max: null, width: 0, height: 0};
        const min = {x: minX, y: minY};
        const max = {x: maxX, y: maxY};
        return {min, max, width: maxX - minX, height: maxY - minY};
    }
}

// kleine Number‑Helper
function _num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
