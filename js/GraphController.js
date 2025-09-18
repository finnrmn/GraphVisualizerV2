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
        this.filters = {}; 
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
            const nodes = Array.isArray(view?.nodes) ? view.nodes : [];

            const norm = (s) => {
                if (s == null) return '';
                return String(s);
            };
            const lc = (s) => norm(s).toLowerCase();
            const eq = (a, b) => {
                if (a == null || b == null) return false;
                return lc(a) === lc(b);
            };
            const contains = (a, b) => {
                if (a == null || b == null) return false;
                return lc(a).includes(lc(b));
            };

            const byIdElem = (id) => {
                const match = (arr) => (arr || []).find(d => d?.id != null && eq(d.id, id));
                return match(elems.balises) || match(elems.signals) || match(elems.tds_components) || null;
            };

            const byNameElem = (pred) => {
                const match = (arr) => (arr || []).find(d => {
                    const name = norm(d?.name ?? d?.label ?? d?.id ?? '');
                    return name && pred(name);
                });
                return match(elems.balises) || match(elems.signals) || match(elems.tds_components) || null;
            };

            const byIdNode = (id) => {
                if (!id) return null;
                return nodes.find(n => n?.id != null && eq(n.id, id)) || null;
            };

            const byNameNode = (pred) => {
                if (typeof pred !== 'function') return null;
                return nodes.find(n => {
                    const name = norm(n?.name ?? n?.label ?? n?.id ?? '');
                    return name && pred(name);
                }) || null;
            };

            const byIdEdge = (id) => {
                if (!id) return null;
                if (this.store.getEdge(id)) return id;
                const candidate = this.store.getAllEdges().find(e => e?.id != null && eq(e.id, id));
                return candidate ? candidate.id : null;
            };

            const byNameEdge = (pred) => {
                if (typeof pred !== 'function') return null;
                const t = topEdges.find(e => {
                    const label = norm(e?.label ?? e?.name ?? '');
                    return label && pred(label);
                });
                return t ? (t.id || null) : null;
            };

            const assignEdge = (edgeId) => {
                if (!edgeId) return false;
                kind = 'edge';
                selId = edgeId;
                zoomTo = null;
                const ge = edgesGeo.find(e => (e.edgeId || e.id) === edgeId);
                let p = null;
                const pts = ge?.polyline || [];
                if (pts.length > 0) {
                    const mid = Math.max(0, Math.floor((pts.length - 1) / 2));
                    p = pts[mid];
                }
                if (!p) {
                    const ends = this.store.getEdgeEndpoints(edgeId);
                    if (ends?.A && ends?.B) p = {x: (ends.A.x + ends.B.x) / 2, y: (ends.A.y + ends.B.y) / 2};
                }
                if (p) zoomTo = {x: p.x, y: p.y};
                return true;
            };

            const assignNode = (node) => {
                if (!node) return false;
                kind = 'node';
                selId = node.id;
                zoomTo = null;
                if (Number.isFinite(node?.x) && Number.isFinite(node?.y)) {
                    zoomTo = {x: node.x, y: node.y};
                }
                return true;
            };

            const assignElement = (el) => {
                if (!el) return false;
                kind = 'element';
                selId = el.id || el.edgeId;
                zoomTo = null;
                if (Number.isFinite(el.x) && Number.isFinite(el.y)) {
                    zoomTo = {x: el.x, y: el.y};
                }
                return true;
            };

            // 1) ID exakte Suche: Edge zuerst, dann Nodes, dann Elemente
            let kind = null;
            let selId = null;
            let zoomTo = null;

            if (!assignEdge(byIdEdge(q))) {
                if (!assignNode(byIdNode(q))) {
                    assignElement(byIdElem(q));
                }
            }

            // 2) Name exakte Übereinstimmung (falls nichts gefunden)
            if (!selId) {
                if (!assignEdge(byNameEdge(v => eq(v, q)))) {
                    if (!assignNode(byNameNode(v => eq(v, q)))) {
                        assignElement(byNameElem(v => eq(v, q)));
                    }
                }
            }

            // 3) Name enthält (Fallback)
            if (!selId) {
                if (!assignEdge(byNameEdge(v => contains(v, q)))) {
                    if (!assignNode(byNameNode(v => contains(v, q)))) {
                        assignElement(byNameElem(v => contains(v, q)));
                    }
                }
            }

            if (!selId) return {ok: false, reason: 'No matches found. Check ID/Name!'};

            this.addToSelection([selId]);

            if (zoomTo) {
                this.setProjectorOptions({ zoomTo, zoomToTarget: { kind, id: selId } });
            } else {
                this.setProjectorOptions({ zoomToTarget: { kind, id: selId } });
            }

            return {ok: true, kind, id: selId};
        } catch (e) {
            console.error('searchAndSelect failed', e);
            return {ok: false, reason: 'Internal error during search'};
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
