// GraphDataStore – Ordered PathSegments + Arc-Fix (drop‑in)
// ----------------------------------------------------------------------------
// Dieses Modul liefert eine **geordnete** Segmentkette je Edge basierend auf der
// Roh-Reihenfolge (geoElementsByEdge). Außerdem werden Bögen robust konstruiert
// (Center-Heuristik, Sweep-Vorzeichen, Minor-Arc) und Segmente so orientiert,
// dass sie lückenlos aneinander anschließen.
//
// Verwendung (minimaler Eingriff):
//  1) In GraphDataStore.js importieren:
//       import { buildOrderedSegments, projectIK_Ordered } from "./PathSegmentsOrdered.js";
//  2) In der Klasse GraphDataStore zwei Methoden ersetzen:
//       _getPathSegments(edgeId) { return buildOrderedSegments(this, edgeId); }
//       projectIntrinsicToXY(edgeId, ik) { return projectIK_Ordered(this, edgeId, ik); }
//  3) Alle anderen Aufrufer bleiben unverändert.
//
// Erwartete Store-APIs:
//   - getGeoElementsRawByEdge(edgeId)
//   - getGeoLinesByEdge(edgeId)        // → [{id, points:[{x,y},...]}]
//   - getGeoTransitionsByEdge(edgeId)
//   - getGeoArcsByEdge(edgeId)         // → [{id, points:[{x,y}], radius, center?}]
//   - getEdge(edgeId)                   // → { id, nodeIdA, nodeIdB, ... }
//   - getNodeXY(nodeId)                 // → { x, y }
//   - getEdgeEndpoints(edgeId)          // → { A:{x,y}, B:{x,y} }
//   - (optional) this._segmentsCache : Map(edgeId → packed)
//
// Rückgabeformat (kompatibel zur bisherigen Nutzung):
//   packed = {
//     length: number,           // Gesamtlänge
//     segments: Array<Segment>, // Segmentliste
//   }
//   Segment:
//     { kind:"line", p1:{x,y}, p2:{x,y}, len:number }
//     { kind:"arc", p1:{x,y}, p2:{x,y}, center:{x,y}, r:number,
//       ang1:number, ang2:number, sweep:number, len:number }
// ----------------------------------------------------------------------------

export function buildOrderedSegments(store, edgeId, opts = {}) {
    const EPS = opts.eps ?? 1e-6;
    const cache = store._segmentsCache || (store._segmentsCache = new Map());
    const cached = cache.get(edgeId);
    if (cached) return cached;

    const raw = store.getGeoElementsRawByEdge(edgeId) || [];
    const Ls = new Map((store.getGeoLinesByEdge(edgeId) || []).map(e => [e.id, e]));
    const Ts = new Map((store.getGeoTransitionsByEdge(edgeId) || []).map(e => [e.id, e]));
    const As = new Map((store.getGeoArcsByEdge(edgeId) || []).map(e => [e.id, e]));

    const segs = [];
    let lastEnd = null;     // letzter Endpunkt der bisher gebauten Kette
    let lastDir = null;     // letzte Tangentenrichtung (Einheitsvektor)

    const norm = p => (p && isFinite(p.x) && isFinite(p.y)) ? {x: +p.x, y: +p.y} : null;
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const vsub = (a, b) => ({x: a.x - b.x, y: a.y - b.y});
    const vlen = v => Math.hypot(v.x, v.y);
    const vnorm = v => {
        const L = vlen(v) || 1;
        return {x: v.x / L, y: v.y / L};
    };
    const same = (a, b) => dist(a, b) <= (opts.snap ?? 1e-3);

    function pushLineOriented(p1, p2) {
        let a = norm(p1), b = norm(p2);
        if (!a || !b) return;
        // Richtung wählen, die besser an lastEnd anschließt
        if (lastEnd) {
            const dAB = dist(lastEnd, a);
            const dBA = dist(lastEnd, b);
            if (dBA + EPS < dAB) {
                const t = a;
                a = b;
                b = t;
            }
            // notfalls leicht snappen
            if (!same(lastEnd, a) && dist(lastEnd, a) < (opts.snap ?? 1e-2)) a = lastEnd;
        }
        const len = dist(a, b);
        if (len <= EPS) return;
        segs.push({kind: "line", p1: a, p2: b, len});
        lastEnd = b;
        lastDir = vnorm(vsub(b, a));
    }

    function pushPolylineOriented(pts) {
        const P = (pts || []).map(norm).filter(Boolean);
        if (P.length < 2) return;
        // gesamte Polylinie ggf. umdrehen, um an lastEnd anzuschließen
        if (lastEnd) {
            const dStart = dist(lastEnd, P[0]);
            const dEnd = dist(lastEnd, P[P.length - 1]);
            if (dEnd + EPS < dStart) P.reverse();
            if (!same(lastEnd, P[0]) && dist(lastEnd, P[0]) < (opts.snap ?? 1e-2)) P[0] = lastEnd;
        }
        for (let i = 0; i < P.length - 1; i++) pushLineOriented(P[i], P[i + 1]);
    }

    function arcFromABR(p1, p2, rAbs, sgn, preferTangency = true) {
        // Erzeuge Arc-Parametrisierung; wähle Center-Seite ggf. so, dass Tangente zu lastDir passt
        const a = norm(p1), b = norm(p2);
        if (!a || !b || !(rAbs > 0)) return null;
        const d = dist(a, b);
        if (!(d > 0) || d / 2 > rAbs) return null; // unmögliches Dreieck

        // zwei mögliche Center auf perpendicular bisector
        const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
        const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;           // chord unit
        const px = -uy, py = ux;                                     // linke Senkrechte
        const h = Math.sqrt(Math.max(0, rAbs * rAbs - (d * d) / 4));

        const C1 = {x: mid.x + h * px, y: mid.y + h * py};
        const C2 = {x: mid.x - h * px, y: mid.y - h * py};

        // Kandidaten pauschal bestimmen: sgn (+1)==linke Seite, (-1)==rechte Seite (relativ A->B)
        const candidates = sgn >= 0 ? [C1, C2] : [C2, C1];

        function make(center) {
            const ang1 = Math.atan2(a.y - center.y, a.x - center.x);
            const ang2 = Math.atan2(b.y - center.y, b.x - center.x);
            let sweep = ang2 - ang1;
            // Normalisieren in [-PI, PI]
            while (sweep <= -Math.PI) sweep += 2 * Math.PI;
            while (sweep > Math.PI) sweep -= 2 * Math.PI;
            // Erzwinge Vorzeichen entsprechend sgn (Gegen-/Uhrzeigersinn)
            if (sgn >= 0 && sweep < 0) sweep += 2 * Math.PI;
            if (sgn < 0 && sweep > 0) sweep -= 2 * Math.PI;
            // Bevorzuge Minor-Arc (|sweep| <= PI)
            if (Math.abs(sweep) > Math.PI) sweep -= Math.sign(sweep) * 2 * Math.PI;
            const len = Math.abs(sweep) * rAbs;
            return {center, r: rAbs, ang1, ang2: ang1 + sweep, sweep, len};
        }

        // beide Kandidaten bewerten nach Tangenten-Kontinuität
        const s1 = make(candidates[0]);
        const s2 = make(candidates[1]);

        if (preferTangency && lastDir) {
            const t1 = tangentAtStart({kind: "arc", p1: a, ...s1});
            const t2 = tangentAtStart({kind: "arc", p1: a, ...s2});
            const dot1 = lastDir.x * t1.x + lastDir.y * t1.y;
            const dot2 = lastDir.x * t2.x + lastDir.y * t2.y;
            const chosen = (dot1 >= dot2) ? s1 : s2;
            return {kind: "arc", p1: a, p2: b, ...chosen};
        }
        return {kind: "arc", p1: a, p2: b, ...s1};
    }

    function tangentAtStart(seg) {
        if (seg.kind === "line") {
            const v = vnorm(vsub(seg.p2, seg.p1));
            return v;
        } else {
            // Tangente = 90° links von Radiusrichtung am Start; Vorzeichen durch sweep
            const rv = vnorm(vsub(seg.p1, seg.center));
            let t = {x: -rv.y, y: rv.x}; // links
            if (seg.sweep < 0) t = {x: -t.x, y: -t.y}; // rechts bei negativer Drehung
            return t;
        }
    }

    function pushArcOriented(arcObj) {
        // Endpunkte aus points ableiten (erste & letzte) oder aus p1/p2
        const pts = Array.isArray(arcObj.points) ? arcObj.points.map(norm).filter(Boolean) : [];
        const pA = pts[0] || norm(arcObj.p1);
        const pB = pts[pts.length - 1] || norm(arcObj.p2);
        if (!pA || !pB) return;

        // an lastEnd anschließen (ggf. Endpunkte tauschen)
        let a = pA, b = pB;
        if (lastEnd) {
            const dA = dist(lastEnd, pA), dB = dist(lastEnd, pB);
            if (dB + EPS < dA) {
                a = pB;
                b = pA;
            }
            if (!same(lastEnd, a) && dist(lastEnd, a) < (opts.snap ?? 1e-2)) a = lastEnd;
        }

        const rAbs = Math.abs(+arcObj.radius || 0);
        const sgn = (+arcObj.radius || 0) >= 0 ? 1 : -1;
        let center = arcObj.center ? norm(arcObj.center) : null;

        let arc;
        if (center) {
            // Center gegeben: Winkel/Sweep robust aufbereiten
            const ang1 = Math.atan2(a.y - center.y, a.x - center.x);
            const ang2_raw = Math.atan2(b.y - center.y, b.x - center.x);
            let sweep = ang2_raw - ang1;
            while (sweep <= -Math.PI) sweep += 2 * Math.PI;
            while (sweep > Math.PI) sweep -= 2 * Math.PI;
            if (sgn >= 0 && sweep < 0) sweep += 2 * Math.PI;
            if (sgn < 0 && sweep > 0) sweep -= 2 * Math.PI;
            if (Math.abs(sweep) > Math.PI) sweep -= Math.sign(sweep) * 2 * Math.PI;
            const len = Math.abs(sweep) * rAbs;
            arc = {kind: "arc", p1: a, p2: b, center, r: rAbs, ang1, ang2: ang1 + sweep, sweep, len};
        } else {
            arc = arcFromABR(a, b, rAbs, sgn, true);
            if (!arc) { // Fallback: als Polyline behandeln
                pushPolylineOriented([a, b]);
                return;
            }
        }

        segs.push(arc);
        lastEnd = arc.p2;
        lastDir = tangentAtStart(arc);
    }

    // --- Hauptrunde: **genau in Roh-Reihenfolge** abarbeiten
    for (const r of raw) {
        const id = r?.id ?? r?.geoElementId ?? null;
        if (!id) {
            if (r?.points) pushPolylineOriented(r.points);
            continue;
        }

        const L = Ls.get(id);
        if (L) {
            pushPolylineOriented(L.points);
            continue;
        }

        const T = Ts.get(id);
        if (T) {
            pushPolylineOriented(T.points);
            continue;
        }

        const A = As.get(id);
        if (A) {
            pushArcOriented(A);
            continue;
        }

        // Unbekannt → Fallback
        if (r?.points) pushPolylineOriented(r.points);
    }

    // Orientierung A→B global prüfen und ggf. invertieren
    const ends = store.getEdgeEndpoints(edgeId);
    if (ends?.A && ends?.B && segs.length) {
        const dA = dist(segs[0].p1, ends.A);
        const dB = dist(segs[0].p1, ends.B);
        if (dB + EPS < dA) {
            segs.reverse();
            for (const s of segs) {
                const t = s.p1;
                s.p1 = s.p2;
                s.p2 = t;
                if (s.kind === "arc") {
                    const a1 = s.ang1;
                    s.ang1 = s.ang2;
                    s.ang2 = a1;
                    s.sweep = -s.sweep;
                }
            }
        }
    }

    // Länge aufaddieren
    let total = 0;
    for (const s of segs) total += s.len ?? 0;
    const packed = {length: total, segments: segs};
    cache.set(edgeId, packed);
    return packed;
}

// --- IK-Projektion (0..length) → XY auf der geordneten Kette -----------------
export function projectIK_Ordered(store, edgeId, ik) {
    const packed = buildOrderedSegments(store, edgeId);
    const L = Math.max(0, Math.min(+ik || 0, packed.length || 0));
    let acc = 0;
    for (const s of packed.segments) {
        const next = acc + (s.len || 0);
        if (L <= next) {
            const t = (s.len > 0) ? (L - acc) / s.len : 0;
            if (s.kind === "line") {
                return {x: s.p1.x + (s.p2.x - s.p1.x) * t, y: s.p1.y + (s.p2.y - s.p1.y) * t};
            } else {
                const ang = s.ang1 + s.sweep * t;
                return {x: s.center.x + s.r * Math.cos(ang), y: s.center.y + s.r * Math.sin(ang)};
            }
        }
        acc = next;
    }
    // Ende: letzter Punkt (Fix für vorherigen Syntax-Bug)
    if (packed.segments.length) {
        const last = packed.segments[packed.segments.length - 1];
        return (last.kind === "arc")
            ? {x: last.center.x + last.r * Math.cos(last.ang2), y: last.center.y + last.r * Math.sin(last.ang2)}
            : {x: last.p2.x, y: last.p2.y};
    }
    return {x: 0, y: 0};
}

// --- Hilfsfunktion: Sampling zu Polyline (für Renderer/Projector) -------------
export function sampleSegmentsToPolyline(packed, maxChord = 3.0) {
    // maxChord: maximale Sehnenlänge beim Bogen-Sampling (in Einheiten des Koordinatensystems)
    const pts = [];
    const push = p => { if (!pts.length || pts[pts.length - 1].x !== p.x || pts[pts.length - 1].y !== p.y) pts.push(p); };
    for (const s of packed.segments) {
        if (s.kind === "line") {
            push(s.p1);
            push(s.p2);
        } else {
            const n = Math.max(2, Math.ceil(Math.abs(s.sweep) * s.r / Math.max(1e-6, maxChord)) + 1);
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const ang = s.ang1 + s.sweep * t;
                push({x: s.center.x + s.r * Math.cos(ang), y: s.center.y + s.r * Math.sin(ang)});
            }
        }
    }
    return pts;
}
