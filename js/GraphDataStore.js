// GraphDataStore.js
// Zentrale Datenhaltung & Geometrie-/Projektions-Helfer für den Graph Visualizer
// Datenfluss: ISDPDataFetcher (schema-driven, normalisiert) -> GraphDataStore (Indices/Selektoren) -> GraphProjector/Renderer
//
// Ziele:
//  - Kein unnötiges Kopieren: wir referenzieren die Maps/Arrays des Fetchers (Speicher + Konsistenz)
//  - Bequeme Selektoren für Visualisierung & Tests
//  - Robuste Geometrie-Pipeline (Lines/Transitions als Polylinien, Arcs als Kreisbogen)
//  - Orientierung A->B (unabhängig von RefNode)
//  - Projektion IK (0..1) **oder Meter** entlang der Pfadgeometrie (dieser Fix stellt 0..1 sicher!)
//  - Caches für Segmentzerlegung pro Edge

import ISDPDataFetcher from "./ISDPDataFetcher.js";
import {buildOrderedSegments, projectIK_Ordered} from "./PathSegmentsOrdered.js";

/** @typedef {{x:number,y:number}} XY */

export default class GraphDataStore {
    /**
     * @param {ISDPDataFetcher} fetcher
     */
    constructor(fetcher) {
        if (!(fetcher instanceof ISDPDataFetcher)) {
            throw new Error("GraphDataStore: fetcher muss eine ISDPDataFetcher-Instanz sein.");
        }
        this.fetcher = fetcher;
        this._clear();
    }

    /** Lädt alle Daten über den Fetcher und spiegelt anschließend die Indizes. */
    async loadAll() {
        await this.fetcher.loadAll();
        this._rebuildIndices();
    }

    // ---------------- Public Selectors ----------------
    getNode(id) { return this.nodesById.get(id) || null; }
    getEdge(id) { return this.edgesById.get(id) || null; }
    getEdgesByNode(id) { return this.edgesByNodeId.get(id) || []; }

    getAllNodes() { return Array.from(this.nodesById.values()); }
    getAllEdges() { return Array.from(this.edgesById.values()); }

    getEdgeLabel(edgeId) {
        const e = this.getEdge(edgeId);
        return e?.name ?? e?.s_name ?? e?.isdmName ?? null;
    }

    // Geometrie (dedizit aus TrackEdge.geoLines/.geoArcs/.geoTransitions)
    getGeoLinesByEdge(edgeId) { return this.geoLinesByEdge.get(edgeId) || []; }
    getGeoArcsByEdge(edgeId) { return this.geoArcsByEdge.get(edgeId) || []; }
    getGeoTransitionsByEdge(edgeId) { return this.geoTransitionsByEdge.get(edgeId) || []; }

    // Roh-GeoElements (nur QA/Analyse, nicht fürs Zeichnen)
    getGeoElementsRawByEdge(edgeId) { return this.geoElementsByEdge.get(edgeId) || []; }

    // Inhalte auf Edge
    getBalisesByEdge(edgeId) { return this.balisesByEdge.get(edgeId) || []; }
    getSignalsByEdge(edgeId) { return this.signalsByEdge.get(edgeId) || []; }
    getTdsSectionsByEdge(edgeId) { return this.tdsSectionsByEdge.get(edgeId) || []; }
    getTdsComponentsByEdge(edgeId) { return this.tdsComponentsByEdge.get(edgeId) || []; }
    getSpeedByEdge(edgeId) { return this.speedByEdge.get(edgeId) || []; }
    getTrackPointsByEdge(edgeId) { return this.trackPointsByEdge.get(edgeId) || []; }
    getStationsByEdge(edgeId) { return this.stationsByEdge.get(edgeId) || []; }

    getEdgeLength(edgeId) { return this.edgesById.get(edgeId)?.lengthM ?? null; }

    /** Zusammenfassung aller Inhalte einer Edge (für Debug/Inspektion) */
    listEdgeContent(edgeId) {
        return {
            label: this.getEdgeLabel(edgeId),
            lines: this.getGeoLinesByEdge(edgeId).length,
            arcs: this.getGeoArcsByEdge(edgeId).length,
            transitions: this.getGeoTransitionsByEdge(edgeId).length,
            balises: this.getBalisesByEdge(edgeId).length,
            signals: this.getSignalsByEdge(edgeId).length,
            tdsSections: this.getTdsSectionsByEdge(edgeId).length,
            tdsComponents: this.getTdsComponentsByEdge(edgeId).length,
            speedSegs: this.getSpeedByEdge(edgeId).length,
            trackPoints: this.getTrackPointsByEdge(edgeId).length,
            stations: this.getStationsByEdge(edgeId).length,
            geoElementsRaw: this.getGeoElementsRawByEdge(edgeId).length,
        };
    }

    // ---------------- Projektion ----------------

    /**
     * IK (0..1 **oder** Meter) entlang der Pfadgeometrie -> XY
     * - Wenn 0..1 übergeben wird, wird intern mit der Gesamtlänge multipliziert.
     * - Wenn ein Wert >1 übergeben wird, wird er als Meter interpretiert.
     */
    projectIntrinsicToXY(edgeId, ikOrMeters) {
        const packed = buildOrderedSegments(this, edgeId);
        const total = (packed?.length ?? packed?.totalLen ?? 0);
        if (!(total > 0)) return null;
        const v = Number(ikOrMeters);
        if (!Number.isFinite(v)) return null;
        const meters = (v >= 0 && v <= 1) ? (v * total) : v;
        return projectIK_Ordered(this, edgeId, meters);
    }

    /** Polylinien (Lines/Transitions) + Arcs als Liniensegmente (gesampelt) */
    getEdgePolyline(edgeId, maxChord = 1) {
        const packed = this._getPathSegments(edgeId);
        const segments = packed?.segments || [];
        if (!segments.length) {
            // Fallback: direkte Linie A->B
            const e = this.edgesById.get(edgeId);
            if (!e) return [];
            const ends = this.getEdgeEndpoints(edgeId);
            if (ends?.A && ends?.B) return [ends.A, ends.B];
            return [];
        }
        /** @type {XY[]} */
        const pts = [];
        for (const seg of segments) {
            if (seg.kind === "line") {
                if (!pts.length) pts.push(seg.p1);
                pts.push(seg.p2);
            } else if (seg.kind === "arc") {
                const sampled = this._sampleArc(seg, maxChord);
                if (!pts.length && sampled.length) pts.push(sampled[0]);
                for (let i = 1; i < sampled.length; i++) pts.push(sampled[i]);
            }
        }
        return pts;
    }

    // ---------------- Internals ----------------

    _clear() {
        this.nodesById = new Map();
        this.edgesById = new Map();
        this.edgesByNodeId = new Map();

        this.geoLinesByEdge = new Map();
        this.geoArcsByEdge = new Map();
        this.geoTransitionsByEdge = new Map();
        this.geoElementsByEdge = new Map(); // neu: QA/Analyse

        this.balisesByEdge = new Map();
        this.signalsByEdge = new Map();
        this.tdsSectionsByEdge = new Map();
        this.tdsComponentsByEdge = new Map();
        this.speedByEdge = new Map();

        this.trackPointsByEdge = new Map();
        this.stationsByEdge = new Map();

        this._segmentsCache = new Map(); // edgeId -> {segments,length}
    }

    _rebuildIndices() {
        // Spiegeln (keine Deep-Copies) – die Maps kommen direkt aus dem Fetcher.
        this.nodesById = this.fetcher.nodesById;
        this.edgesById = this.fetcher.edgesById;
        this.edgesByNodeId = this.fetcher.edgesByNodeId;

        this.geoLinesByEdge = this.fetcher.geoLinesByEdge;
        this.geoArcsByEdge = this.fetcher.geoArcsByEdge;
        this.geoTransitionsByEdge = this.fetcher.geoTransitionsByEdge;
        this.geoElementsByEdge = this.fetcher.geoElementsByEdge;

        this.balisesByEdge = this.fetcher.balisesByEdge;
        this.signalsByEdge = this.fetcher.signalsByEdge;
        this.tdsSectionsByEdge = this.fetcher.tdsSectionsByEdge;
        this.tdsComponentsByEdge = this.fetcher.tdsComponentsByEdge;

        this.speedByEdge = this.fetcher.speedProfilesByEdge;

        this.trackPointsByEdge = this.fetcher.trackPointsByEdge;
        this.stationsByEdge = this.fetcher.stationsByEdge;

        this._segmentsCache.clear();
    }

    /** Liefert geordnete Pfad-Segmente (Lines/Transitions als Polyline, Arcs als Kreisbogen) und die Gesamtlänge */
    _getPathSegments(edgeId) {
        return buildOrderedSegments(this, edgeId);
    }

    // ---------------- Orientierung & Convenience ----------------

    /** IK vom RefNode in AB-IK umrechnen (Helper) */
    _toAB(edge, ikRef) {
        if (ikRef == null) return null;
        return edge && edge.refIsA === false ? (1 - ikRef) : ikRef;
    }

    /** Projektion aus Ref-IK (Convenience) */
    projectFromRef(edgeId, ikRef) {
        if (!Number.isFinite(ikRef)) return null;
        const edge = this.getEdge(edgeId);
        const ikAB = edge?.refIsA === false ? (1 - ikRef) : ikRef;
        return this.projectIntrinsicToXY(edgeId, ikAB);
    }

    /** Node-Koordinate holen (XY) */
    getNodeXY(id) {
        const n = this.getNode(id);
        return n?.geoCo ? this._normXY(n.geoCo) : null;
    }

    /** Endpunkte einer Edge holen (XY) */
    getEdgeEndpoints(edgeId) {
        const e = this.getEdge(edgeId);
        if (!e) return null;
        return {A: this.getNodeXY(e.nodeIdA), B: this.getNodeXY(e.nodeIdB)};
    }

    getEdgeSegmentsOrdered(edgeId) {
        const packed = this._getPathSegments(edgeId);
        const segs = packed?.segments || [];
        // stabile IDs pro Edge+Index
        return segs.map((s, i) => {
            if (s.kind === "line") {
                return {
                    id: `${edgeId}:${i}`,
                    edgeId,
                    kind: "line",
                    p1: {x: s.p1.x, y: s.p1.y},
                    p2: {x: s.p2.x, y: s.p2.y},
                    len: s.len
                };
            } else if (s.kind === "arc") {
                return {
                    id: `${edgeId}:${i}`,
                    edgeId,
                    kind: "arc",
                    p1: {x: s.p1.x, y: s.p1.y},
                    p2: {x: s.p2.x, y: s.p2.y},
                    center: {x: s.center.x, y: s.center.y},
                    r: s.r,
                    ang1: s.ang1,
                    ang2: s.ang2,
                    sweep: s.sweep,
                    len: s.len
                };
            }
            // sollte eigentlich nicht vorkommen (transitions sind als line aufgelöst)
            return {
                id: `${edgeId}:${i}`, edgeId, kind: "line",
                p1: {x: s.p1.x, y: s.p1.y}, p2: {x: s.p2.x, y: s.p2.y}, len: s.len
            };
        });
    }

    // ---------------- Geometrie-Utilities ----------------

    /** @param {XY} p1 @param {XY} p2 @param {number} t in [0,1] */
    _pointOnLine(p1, p2, t) { return {x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t}; }

    /** Punkt auf Bogen nach Bogenlänge s (0..seg.len) */
    _pointOnArc(seg, s) {
        const {center, r, ang1, sweep, len} = seg;
        const frac = len > 0 ? (s / len) : 0; // 0..1
        const dAng = sweep * frac; // vorzeichenbehaftet
        const ang = ang1 + dAng;
        return {x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang)};
    }

    /** chordal sampling eines Bogens */
    _sampleArc(seg, maxChord = 4) {
        const n = Math.max(2, Math.ceil(seg.len / Math.max(1e-6, maxChord)) + 1);
        const pts = [];
        for (let i = 0; i < n; i++) {
            const s = (i / (n - 1)) * seg.len;
            pts.push(this._pointOnArc(seg, s));
        }
        return pts;
    }

    _dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

    _normXY(p) {
        if (!p || typeof p !== "object") return null;
        const x = Number(p.x), y = Number(p.y);
        return (Number.isFinite(x) && Number.isFinite(y)) ? {x, y} : null;
    }
}

