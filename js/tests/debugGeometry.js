// v2.0.0/js/tests/debugGeometry.js
// QA/Debug-Suite für Geometrieprobleme (Order/Continuity/Arc-Direction)

import GraphDataStore from "../GraphDataStore.js";

const EPS = 1e-3;

const dist = (a, b) => Math.hypot((b.x - a.x), (b.y - a.y));
const fmt = (p) => `(${(+p.x).toFixed(3)}, ${(+p.y).toFixed(3)})`;
const vsub = (a, b) => ({x: a.x - b.x, y: a.y - b.y});
const vlen = (v) => Math.hypot(v.x, v.y);
const vnorm = (v) => {
    const L = vlen(v) || 1;
    return {x: v.x / L, y: v.y / L};
};
const vdot = (a, b) => a.x * b.x + a.y * b.y;
const vperpL = (v) => ({x: -v.y, y: v.x}); // 90° links

/** Hole private Segmente (derzeitige Implementierung) */
function segmentsFromStore(store, edgeId) {
    // ja, ist "privat"; für QA ok
    const packed = store._getPathSegments(edgeId);
    return packed?.segments || [];
}

/** Baue Segmente in ORIGINAL-REIHENFOLGE aus geoElementsRaw (so wie geliefert) */
function segmentsFromRawOrder(store, edgeId) {
    /** @type {Array<{kind:"line"|"arc", p1:any,p2:any, len:number, center?, r?, ang1?,ang2?,sweep?}>} */
    const segs = [];
    const raw = store.getGeoElementsRawByEdge(edgeId);
    const Ls = store.getGeoLinesByEdge(edgeId);
    const As = store.getGeoArcsByEdge(edgeId);
    const Ts = store.getGeoTransitionsByEdge(edgeId);

    const norm = (p) => (p && Number.isFinite(+p.x) && Number.isFinite(+p.y)) ? {x: +p.x, y: +p.y} : null;
    const pushPolyline = (pts) => {
        if (!Array.isArray(pts) || pts.length < 2) return;
        for (let i = 0; i < pts.length - 1; i++) {
            const p1 = norm(pts[i]), p2 = norm(pts[i + 1]);
            if (!p1 || !p2) continue;
            const len = dist(p1, p2);
            if (len > 0) segs.push({kind: "line", p1, p2, len});
        }
    };

    for (const r of raw) {
        const id = r?.id ?? null;
        const L = id && Ls.find(e => e.id === id);
        if (L) {
            pushPolyline(L.points);
            continue;
        }

        const T = id && Ts.find(e => e.id === id);
        if (T) {
            pushPolyline(T.points);
            continue;
        }

        const A = id && As.find(e => e.id === id);
        if (A) {
            const pts = Array.isArray(A.points) ? A.points.map(norm).filter(Boolean) : [];
            const haveAB = pts.length >= 2;
            const rVal = Number.isFinite(A.radius) ? Math.abs(A.radius) : null;
            const sgn = Number.isFinite(A.radius) ? (A.radius >= 0 ? 1 : -1) : 1;
            let center = A.center && norm(A.center);
            if (!haveAB) { /* kein AB -> ignoriere / fallback */
                pushPolyline(pts);
                continue;
            }
            if (!rVal) {
                pushPolyline(pts);
                continue;
            }
            if (!center) {
                center = _computeArcCenterFromABR(pts[0], pts[pts.length - 1], rVal, sgn);
            }
            if (!center) {
                pushPolyline(pts);
                continue;
            }

            const {ang1, ang2, sweep, arcLen} = _arcAngles(center, pts[0], pts[pts.length - 1], rVal, sgn);
            segs.push({
                kind: "arc",
                p1: pts[0],
                p2: pts[pts.length - 1],
                center,
                r: rVal,
                ang1,
                ang2,
                sweep,
                len: arcLen
            });
            continue;
        }

        // echtes Raw-Fallback (wir kennen den Typ nicht sicher)
        pushPolyline(r.points);
    }

    // am Ende simple A->B Orientierung wie im Store
    _orientSegmentsAB_likeStore(store, edgeId, segs);
    return segs;
}

// ---- Kopien der Store-Helfer (nur für QA, nicht produktiv einbinden)
function _arcAngles(c, p1, p2, r, sgn) {
    const ang1 = Math.atan2(p1.y - c.y, p1.x - c.x);
    let ang2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    let sweep = ang2 - ang1;
    if (sgn > 0) {
        while (sweep < 0) sweep += 2 * Math.PI;
    } else {
        while (sweep > 0) sweep -= 2 * Math.PI;
    }
    const arcLen = Math.abs(sweep) * r;
    return {ang1, ang2, sweep, arcLen};
}

function _computeArcCenterFromABR(p1, p2, r, sgn) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y, d = Math.hypot(dx, dy);
    if (!(d > 0)) return null;
    const mid = {x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2};
    const h2 = r * r - (d * d) / 4;
    if (h2 < 0) return null;
    const h = Math.sqrt(h2);
    const ux = -dy / d, uy = dx / d;
    return {x: mid.x + sgn * h * ux, y: mid.y + sgn * h * uy};
}

function _orientSegmentsAB_likeStore(store, edgeId, segments) {
    const e = store.getEdge(edgeId);
    if (!e || !segments.length) return;
    const A = store.getNodeXY(e.nodeIdA), B = store.getNodeXY(e.nodeIdB);
    if (!A || !B) return;
    const start = segments[0].p1;
    const dA = dist(start, A), dB = dist(start, B);
    if (dB + 1e-6 < dA) {
        segments.reverse();
        for (const s of segments) {
            const tmp = s.p1;
            s.p1 = s.p2;
            s.p2 = tmp;
            if (s.kind === "arc") {
                const a1 = s.ang1;
                s.ang1 = s.ang2;
                s.ang2 = a1;
                s.sweep = -s.sweep;
            }
        }
    }
}

/** Kontinuität/Gaps + Arc-Prüfungen */
function analyzeSegments(store, edgeId, segs) {
    const issues = [];
    const e = store.getEdge(edgeId);
    const ends = store.getEdgeEndpoints(edgeId);

    // Start-/End-Nahheit
    if (ends?.A && segs[0]) {
        const d = dist(ends.A, segs[0].p1);
        if (d > 1e-2) issues.push({
            type: "start_miss",
            value: d,
            msg: `Start ist ${d.toFixed(3)} m von NodeA entfernt (${fmt(ends.A)} -> ${fmt(segs[0].p1)})`
        });
    }
    if (ends?.B && segs.length) {
        const d = dist(ends.B, segs[segs.length - 1].p2);
        if (d > 1e-2) issues.push({
            type: "end_miss",
            value: d,
            msg: `Ende ist ${d.toFixed(3)} m von NodeB entfernt (${fmt(ends.B)} -> ${fmt(segs[segs.length - 1].p2)})`
        });
    }

    // Segment-Gaps + Arc-Heuristiken
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];

        // lange Bögen (> π) markieren – meist falsch
        if (s.kind === "arc" && Math.abs(s.sweep) > Math.PI + 1e-6) {
            issues.push({
                type: "arc_long",
                idx: i,
                value: s.sweep,
                msg: `Arc[${i}] Sweep=${(s.sweep * 180 / Math.PI).toFixed(1)}° (>180°)`
            });
        }

        if (i > 0) {
            const pPrev = segs[i - 1].p2;
            const gap = dist(pPrev, s.p1);
            if (gap > 1e-2) {
                issues.push({
                    type: "gap",
                    idx: i,
                    value: gap,
                    msg: `Gap[${i}] = ${gap.toFixed(3)} m: ${fmt(pPrev)} -> ${fmt(s.p1)}`
                });
            }

            // Tangentiale Stetigkeit grob prüfen (nur Heuristik)
            const vIn = vnorm(vsub(segs[i - 1].p2, segs[i - 1].p1));
            let vOut;
            if (s.kind === "line") vOut = vnorm(vsub(s.p2, s.p1));
            else {
                // Tangente am Bogen-Start: 90° links/rechts von Radius, Richtung nach sweep
                const rvec = vnorm(vsub(s.p1, s.center));
                const t = vperpL(rvec);
                vOut = (s.sweep >= 0) ? t : {x: -t.x, y: -t.y};
            }
            const cos = vdot(vIn, vOut);  // -1..1
            if (cos < -0.5) {
                issues.push({
                    type: "tangent_flip",
                    idx: i,
                    value: cos,
                    msg: `Starker Richtungsbruch an Segment[${i}] (cos=${cos.toFixed(3)})`
                });
            }
        }
    }

    return issues;
}

/** Vergleiche Store-Segmente vs. Raw-Order-Segmente */
export function compareStoreVsRaw(store, edgeId) {
    const segStore = segmentsFromStore(store, edgeId);
    const segRaw = segmentsFromRawOrder(store, edgeId);

    const issuesStore = analyzeSegments(store, edgeId, segStore);
    const issuesRaw = analyzeSegments(store, edgeId, segRaw);

    console.group(`Edge ${edgeId}`);
    console.log("Store-Segmente:", segStore);
    console.log("RawOrder-Segmente:", segRaw);
    console.warn("Issues(Store):", issuesStore);
    console.warn("Issues(Raw):", issuesRaw);
    console.groupEnd();

    return {segStore, segRaw, issuesStore, issuesRaw};
}

/** Scanne alle Edges und liste die verdächtigsten Fälle */
export function scanAllEdges(store, {limit = 30} = {}) {
    const out = [];
    for (const e of store.getAllEdges()) {
        const segs = segmentsFromStore(store, e.id);
        const issues = analyzeSegments(store, e.id, segs);
        const worst = Math.max(0, ...issues.map(i => i.type === "gap" ? i.value : 0));
        out.push({edgeId: e.id, nSeg: segs.length, nIssues: issues.length, worstGap: worst, issues});
    }
    out.sort((a, b) => (b.worstGap - a.worstGap) || (b.nIssues - a.nIssues));
    console.table(out.slice(0, limit).map(r => ({
        edge: r.edgeId,
        segs: r.nSeg,
        issues: r.nIssues,
        worstGap: +r.worstGap.toFixed(3)
    })));
    return out;
}
