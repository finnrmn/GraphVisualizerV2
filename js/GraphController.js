import GraphDataStore from './GraphDataStore.js';
import GraphProjector from './GraphProjector.js';

export default class GraphController {
    constructor({store, projector, locatedRenderer, dynamicRenderer, bus} = {}) {
        if (!(store instanceof GraphDataStore)) throw new Error('GraphController: store fehlt/ist ungültig');
        if (!(projector instanceof GraphProjector)) throw new Error('GraphController: projector fehlt/ist ungültig');
        if (!locatedRenderer || typeof locatedRenderer.update !== 'function') throw new Error('GraphController: locatedRenderer.update fehlt');
        if (!dynamicRenderer || typeof dynamicRenderer.update !== 'function') throw new Error('GraphController: dynamicRenderer.update fehlt');

        this.store = store;
        this.projector = projector;
        this.locatedRenderer = locatedRenderer;
        this.dynamicRenderer = dynamicRenderer;
        this.bus = bus || new MiniEventBus();

        this.mode = 'located';
        this.filters = {}; // beliebig erweiterbar
        this.projectorOptions = {maxChord: 1, includeSpeed: true, includeTopEdges: true, includeTdsSections: true};
        this.selection = new Set();
        this.hover = null;

        this._isLoading = false;
        this._lastView = null;
    }

    /** Zentriert und skaliert den Graph so, dass er voll sichtbar ist */
    centerGraph() {
        // Setze Option, die das Centering erzwingt (wird von Renderer/Projector genutzt)
        this.setProjectorOptions({centerGraph: true});
    }

    /** Spiegelt den Graph an der X- oder Y-Achse */
    setFlipAxis(axis, enabled) {
        if (axis === 'x') {
            this.setProjectorOptions({flipX: !!enabled});
        } else if (axis === 'y') {
            this.setProjectorOptions({flipY: !!enabled});
        }
    }

    async loadFromISDP() {
        console.log('GraphController.loadFromISDP: Start loading data.');
        if (this._isLoading) return false;
        this._isLoading = true;
        try {
            this.bus.emit('graph:loading');
            await this.store.loadAll();
            console.log('GraphController.loadFromISDP: Data loaded, projecting view.');
            this.bus.emit('graph:loaded');
            this.refreshView();
            return true;
        } catch (err) {
            console.log('GraphController.loadFromISDP: Error loading data:', err);
            console.error('GraphController.loadFromISDP failed:', err);
            this.bus.emit('graph:error', {where: 'loadFromISDP', error: String(err)});
            return false;
        } finally {
            this._isLoading = false;
        }
    }

    setMode(mode) {
        if (mode !== 'located' && mode !== 'dynamic') return;
        if (this.mode === mode) return;
        this.mode = mode;
        this.bus.emit('graph:modeChanged', {mode});
        this.refreshView();
    }

    setFilters(partial) {
        this.filters = {...this.filters, ...(partial || {})};
        this.bus.emit('graph:filtersChanged', {filters: this.filters});
        this.refreshView();
    }

    setProjectorOptions(partial) {
        this.projectorOptions = {...this.projectorOptions, ...(partial || {})};
        this.bus.emit('graph:projectorOptionsChanged', {projectorOptions: this.projectorOptions});
        this.refreshView();
    }

    refreshView() {
        try {
            const state = {
                mode: this.mode,
                selection: Array.from(this.selection),
                filters: this.filters,
                projectorOptions: this.projectorOptions // NEU: Optionen für Flip/Center
            };
            // One-shot flags: centerGraph and zoomTo
            const didRequestCenter = !!this.projectorOptions?.centerGraph;
            const hadZoomTo = !!(this.projectorOptions && this.projectorOptions.zoomTo && Number.isFinite(this.projectorOptions.zoomTo.x) && Number.isFinite(this.projectorOptions.zoomTo.y));

            let view;
            if (this.mode === 'located') {
                view = this.projector.makeLocatedView(this.projectorOptions);
                this.locatedRenderer.update(view, state);
            } else {
                view = this.projector.makeDynamicView({includeSpeed: this.projectorOptions.includeSpeed});
                this.dynamicRenderer.update(view, state);
            }

            // Reset the centerGraph flag after it has been applied once
            if (didRequestCenter && this.projectorOptions.centerGraph) {
                this.projectorOptions = { ...this.projectorOptions, centerGraph: false };
            }
            // One-shot zoomTo reset after render
            if (hadZoomTo && this.projectorOptions.zoomTo) {
                const { centerGraph, ...rest } = this.projectorOptions;
                this.projectorOptions = { ...rest, centerGraph: this.projectorOptions.centerGraph, zoomTo: null };
            }

            this._lastView = view;
            this.bus.emit('graph:invalidateView', {mode: this.mode, view});
        } catch (err) {
            console.error('GraphController.refreshView failed:', err);
            this.bus.emit('graph:error', {where: 'refreshView', error: String(err)});
        }
    }

    select(ids) {
        if (!ids) return;
        this.selection = new Set(ids);
        this.bus.emit('graph:selectionChanged', {selection: Array.from(this.selection)});
        this.refreshView();
    }

    addToSelection(ids) {
        if (!ids) return;
        let changed = false;
        for (const id of ids) {
            if (this.selection.has(id)) {
                // Reorder: move to most-recent by deleting and re-adding
                this.selection.delete(id);
                this.selection.add(id);
                changed = true;
            } else {
                this.selection.add(id);
                changed = true;
            }
        }
        if (changed) {
            this.bus.emit('graph:selectionChanged', {selection: Array.from(this.selection)});
            this.refreshView();
        }
    }

    removeFromSelection(id) {
        if (id == null) return;
        if (this.selection.delete(id)) {
            this.bus.emit('graph:selectionChanged', {selection: Array.from(this.selection)});
            this.refreshView();
        }
    }

    clearSelection() {
        if (this.selection.size === 0) return;
        this.selection.clear();
        this.bus.emit('graph:selectionChanged', {selection: []});
        this.refreshView();
    }

    resize(width, height) {
        this.bus.emit('graph:resize', {width, height});
    }

    lastView() { return this._lastView; }

    /**
     * Suche nach Elementen oder Kanten per ID oder Name. Fügt Treffer zur Selection hinzu und zoomt auf die Position.
     * @param {string} query
     * @returns {{ok:boolean, kind?:'element'|'edge', id?:string, reason?:string}}
     */
    async searchAndSelect(query) {
        try {
            const q = String(query || '').trim();
            if (!q) return {ok: false, reason: 'Leere Suchanfrage'};

            // Verwende eine Located-View für Suche & XY-Ermittlung (unabhängig vom aktuellen Modus)
            const view = this.projector.makeLocatedView(this.projectorOptions || {});
            const elems = view?.elements || {};
            const edgesGeo = view?.geo_edges || [];
            const topEdges = view?.top_edges || [];

            const byIdElem = (id) => (elems.balises || []).find(d => d.id === id)
                || (elems.signals || []).find(d => d.id === id)
                || (elems.tds_components || []).find(d => d.id === id) || null;

            const byNameElem = (pred) => (elems.balises || []).find(d => pred(d.name))
                || (elems.signals || []).find(d => pred(d.name))
                || (elems.tds_components || []).find(d => pred(d.name)) || null;

            const byIdEdge = (id) => this.store.getEdge(id) ? id : null;
            const byNameEdge = (pred) => {
                const t = topEdges.find(e => pred(e.label || e.name || ''));
                return t ? (t.id || null) : null;
            };

            const norm = (s) => (s ?? '').toString();
            const lc = (s) => norm(s).toLowerCase();
            const eq = (a, b) => lc(a) === lc(b);
            const contains = (a, b) => lc(a).includes(lc(b));

            // 1) ID exakte Suche: Edge zuerst, dann Elemente
            let kind = null;
            let selId = null;
            let zoomTo = null;

            let edgeId = byIdEdge(q);
            if (edgeId) {
                kind = 'edge';
                selId = edgeId;
                // XY am Mittelpunkt der Polyline berechnen
                const ge = edgesGeo.find(e => (e.edgeId || e.id) === edgeId);
                let p = null;
                const pts = ge?.polyline || [];
                if (pts.length > 0) {
                    const mid = Math.max(0, Math.floor((pts.length - 1) / 2));
                    p = pts[mid];
                }
                if (!p) {
                    // Fallback: Endpunkte der Edge aus Store
                    const ends = this.store.getEdgeEndpoints(edgeId);
                    if (ends?.A && ends?.B) p = {x: (ends.A.x + ends.B.x) / 2, y: (ends.A.y + ends.B.y) / 2};
                }
                if (p) zoomTo = {x: p.x, y: p.y};
            } else {
                // 2) Element-ID
                const el = byIdElem(q);
                if (el) {
                    kind = 'element';
                    selId = el.id || el.edgeId; // Fallback falls id fehlt
                    zoomTo = (Number.isFinite(el.x) && Number.isFinite(el.y)) ? {x: el.x, y: el.y} : null;
                }
            }

            // 3) Name exakte Übereinstimmung (falls nichts gefunden)
            if (!selId) {
                // Edge-Name exakt
                edgeId = byNameEdge(v => eq(v, q));
                if (edgeId) {
                    kind = 'edge';
                    selId = edgeId;
                    const ge = edgesGeo.find(e => (e.edgeId || e.id) === edgeId);
                    const pts = ge?.polyline || [];
                    if (pts.length) {
                        const mid = Math.max(0, Math.floor((pts.length - 1) / 2));
                        const p = pts[mid];
                        zoomTo = {x: p.x, y: p.y};
                    }
                } else {
                    // Element-Name exakt
                    const el = byNameElem(v => eq(v, q));
                    if (el) {
                        kind = 'element';
                        selId = el.id || el.edgeId;
                        if (Number.isFinite(el.x) && Number.isFinite(el.y)) zoomTo = {x: el.x, y: el.y};
                    }
                }
            }

            // 4) Name enthält (fallback)
            if (!selId) {
                edgeId = byNameEdge(v => contains(v, q));
                if (edgeId) {
                    kind = 'edge';
                    selId = edgeId;
                    const ge = edgesGeo.find(e => (e.edgeId || e.id) === edgeId);
                    const pts = ge?.polyline || [];
                    if (pts.length) {
                        const mid = Math.max(0, Math.floor((pts.length - 1) / 2));
                        const p = pts[mid];
                        zoomTo = {x: p.x, y: p.y};
                    }
                } else {
                    const el = byNameElem(v => contains(v, q));
                    if (el) {
                        kind = 'element';
                        selId = el.id || el.edgeId;
                        if (Number.isFinite(el.x) && Number.isFinite(el.y)) zoomTo = {x: el.x, y: el.y};
                    }
                }
            }

            if (!selId) return {ok: false, reason: 'Kein Treffer gefunden. Prüfen Sie ID/Name.'};

            // Selection aktualisieren
            this.addToSelection([selId]);

            // One-shot zoomTo setzen (XY für Located; Renderer wertet das aus)
            if (zoomTo) {
                this.setProjectorOptions({ zoomTo, zoomToTarget: { kind, id: selId } });
            } else {
                // Falls keine XY vorhanden, trotzdem Ziel-ID setzen (für Dynamic-Ansicht)
                this.setProjectorOptions({ zoomToTarget: { kind, id: selId } });
            }

            return {ok: true, kind, id: selId};
        } catch (e) {
            console.error('searchAndSelect failed', e);
            return {ok: false, reason: 'Interner Fehler bei der Suche'};
        }
    }
}

class MiniEventBus {
    constructor() { this._m = new Map(); }
    on(evt, fn) {
        if (!this._m.has(evt)) this._m.set(evt, new Set());
        this._m.get(evt).add(fn);
        return () => this.off(evt, fn);
    }
    off(evt, fn) {
        const s = this._m.get(evt);
        if (s) s.delete(fn);
    }
    emit(evt, payload) {
        const s = this._m.get(evt);
        if (!s) return;
        for (const fn of s) {
            try {
                fn(payload);
            } catch (e) {
                console.error('EventBus listener error', e);
            }
        }
    }
}
