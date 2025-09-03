// ISDPDataFetcher.js
// Lädt & normalisiert ISDP-Daten strikt nach dem bereitgestellten Schema (src/config/ISDP_SCHEMA.js)
// – dedizierte Geometriequellen pro TrackEdge: geoLines, geoArcs, geoTransitions
// – geoElements werden zusätzlich separat abgelegt (nur zur Analyse/QA)
// – Edge-embedded Elemente (tdsComponentsOnThisEdge, trainDetectionSections, signalsOnThisEdge, datapointsOnThisEdge) werden mit erfasst
// – globale Endpunkte (ETCSDataPoint, TdsSection, TdsComponent, Signalgroup) werden weiterhin geladen und dupliziert

import ISDP_SCHEMA from "../config/ISDP_SCHEMA.js"

const DEFAULT_URL = (ISDP_SCHEMA && ISDP_SCHEMA.baseUrlKey) ? ISDP_SCHEMA.baseUrlKey : "http://localhost:32308";

export default class ISDPDataFetcher {
    constructor(schema = ISDP_SCHEMA) {
        this.schema = schema;
        this.address = schema.baseUrlKey;

        // Klassen-Schlüssel, FQNs & Pfadmap
        this.classKeys = Object.keys(this.schema.classes);
        this.fqnByKey = new Map(this.classKeys.map(k => [k, this.schema.classes[k].fqn]));
        this.keyByFqn = new Map(this.classKeys.map(k => [this.schema.classes[k].fqn, k]));

        // Rohdaten-Container
        this.raw = {};
        for (const k of this.classKeys) this.raw[k] = [];

        // Normalisierte Sammlungen
        this._resetCollections();
    }

    setAddress(url) {
        this.address = String(url || DEFAULT_URL).replace(/\/$/, "");
        this._resetRaw();
        this._resetCollections();
    }

    async loadAll() {
        const tasks = this.classKeys.map(k => this.#fetchClassByKey(k));
        const results = await Promise.allSettled(tasks);
        const anyFulfilled = results.some(r => r.status === 'fulfilled');
        if (!anyFulfilled) {
            throw new Error(`ISDP Abruf fehlgeschlagen: Keine Antwort von ${this.address}`);
        }
        this.#normalizeAndIndex();
        // Nach der Normalisierung prüfen, ob brauchbare Daten vorhanden sind
        const edgesCount = this.edgesById?.size || 0;
        const nodesCount = this.nodesById?.size || 0;
        if (edgesCount === 0 && nodesCount === 0) {
            throw new Error(`ISDP Daten leer oder unbrauchbar von ${this.address}`);
        }
    }

    // ---------------- Lookups (wie gehabt) ----------------
    getGeoNode(id) { return this.nodesById.get(id) || null; }
    getTrackEdge(id) { return this.edgesById.get(id) || null; }
    getEdgesByNodeId(nodeId) { return this.edgesByNodeId.get(nodeId) || []; }

    getGeoLinesByEdge(edgeId) { return this.geoLinesByEdge.get(edgeId) || []; }
    getGeoArcsByEdge(edgeId) { return this.geoArcsByEdge.get(edgeId) || []; }
    getGeoTransitionsByEdge(edgeId) { return this.geoTransitionsByEdge.get(edgeId) || []; }
    getGeoElementsRawByEdge(edgeId) { return this.geoElementsByEdge.get(edgeId) || []; }

    getBalisesByEdge(edgeId) { return this.balisesByEdge.get(edgeId) || []; }
    getSignalsByEdge(edgeId) { return this.signalsByEdge.get(edgeId) || []; }
    getTdsSectionsByEdge(edgeId) { return this.tdsSectionsByEdge.get(edgeId) || []; }
    getTdsComponentsByEdge(edgeId) { return this.tdsComponentsByEdge.get(edgeId) || []; }
    getSpeedSegmentsByEdge(edgeId) { return this.speedProfilesByEdge.get(edgeId) || []; }
    getTrackPointsByEdge(edgeId) { return this.trackPointsByEdge.get(edgeId) || []; }
    getStationsByEdge(edgeId) { return this.stationsByEdge.get(edgeId) || []; }

    // ---------------- Internals ----------------
    _resetRaw() {
        this.raw = {};
        for (const k of this.classKeys) this.raw[k] = [];
    }

    _resetCollections() {
        // Normalisierte Sammlungen
        this.geoNodes = [];
        this.trackEdges = [];
        this.balises = [];
        this.signalGroups = [];
        this.signals = [];
        this.tdsSections = [];
        this.tdsComponents = [];
        this.speedSegments = [];

        // Indizes
        this.nodesById = new Map();
        this.edgesById = new Map();
        this.edgesByNodeId = new Map();

        this.geoLinesByEdge = new Map();
        this.geoArcsByEdge = new Map();
        this.geoTransitionsByEdge = new Map();
        this.geoElementsByEdge = new Map(); // NEU: nur Analyse/QA

        this.balisesById = new Map();
        this.balisesByEdge = new Map();

        this.signalgroupsById = new Map();
        this.signalsById = new Map();
        this.signalsByEdge = new Map();

        this.tdsSectionsById = new Map();
        this.tdsSectionsByEdge = new Map();

        this.tdsComponentsById = new Map();
        this.tdsComponentsByEdge = new Map();

        this.speedProfilesByEdge = new Map();

        this.trackPointsByEdge = new Map();
        this.stationsByEdge = new Map();
    }

    async #fetchClassByKey(key) {
        const def = this.schema.classes[key];
        const fqn = def.fqn;
        const url = `${this.address}/${fqn}`;
        const json = await this.#getJSON(url);
        const arr = this.#asArrayFromPath(json, def.path);
        this.raw[key] = arr;
    }

    async #getJSON(url) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20000);
        try {
            const res = await fetch(url, {signal: ctrl.signal});
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error(`Antwort ist kein JSON: ${text.slice(0, 200)}`);
            }
        } finally {
            clearTimeout(t);
        }
    }

    #asArrayFromPath(payload, path) {
        if (payload == null) return [];
        const v = this.#pickPath(payload, path);
        if (Array.isArray(v)) return v;
        if (v == null) {
            // Fallback: erstes Array im Objekt suchen
            if (typeof payload === 'object') {
                for (const [, val] of Object.entries(payload)) if (Array.isArray(val)) return val;
            }
            return [];
        }
        return Array.isArray(v) ? v : [v];
    }

    // ---------------- Normalisierung & Indizes ----------------
    #normalizeAndIndex() {
        this._resetCollections();

        // 1) GeoNodes
        for (const raw of this.raw.GeoNode) {
            const n = this.#normalizeGeoNodeBySchema(raw);
            if (!n) continue;
            this.geoNodes.push(n);
            if (n.id) this.nodesById.set(n.id, n);
        }

        // 2) TrackEdges inkl. Geometrie & eingebetteten Elementen
        const teCfg = this.schema.classes.TrackEdge;
        for (const raw of this.raw.TrackEdge) {
            const e = this.#normalizeTrackEdgeBySchema(raw, teCfg);
            if (!e) continue;

            this.trackEdges.push(e);
            if (e.id) this.edgesById.set(e.id, e);

            if (e.nodeIdA) this.#pushIndexArray(this.edgesByNodeId, e.nodeIdA, e.id, true);
            if (e.nodeIdB) this.#pushIndexArray(this.edgesByNodeId, e.nodeIdB, e.id, true);

            // Geometrie indizieren (nur dedizierte Quellen)
            for (const gl of e.geoLines) this.#pushIndexArray(this.geoLinesByEdge, e.id, gl, true);
            for (const ga of e.geoArcs) this.#pushIndexArray(this.geoArcsByEdge, e.id, ga, true);
            for (const gt of e.geoTransitions) this.#pushIndexArray(this.geoTransitionsByEdge, e.id, gt, true);

            // geoElements (roh) separat halten
            if (e.geoElementsRaw?.length) for (const ge of e.geoElementsRaw) this.#pushIndexArray(this.geoElementsByEdge, e.id, ge, true);

            // Speed (falls vorhanden; schema-unabhängig tolerant)
            const segs = this.#extractSpeedSegments(raw, e.lengthM, e.refIsA);
            if (segs.length) {
                this.speedSegments.push(...segs);
                this.speedProfilesByEdge.set(e.id, segs);
            }

            // Eingebettete Elemente nach Schema
            this.#ingestEmbeddedOnEdge(raw, e, teCfg);
        }

        // 3) Globale Endpunkte (gemäß Schema-Klassen)
        // 3.1) ETCSDataPoint
        if (this.raw.ETCSDataPoint) {
            const cfg = this.schema.classes.ETCSDataPoint;
            for (const raw of this.raw.ETCSDataPoint) {
                const b = this.#normalizeBaliseBySchema(raw, cfg);
                if (!b) continue;
                const edge = b.netElementRef ? this.edgesById.get(b.netElementRef) : null;
                b.intrinsicAB = this.#toABIntrinsic(edge, b.intrinsicRef ?? b.intrinsicCoord ?? null);
                if (b.id && !this.balisesById.has(b.id)) {
                    this.balises.push(b);
                    this.balisesById.set(b.id, b);
                }
                if (b.netElementRef) this.#pushIndexArray(this.balisesByEdge, b.netElementRef, b, true);
            }
        }

        // 3.2) TdsSection
        if (this.raw.TdsSection) {
            const cfg = this.schema.classes.TdsSection;
            for (const raw of this.raw.TdsSection) {
                const ts = this.#normalizeTdsSectionBySchema(raw, cfg);
                if (!ts) continue;
                const edge = ts.netElementRef ? this.edgesById.get(ts.netElementRef) : null;
                const sRef = ts.startIntrinsicRef ?? ts.startIntrinsic ?? null;
                const tRef = ts.endIntrinsicRef ?? ts.endIntrinsic ?? null;
                let sAB = sRef, tAB = tRef;
                if (edge && edge.refIsA === false) {
                    sAB = (tRef != null) ? (1 - tRef) : null;
                    tAB = (sRef != null) ? (1 - sRef) : null;
                }
                if (sAB != null && tAB != null && sAB > tAB) {
                    const tmp = sAB;
                    sAB = tAB;
                    tAB = tmp;
                }
                ts.startIntrinsicAB = sAB;
                ts.endIntrinsicAB = tAB;
                if (ts.id && !this.tdsSectionsById.has(ts.id)) this.tdsSectionsById.set(ts.id, ts);
                this.tdsSections.push(ts);
                if (ts.netElementRef) this.#pushIndexArray(this.tdsSectionsByEdge, ts.netElementRef, ts, true);
            }
        }

        // 3.3) TdsComponent
        if (this.raw.TdsComponent) {
            const cfg = this.schema.classes.TdsComponent;
            for (const raw of this.raw.TdsComponent) {
                const tc = this.#normalizeTdsComponentBySchema(raw, cfg);
                if (!tc) continue;
                const edge = tc.netElementRef ? this.edgesById.get(tc.netElementRef) : null;
                tc.intrinsicAB = this.#toABIntrinsic(edge, tc.intrinsicRef ?? tc.intrinsicCoord ?? null);
                if (tc.id && !this.tdsComponentsById.has(tc.id)) this.tdsComponentsById.set(tc.id, tc);
                this.tdsComponents.push(tc);
                if (tc.netElementRef) this.#pushIndexArray(this.tdsComponentsByEdge, tc.netElementRef, tc, true);
            }
        }

        // 3.4) Signalgroup (+ flatten signals if present)
        if (this.raw.Signalgroup) {
            const cfg = this.schema.classes.Signalgroup;
            for (const raw of this.raw.Signalgroup) {
                const sg = this.#normalizeSignalGroupBySchema(raw, cfg);
                if (!sg) continue;
                this.signalGroups.push(sg);
                if (sg.id) this.signalgroupsById.set(sg.id, sg);
                if (Array.isArray(sg.signals)) {
                    for (const s of sg.signals) {
                        const edge = s.netElementRef ? this.edgesById.get(s.netElementRef) : null;
                        const ikRef = (s.intrinsicRef ?? s.intrinsicCoord ?? null);
                        s.intrinsicAB = this.#toABIntrinsic(edge, ikRef);
                        if (s.id && !this.signalsById.has(s.id)) this.signalsById.set(s.id, s);
                        this.signals.push(s);
                        if (s.netElementRef) this.#pushIndexArray(this.signalsByEdge, s.netElementRef, s, true);
                    }
                }
            }
        }
    }

    // ---- Normalizer: Schema-gesteuert ----
    #normalizeGeoNodeBySchema(raw) {
        const cfg = this.schema.classes.GeoNode.fields;
        const id = this.#pickPath(raw, cfg.id);
        const x = this.#safeNumber(this.#pickPath(raw, cfg.x), null);
        const y = this.#safeNumber(this.#pickPath(raw, cfg.y), null);
        const name = this.#pickPath(raw, cfg.name) ?? null;
        const geoCo = (x != null && y != null) ? {x, y} : null;
        return (id ? {id, geoCo, s_name: name, raw} : null);
    }

    #normalizeTrackEdgeBySchema(raw, teCfg) {
        const f = teCfg.fields;
        const id = this.#pickPath(raw, f.id);
        if (!id) return null;
        const nodeIdA = this.#pickPath(raw, f.nodeIdA);
        const nodeIdB = this.#pickPath(raw, f.nodeIdB);
        const refNodeId = this.#pickPath(raw, f.refNodeId);
        const lengthM = this.#safeNumber(this.#pickPath(raw, f.lengthM), null);
        const name = this.#pickPath(raw, f.name) ?? null;
        const isdmName = this.#pickPath(raw, f.isdmName) ?? null;
        const refIsA = refNodeId ? (refNodeId === nodeIdA) : true;

        // Geometrie ausschließlich aus dedizierten Feldern
        const linesRaw = this.#asArrayFromPath(raw, teCfg.elements.lines);
        const arcsRaw = this.#asArrayFromPath(raw, teCfg.elements.arcs);
        const transRaw = this.#asArrayFromPath(raw, teCfg.elements.transitions);

        const geoLines = linesRaw.map(g => this.#normalizeGeoLine(g)).filter(Boolean);
        const geoArcs = arcsRaw.map(g => this.#normalizeGeoArc(g)).filter(Boolean);
        const geoTransitions = transRaw.map(g => this.#normalizeGeoTransition(g)).filter(Boolean);

        // geoElements (roh) zusätzlich ablegen (Analyse/QA)
        const geoElementsRaw = this.#asArrayFromPath(raw, teCfg.elements.elements)
            .map(g => this.#normalizeGeoElementLoose(g)).filter(Boolean);

        // Edge-lokale Listen (werden später in #ingestEmbeddedOnEdge verarbeitet)
        return {
            id,
            nodeIdA,
            nodeIdB,
            refNodeId,
            refIsA,
            lengthM,
            name,
            isdmName,
            geoLines,
            geoArcs,
            geoTransitions,
            geoElementsRaw,
            raw
        };
    }

    #normalizeGeoLine(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pick(raw, 'id', null);
        const A = this.#normCoord(this.#pick(raw, 'A', this.#pick(raw, 'a', null)));
        const B = this.#normCoord(this.#pick(raw, 'B', this.#pick(raw, 'b', null)));
        let points = [];
        if (A && B) points = [A, B];
        else {
            const pts = this.#pick(raw, 'pointList', this.#pick(raw, 'points', this.#pick(raw, 'vertices', [])));
            points = Array.isArray(pts) ? pts.map(p => this.#normCoord(p)).filter(Boolean) : [];
        }
        return {id, type: 'Line', points, center: null, radius: null, raw};
    }

    #normalizeGeoArc(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pick(raw, 'id', null);
        const A = this.#normCoord(this.#pick(raw, 'A', this.#pick(raw, 'a', null)));
        const B = this.#normCoord(this.#pick(raw, 'B', this.#pick(raw, 'b', null)));
        const points = (A && B) ? [A, B] : [];
        const center = this.#normCoord(this.#pick(raw, 'center', this.#pick(raw, 'centerPoint', null)));
        const rVal = this.#pick(raw, 'radius_in_meter', this.#pick(raw, 'radius', null));
        const radius = this.#safeNumber(this.#pick(rVal, 'bdValue', rVal), null);
        return {id, type: 'Arc', points, center, radius, raw};
    }

    #normalizeGeoTransition(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pick(raw, 'id', null);
        const pts = this.#pick(raw, 'pointList', this.#pick(raw, 'points', this.#pick(raw, 'vertices', [])));
        const points = Array.isArray(pts) ? pts.map(p => this.#normCoord(p)).filter(Boolean) : [];
        return {id, type: 'Transition', points, center: null, radius: null, raw};
    }

    #normalizeGeoElementLoose(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pick(raw, 'id', null);
        const ptsRaw = this.#pick(raw, 'points', this.#pick(raw, 'pointList', this.#pick(raw, 'vertices', null)));
        const points = Array.isArray(ptsRaw) ? ptsRaw.map(p => this.#normCoord(p)).filter(Boolean) : [];
        const hasR = this.#safeNumber(this.#pick(raw, 'radius_in_meter', this.#pick(raw, 'radius', null)), null);
        let kind = this.#pick(raw, 'type', null);
        if (!kind) kind = (hasR != null) ? 'ArcLike' : (points.length >= 2 ? 'LineLike' : 'Unknown');
        return {id, kind, points, raw};
    }

    #normalizeBaliseBySchema(raw, cfg) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pickPath(raw, cfg.fields.id);
        const name = this.#pickPath(raw, cfg.fields.name) ?? null;
        // Referenz Edge (Schema) → Fallback auf location.associatedNetElement[0]
        let netElementRef = this.#pickPath(raw, cfg.fields.refTrackEdge) ?? null;
        let intrinsicRef = this.#safeNumber(this.#pickPath(raw, cfg.fields.intrinsicCoord), null);
        if (!netElementRef) {
            const loc = this.#pick(raw, 'location', null);
            const ane = Array.isArray(this.#pick(loc, 'associatedNetElement', null)) ? this.#pick(loc, 'associatedNetElement', null)[0] : null;
            if (ane) {
                netElementRef = this.#pick(ane, 'netElementRef', null) || netElementRef;
                intrinsicRef = intrinsicRef ?? this.#safeNumber(this.#pick(ane, 'intrinsicCoord', this.#pick(ane, 'intrinsicCoordBegin', null)), null);
            }
        }
        const applicationDirection = this.#pickPath(raw, cfg.fields.applicationDirection) ?? null;
        return {id, name, netElementRef, intrinsicRef, applicationDirection, raw};
    }

    #normalizeTdsSectionBySchema(raw, cfg) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pickPath(raw, cfg.fields.id);
        const label = this.#pickPath(raw, cfg.fields.label) ?? null;
        const netElementRef = this.#pickPath(raw, cfg.fields.refTrackEdge) ?? null;
        const startIntrinsicRef = this.#safeNumber(this.#pickPath(raw, cfg.fields.geometricCoordinateBegin), null);
        const endIntrinsicRef = this.#safeNumber(this.#pickPath(raw, cfg.fields.geometricCoordinateEnd), null);
        const posBegin = this.#safeNumber(this.#pickPath(raw, cfg.fields.posBegin), null);
        const posEnd = this.#safeNumber(this.#pickPath(raw, cfg.fields.posEnd), null);
        return {id, label, netElementRef, startIntrinsicRef, endIntrinsicRef, posBegin, posEnd, raw};
    }

    #normalizeTdsComponentBySchema(raw, cfg) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pickPath(raw, cfg.fields.id);
        const name = this.#pickPath(raw, cfg.fields.name) ?? null;
        const componentType = this.#pickPath(raw, cfg.fields.type) ?? null;
        const netElementRef = this.#pickPath(raw, cfg.fields.refTrackEdge) ?? null;
        const intrinsicRef = this.#safeNumber(this.#pickPath(raw, cfg.fields.intrinsicCoord), null);
        const applicationDirection = this.#pickPath(raw, cfg.fields.applicationDirection) ?? null;
        const pos = this.#safeNumber(this.#pickPath(raw, cfg.fields.pos), null);
        return {id, name, componentType, netElementRef, intrinsicRef, applicationDirection, pos, raw};
    }

    #normalizeSignalGroupBySchema(raw, cfg) {
        if (!raw || typeof raw !== 'object') return null;
        const id = this.#pickPath(raw, cfg.fields.id);
        const name = this.#pickPath(raw, cfg.fields.name) ?? null;
        // Viele ISDP-Dumps liefern Signale als separate Liste; hier belassen wir Group ohne Flatten,
        // die Flatten-Logik übernehmen wir in #normalizeAndIndex() sobald wir die Einzel-Signale kennen.
        // Optional: wenn im Group-Objekt ein "signals"-Array steckt, versuchen wir dort die Minimalfelder zu lesen
        const loc = this.#pick(raw, 'location', null);
        const netElementRef = this.#pick(loc, 'netElementRef', null);
        const intrinsicCoord = this.#safeNumber(this.#pick(loc, 'intrinsicCoord', null), null);
        // Dummy-Signal, falls Gruppe selbst lokalisierbar ist (optional)
        const signals = [];
        return {id, name, netElementRef, intrinsicCoord, signals, raw};
    }

    // ---- Edge-embedded ingest ----
    #ingestEmbeddedOnEdge(rawEdge, e, teCfg) {
        // TDS Sections
        const tSec = this.#asArrayFromPath(rawEdge, teCfg.elements.tdsSections);
        for (const tRaw of tSec) {
            const ts = this.#normalizeTdsSectionBySchema(tRaw, this.schema.classes.TdsSection);
            if (!ts) continue;
            if (!ts.netElementRef) ts.netElementRef = e.id;
            const sRef = ts.startIntrinsicRef ?? null;
            const tRef = ts.endIntrinsicRef ?? null;
            let sAB = sRef, tAB = tRef;
            if (e.refIsA === false) {
                sAB = (tRef != null) ? (1 - tRef) : null;
                tAB = (sRef != null) ? (1 - sRef) : null;
            }
            if (sAB != null && tAB != null && sAB > tAB) {
                const tmp = sAB;
                sAB = tAB;
                tAB = tmp;
            }
            ts.startIntrinsicAB = sAB;
            ts.endIntrinsicAB = tAB;
            if (ts.id && !this.tdsSectionsById.has(ts.id)) this.tdsSectionsById.set(ts.id, ts);
            this.tdsSections.push(ts);
            this.#pushIndexArray(this.tdsSectionsByEdge, e.id, ts, true);
        }

        // TDS Components
        const tComp = this.#asArrayFromPath(rawEdge, teCfg.elements.tdsComponents);
        for (const cRaw of tComp) {
            const tc = this.#normalizeTdsComponentBySchema(cRaw, this.schema.classes.TdsComponent);
            if (!tc) continue;
            if (!tc.netElementRef) tc.netElementRef = e.id;
            tc.intrinsicAB = this.#toABIntrinsic(e, tc.intrinsicRef ?? tc.intrinsicCoord ?? null);
            if (tc.id && !this.tdsComponentsById.has(tc.id)) this.tdsComponentsById.set(tc.id, tc);
            this.tdsComponents.push(tc);
            this.#pushIndexArray(this.tdsComponentsByEdge, e.id, tc, true);
        }

        // Signals on edge (optional)
        const sigs = this.#asArrayFromPath(rawEdge, teCfg.elements.signals);
        for (const sRaw of sigs) {
            // Minimal-Signal: id, netElementRef, intrinsicCoord
            const id = this.#pick(sRaw, 'id', null);
            let netElementRef = this.#pickPath(sRaw, 'location.netElementRef') ?? null;
            let intrinsicRef = this.#safeNumber(this.#pickPath(sRaw, 'location.intrinsicCoord'), null);
            if (!netElementRef) netElementRef = e.id;
            const s = {id, netElementRef, intrinsicRef, raw: sRaw};
            s.intrinsicAB = this.#toABIntrinsic(e, intrinsicRef);
            if (s.id && !this.signalsById.has(s.id)) this.signalsById.set(s.id, s);
            this.signals.push(s);
            this.#pushIndexArray(this.signalsByEdge, e.id, s, true);
        }

        // Balises on edge (optional)
        const bals = this.#asArrayFromPath(rawEdge, teCfg.elements.balises);
        for (const bRaw of bals) {
            const b = this.#normalizeBaliseBySchema(bRaw, this.schema.classes.ETCSDataPoint);
            if (!b) continue;
            if (!b.netElementRef) b.netElementRef = e.id;
            b.intrinsicAB = this.#toABIntrinsic(e, b.intrinsicRef ?? b.intrinsicCoord ?? null);
            if (b.id && !this.balisesById.has(b.id)) this.balisesById.set(b.id, b);
            this.balises.push(b);
            this.#pushIndexArray(this.balisesByEdge, e.id, b, true);
        }

        // trackPoints (roh)
        const tps = this.#asArrayFromPath(rawEdge, teCfg.elements.trackPoints);
        for (const tp of tps) this.#pushIndexArray(this.trackPointsByEdge, e.id, tp, true);

        // stations (roh)
        const sts = this.#asArrayFromPath(rawEdge, teCfg.elements.stations);
        for (const st of sts) this.#pushIndexArray(this.stationsByEdge, e.id, st, true);
    }

    // ---------------- Helpers ----------------
    #pick(obj, k, fallback = null) {
        if (!obj || typeof obj !== 'object') return fallback;
        return (k in obj) ? obj[k] : fallback;
    }

    #pushIndexArray(map, key, value, dedupe = false) {
        if (!key) return;
        const arr = map.get(key);
        if (!arr) {
            map.set(key, [value]);
            return;
        }
        if (!dedupe) {
            arr.push(value);
            return;
        }
        const vid = (value && typeof value === 'object') ? (value.id ?? null) : value;
        if (vid == null || !arr.some(v => (v && typeof v === 'object') ? (v.id === vid) : (v === value))) {
            arr.push(value);
        }
    }

    #safeNumber(v, fallback = null) {
        const n = (v && typeof v === 'object' && 'bdValue' in v) ? Number(v.bdValue) : Number(v);
        return Number.isFinite(n) ? n : fallback;
    }

    #normCoord(p) {
        if (!p || typeof p !== 'object') return null;
        const x = this.#safeNumber(p.x, null);
        const y = this.#safeNumber(p.y, null);
        return (x != null && y != null) ? {x, y} : null;
    }

    // Pfad-Leser: unterstützt Alternativen (a|b|c) und Array-Indices (names[0].name)
    #pickPath(obj, path) {
        if (!path || !obj) return undefined;
        const alts = String(path).split('|').map(s => s.trim());
        for (const p of alts) {
            const val = this.#getByPath(obj, p);
            if (val !== undefined && val !== null) return val;
        }
        return undefined;
    }

    #getByPath(obj, path) {
        if (!obj || !path) return undefined;
        let cur = obj;
        const parts = String(path).split('.');
        for (let part of parts) {
            if (cur == null) return undefined;
            const m = part.match(/^(.*?)\[(\d+)\]$/);
            if (m) {
                const key = m[1];
                const idx = Number(m[2]);
                cur = cur[key];
                if (!Array.isArray(cur)) return undefined;
                cur = cur[idx];
            } else {
                cur = cur[part];
            }
        }
        return cur;
    }

    // Ref-IK (von refNode aus) -> AB-IK (immer A→B)
    #toABIntrinsic(edge, ikRef) {
        if (ikRef == null) return null;
        return (edge && edge.refIsA === false) ? (1 - ikRef) : ikRef;
    }

    // Speed tolerant (Schema enthält derzeit keinen eigenen Pfad dafür)
    #extractSpeedSegments(rawEdge, lengthM, refIsA = true) {
        const out = [];
        if (!rawEdge || typeof rawEdge !== 'object') return out;

        const ssp = this.#pick(
            rawEdge, 'staticSpeedProfile',
            this.#pick(rawEdge, 'speedProfile', this.#pick(rawEdge, 'speedProfiles', []))
        );
        const items = Array.isArray(ssp) ? ssp : [];

        for (const seg of items) {
            let startPosM = this.#safeNumber(seg.startPosM ?? seg.startPos ?? seg.start ?? this.#pick(seg, 'posBegin', null), null);
            let endPosM = this.#safeNumber(seg.endPosM ?? seg.endPos ?? seg.end ?? this.#pick(seg, 'posEnd', null), null);

            const loc = this.#pick(seg, 'location', null);
            const aneList = Array.isArray(this.#pick(loc, 'associatedNetElement', null))
                ? this.#pick(loc, 'associatedNetElement', null)
                : Array.isArray(this.#pick(seg, 'associatedNetElement', null))
                    ? this.#pick(seg, 'associatedNetElement', null)
                    : null;
            const ane = Array.isArray(aneList) && aneList.length ? aneList[0] : null;

            let si = this.#safeNumber(this.#pick(ane, 'intrinsicCoordBegin', this.#pick(seg, 'startIntrinsic', null)), null);
            let ei = this.#safeNumber(this.#pick(ane, 'intrinsicCoordEnd', this.#pick(seg, 'endIntrinsic', null)), null);

            if (!Number.isFinite(startPosM)) startPosM = this.#safeNumber(this.#pick(ane, 'posBegin', null), null);
            if (!Number.isFinite(endPosM)) endPosM = this.#safeNumber(this.#pick(ane, 'posEnd', null), null);

            if (!Number.isFinite(startPosM) && Number.isFinite(lengthM) && Number.isFinite(si)) startPosM = si * lengthM;
            if (!Number.isFinite(endPosM) && Number.isFinite(lengthM) && Number.isFinite(ei)) endPosM = ei * lengthM;

            if (Number.isFinite(lengthM)) {
                if (!Number.isFinite(si) && Number.isFinite(startPosM)) si = Math.max(0, Math.min(1, startPosM / lengthM));
                if (!Number.isFinite(ei) && Number.isFinite(endPosM)) ei = Math.max(0, Math.min(1, endPosM / lengthM));
            }

            let sAB = si, eAB = ei;
            if (refIsA === false) {
                sAB = (ei != null) ? (1 - ei) : null;
                eAB = (si != null) ? (1 - si) : null;
            }
            if (sAB != null && eAB != null && sAB > eAB) {
                const t = sAB;
                sAB = eAB;
                eAB = t;
            }

            out.push({
                startPosM,
                endPosM,
                speedKmh: this.#safeNumber(seg.speedKmh ?? seg.speed ?? seg.kmh, null),
                startIntrinsic: sAB,
                endIntrinsic: eAB,
                raw: seg
            });
        }
        return out;
    }
}
