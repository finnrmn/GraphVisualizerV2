// src/v2.0.0/js/events.js
// Kapselt alle UI-Events und entkoppelt main.js von DOM-Wiring

export default class Events {
    /**
     * @param {Object} deps
     * @param {import('./GraphController.js').default} deps.controller
     */
    constructor({controller} = {}) {
        if (!controller) throw new Error('Events: controller ist erforderlich');
        this.controller = controller;

        this._cacheEls();
        this._bindUI();
        this._applyInitialState();
        this._initResizeObserver();
        this._bindBus();
    }

    _cacheEls() {
        // Views & Buttons (siehe index.html)
        this.elLocated = document.getElementById('located-view');
        this.elDynamic = document.getElementById('dynamic-view');
        this.btnLocated = document.getElementById('btn-located');
        this.btnDynamic = document.getElementById('btn-dynamic');

        // Layer/Filter Checkboxes
        this.elBal = document.getElementById('chk-balises');
        this.elSig = document.getElementById('chk-signals');
        this.elTds = document.getElementById('chk-tdscomp');
        this.elSpd = document.getElementById('chk-speed');
        this.elTdsSec = document.getElementById('chk-tdssec');

        // Geometrie-Ansicht
        this.elNodes = document.getElementById('chk-nodes');
        this.elEdges = document.getElementById('chk-edges');
        this.elSegs = document.getElementById('chk-segs');
        this.elArcsOnly = document.getElementById('chk-arcsOnly');
        this.elSegArrows = document.getElementById('chk-seg-arrows');

        // Names & IDs
        this.elNames = document.getElementById('chk-names');
        this.elIds = document.getElementById('chk-ids');
        this.elHideSel = document.getElementById('chk-hide-selected');

    // Graph Controls
        this.btnCenterGraph = document.getElementById('btn-center-graph');
        this.elFlipX = document.getElementById('chk-flip-x');
        this.elFlipY = document.getElementById('chk-flip-y');

        // Right panel
        this.elRightPanel = document.querySelector('.rightpanel');
        this.elDetailList = document.getElementById('detail-list');
        this.btnClearSel = document.getElementById('btn-clear-selection');

        // Search controls
        this.txtSearch = document.getElementById('txt-search');
        this.btnSearch = document.getElementById('btn-search');
        this.elSearchStatus = document.getElementById('search-status');
    }

    _bindUI() {
        // Geometrie toggles
        [this.elNodes, this.elEdges, this.elSegs, this.elArcsOnly, this.elSegArrows]
            .filter(Boolean)
            .forEach(el => el.addEventListener('change', () => this.applyGeometryToggles()));

        // Filter toggles
        [this.elBal, this.elSig, this.elTds]
            .filter(Boolean)
            .forEach(el => el.addEventListener('change', () => this.applyFilterToggles()));

        // Names & IDs toggles
        [this.elNames, this.elIds, this.elHideSel]
            .filter(Boolean)
            .forEach(el => el.addEventListener('change', () => this.applyFilterToggles()));

        // Projector options (speed, tds sections)
        [this.elSpd, this.elTdsSec]
            .filter(Boolean)
            .forEach(el => el.addEventListener('input', () => this.applyProjectorOpts()));

        // Mode switching
        if (this.btnLocated) this.btnLocated.addEventListener('click', () => this._switchMode('located'));
        if (this.btnDynamic) this.btnDynamic.addEventListener('click', () => this._switchMode('dynamic'));

        // Graph Controls
        if (this.btnCenterGraph) {
            this.btnCenterGraph.addEventListener('click', () => {
                this.controller.centerGraph();
            });
        }
        if (this.elFlipX) {
            this.elFlipX.addEventListener('change', () => {
                this.controller.setFlipAxis('x', this.elFlipX.checked);
            });
        }
        if (this.elFlipY) {
            this.elFlipY.addEventListener('change', () => {
                this.controller.setFlipAxis('y', this.elFlipY.checked);
            });
        }

        // Search wiring
        const doSearch = async () => {
            const q = (this.txtSearch?.value || '').trim();
            if (!q) {
                if (this.elSearchStatus) this.elSearchStatus.textContent = 'Bitte eine ID oder einen Namen eingeben.';
                return;
            }
            try {
                const res = await this.controller.searchAndSelect(q);
                if (res && res.ok) {
                    if (this.elSearchStatus) this.elSearchStatus.textContent = `Gefunden: ${res.kind} ${res.id}`;
                } else {
                    const msg = res && res.reason ? res.reason : 'Kein Element mit dieser ID oder diesem Namen gefunden.';
                    if (this.elSearchStatus) this.elSearchStatus.textContent = msg;
                }
            } catch (e) {
                if (this.elSearchStatus) this.elSearchStatus.textContent = 'Suche fehlgeschlagen.';
            }
        };
        if (this.btnSearch) this.btnSearch.addEventListener('click', doSearch);
        if (this.txtSearch) this.txtSearch.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') doSearch();
        });
    }

    _applyInitialState() {
        // Reihenfolge beibehalten wie zuvor
        this.applyFilterToggles();
        this.applyProjectorOpts();
        this.applyGeometryToggles();
    }

    _switchMode(mode) {
        const isLocated = mode === 'located';
        this.controller.setMode(mode);
        // Button-Styles und Sichtbarkeit der Views
        if (this.btnLocated && this.btnDynamic) {
            this.btnLocated.classList.toggle('active', isLocated);
            this.btnDynamic.classList.toggle('active', !isLocated);
        }
        if (this.elLocated && this.elDynamic) {
            this.elLocated.classList.toggle('visible', isLocated);
            this.elDynamic.classList.toggle('visible', !isLocated);
        }
    }

    applyFilterToggles() {
        this.controller.setFilters({
            showBalises: !!this.elBal?.checked,
            showSignals: !!this.elSig?.checked,
            showTdsComponents: !!this.elTds?.checked,
            showNames: !!this.elNames?.checked,
            showIds: !!this.elIds?.checked,
            hideSelectedElements: !!this.elHideSel?.checked,
        });
    }

    applyProjectorOpts() {
        this.controller.setProjectorOptions({
            includeSpeed: !!this.elSpd?.checked,
            includeTdsSections: !!this.elTdsSec?.checked,
        });
    }

    applyGeometryToggles() {
        this.controller.setFilters({
            showNodes: this.elNodes?.checked !== false, // default true
            showEdges: this.elEdges?.checked !== false, // default true
            showSegments: !!this.elSegs?.checked,       // default false
            arcsOnly: !!this.elArcsOnly?.checked,
            arrowOnSegments: this.elSegArrows?.checked !== false, // default true
        });
        this.controller.setProjectorOptions({
            includeSegments: !!this.elSegs?.checked,
        });
    }

    _initResizeObserver() {
        if (!('ResizeObserver' in window)) return;
        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                const {width, height} = e.contentRect || {};
                if (Number.isFinite(width) && Number.isFinite(height)) {
                    this.controller.resize(Math.floor(width), Math.floor(height));
                }
            }
        });
        if (this.elLocated) ro.observe(this.elLocated);
        if (this.elDynamic) ro.observe(this.elDynamic);
        this._ro = ro;
    }

    _bindBus() {
        const bus = this.controller.bus;
        if (!bus) return;
        this._unsub = this._unsub || [];
        this._unsub.push(
            bus.on('graph:selectionChanged', () => this._renderSelectionCards()),
            bus.on('graph:modeChanged', () => this._renderSelectionCards()),
            bus.on('graph:invalidateView', () => this._renderSelectionCards())
        );
        if (this.btnClearSel) {
            this.btnClearSel.addEventListener('click', () => this.controller.clearSelection());
        }
        // Delegate remove button clicks
        if (this.elDetailList) {
            this.elDetailList.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.remove-btn');
                if (btn && btn.dataset && btn.dataset.removeId) {
                    this.controller.removeFromSelection(btn.dataset.removeId);
                }
            });
        }
        // Initial render (after load it will re-render again)
        this._renderSelectionCards();
    }

    _renderSelectionCards() {
        if (!this.elDetailList) return;
        const sel = Array.from(this.controller.selection || []);
        const view = this.controller.lastView?.() || {};
        const isLocated = this.controller.mode === 'located';
        const edges = isLocated ? (view.top_edges || []) : (view.edges || []);
        const elems = (view.elements) || {};
        const bal = elems.balises || [];
        const sig = elems.signals || [];
        const tdc = elems.tds_components || [];

        const findEdgeById = (id) => edges.find(e => (e.id || e.edgeId) === id);
        const findElemById = (id) => (
            bal.find(e => e.id === id) ||
            sig.find(e => e.id === id) ||
            tdc.find(e => e.id === id)
        );

        const htmlCards = [];
        const ordered = sel.slice().reverse(); // newest on top
        for (const id of ordered) {
            let type = null;
            let title = '';
            const rows = [];

            // Try element first
            const el = findElemById(id);
            if (el) {
                if (bal.includes(el)) type = 'Balise';
                else if (sig.includes(el)) type = 'Signal';
                else if (tdc.includes(el)) type = 'TDS-Component';

                const edgeId = el.edgeId ?? null;
                const label = el.name || el.label || null;
                title = `${type}${label ? ` – ${label}` : ''}`;
                if (id) rows.push(['ID', id]);
                if (edgeId) rows.push(['Edge', edgeId]);
                if (isLocated && Number.isFinite(el.ikAB)) rows.push(['IK (A→B)', String(el.ikAB)]);
                if (!isLocated && Number.isFinite(el.distanceFromA)) rows.push(['Dist. from A [m]', String(Math.round(el.distanceFromA))]);
                if (el.kind) rows.push(['Kind', el.kind]);
                if (el.type) rows.push(['Type', el.type]);

                // Enrich with edge details
                if (edgeId) this._pushEdgeBasics(rows, edgeId);
            } else if (typeof id === 'string' && id.includes(':')) {
                // Segment selection: id format edgeId:index
                const edgeId = id.split(':')[0];
                const segs = this.controller.store.getEdgeSegmentsOrdered(edgeId) || [];
                const seg = segs.find(s => s.id === id);
                if (seg) {
                    const label = this.controller.store.getEdgeLabel(edgeId) || null;
                    title = `Segment – ${seg.kind === 'arc' ? 'Arc' : 'Line'}${label ? ` @ ${label}` : ''}`;
                    rows.push(['ID', id]);
                    rows.push(['Edge', edgeId]);
                    rows.push(['Type', seg.kind === 'arc' ? 'Arc' : 'Line']);
                    if (Number.isFinite(seg.len)) rows.push(['Length [m]', String(Math.round(seg.len))]);
                    if (seg.kind === 'arc') {
                        if (Number.isFinite(seg.r)) rows.push(['Radius [m]', String(Math.round(seg.r))]);
                        if (seg.center) rows.push(['Center (cx,cy)', `${Math.round(seg.center.x)}, ${Math.round(seg.center.y)}`]);
                        if (Number.isFinite(seg.ang1) && Number.isFinite(seg.ang2)) rows.push(['Angles (rad)', `${seg.ang1.toFixed(2)} → ${seg.ang2.toFixed(2)}`]);
                    }
                    // Edge basics
                    this._pushEdgeBasics(rows, edgeId);
                } else {
                    // Fallback if no seg found
                    title = `Item – ${id}`;
                    rows.push(['ID', id]);
                }
            } else {
                // Edge card
                const e = findEdgeById(id);
                if (e || this.controller.store.getEdge(id)) {
                    type = 'Edge';
                    const label = (e?.label) || this.controller.store.getEdgeLabel(id) || null;
                    title = `Edge${label ? ` – ${label}` : ''}`;
                    rows.push(['ID', id]);
                    this._pushEdgeBasics(rows, id);
                } else {
                    // Fallback as generic item
                    type = 'Item';
                    title = `Item – ${id}`;
                    rows.push(['ID', id]);
                }
            }

            htmlCards.push(this._renderCardHtml(id, title, rows));
        }

        this.elDetailList.innerHTML = htmlCards.join('');
    }

    _pushEdgeBasics(rows, edgeId) {
        try {
            const e = this.controller.store.getEdge(edgeId);
            if (!e) return;
            const A = e.nodeIdA || e.a || null;
            const B = e.nodeIdB || e.b || null;
            const L = this.controller.store.getEdgeLength(edgeId);
            const label = this.controller.store.getEdgeLabel(edgeId);
            if (label) rows.push(['Name', label]);
            if (A) rows.push(['Node A', A]);
            if (B) rows.push(['Node B', B]);
            if (Number.isFinite(L)) rows.push(['Length [m]', String(Math.round(L))]);
            if ('refIsA' in e) rows.push(['refIsA', String(e.refIsA)]);
            if ('refNodeId' in e) rows.push(['refNode', String(e.refNodeId)]);
        } catch {}
    }

    _renderCardHtml(id, title, rows) {
        const rowsHtml = rows.map(([k, v]) => `<div class="key">${k}</div><div class="val">${String(v)}</div>`).join('');
        return `
        <div class="detail-card" data-sel-id="${id}">
            <div class="card-head">
                <div class="title">${title}</div>
                <button class="remove-btn" data-remove-id="${id}" title="remove">remove</button>
            </div>
            <div class="rows">${rowsHtml}</div>
        </div>`;
    }
}
