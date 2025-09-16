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
        this._setupDetailOverlay();
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
                if (this.elSearchStatus) {
                    this.elSearchStatus.textContent = 'Bitte eine ID oder einen Namen eingeben.';
                    this.elSearchStatus.classList.remove('ok', 'error');
                }
                return;
            }
            try {
                const res = await this.controller.searchAndSelect(q);
                if (res && res.ok) {
                    if (this.elSearchStatus) {
                        this.elSearchStatus.textContent = `Gefunden: ${res.kind} ${res.id}`;
                        this.elSearchStatus.classList.remove('error');
                        this.elSearchStatus.classList.add('ok');
                    }
                } else {
                    const msg = res && res.reason ? res.reason : 'Kein Element mit dieser ID oder diesem Namen gefunden.';
                    if (this.elSearchStatus) {
                        this.elSearchStatus.textContent = msg;
                        this.elSearchStatus.classList.remove('ok');
                        this.elSearchStatus.classList.add('error');
                    }
                }
            } catch (e) {
                if (this.elSearchStatus) {
                    this.elSearchStatus.textContent = 'Suche fehlgeschlagen.';
                    this.elSearchStatus.classList.remove('ok');
                    this.elSearchStatus.classList.add('error');
                }
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
                    return;
                }
                const detailBtn = ev.target.closest('.detail-btn');
                if (detailBtn && detailBtn.dataset && detailBtn.dataset.detailId) {
                    this._openDetailOverlay(detailBtn.dataset.detailId);
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

        const store = this.controller.store;
        const pushRow = (rows, key, value, {force = false} = {}) => {
            const hasValue = !(value === undefined || value === null || value === '');
            if (!hasValue && !force) return;
            rows.push([key, hasValue ? String(value) : '—']);
        };

        const findElementDetail = (group, edgeId, elemId, approxIk) => {
            if (!store || !edgeId) return null;
            let list = [];
            if (group === 'balise') list = store.getBalisesByEdge(edgeId) || [];
            else if (group === 'signal') list = store.getSignalsByEdge(edgeId) || [];
            else if (group === 'tds') list = store.getTdsComponentsByEdge(edgeId) || [];
            if (!list.length) return null;
            if (elemId) {
                const byId = list.find(item => item && item.id === elemId);
                if (byId) return byId;
            }
            if (Number.isFinite(approxIk)) {
                const epsilon = 1e-4;
                const exact = list.find(item => Number.isFinite(item?.intrinsicAB) && Math.abs(item.intrinsicAB - approxIk) <= epsilon);
                if (exact) return exact;
                let best = null;
                let bestDelta = Infinity;
                for (const item of list) {
                    const t = Number(item?.intrinsicAB);
                    if (!Number.isFinite(t)) continue;
                    const delta = Math.abs(t - approxIk);
                    if (delta < bestDelta) {
                        bestDelta = delta;
                        best = item;
                    }
                }
                if (best && bestDelta <= 1e-2) return best;
            }
            return null;
        };

        this._detailPayloads = new Map();
        const htmlCards = [];
        const ordered = sel.slice().reverse(); // newest on top
        for (const id of ordered) {
            let type = null;
            let title = '';
            const rows = [];
            let detailPayload = null;
            let displayName = '';

            // Try element first
            const el = findElemById(id);
            if (el) {
                let detail = null;
                let edgeId = el.edgeId ?? null;
                let label = el.name || el.label || null;
                let approxIk = Number.isFinite(el.ikAB) ? el.ikAB : null;
                let edgeLength = null;
                if (store && edgeId) {
                    const len = store.getEdgeLength(edgeId);
                    if (Number.isFinite(len)) edgeLength = len;
                }
                if (!Number.isFinite(approxIk) && Number.isFinite(el.distanceFromA) && Number.isFinite(edgeLength) && edgeLength > 0) {
                    approxIk = el.distanceFromA / edgeLength;
                }

                if (bal.includes(el)) {
                    type = 'Balise';
                    detail = findElementDetail('balise', edgeId, id, approxIk);
                } else if (sig.includes(el)) {
                    type = 'Signal';
                    detail = findElementDetail('signal', edgeId, id, approxIk);
                } else if (tdc.includes(el)) {
                    type = 'TDS-Component';
                    detail = findElementDetail('tds', edgeId, id, approxIk);
                }

                if (!label) label = detail?.name || detail?.label || null;
                if (!edgeId) {
                    edgeId = detail?.netElementRef || null;
                    if (store && edgeId) {
                        const len = store.getEdgeLength(edgeId);
                        if (Number.isFinite(len)) edgeLength = len;
                    }
                }
                if (!Number.isFinite(approxIk) && Number.isFinite(detail?.intrinsicAB)) {
                    approxIk = detail.intrinsicAB;
                }
                if (!Number.isFinite(edgeLength) && store && edgeId) {
                    const len = store.getEdgeLength(edgeId);
                    if (Number.isFinite(len)) edgeLength = len;
                }
                let distanceFromA = Number.isFinite(el.distanceFromA) ? el.distanceFromA : null;
                if (!Number.isFinite(distanceFromA) && Number.isFinite(detail?.pos)) distanceFromA = detail.pos;
                if (!Number.isFinite(distanceFromA) && Number.isFinite(approxIk) && Number.isFinite(edgeLength)) {
                    distanceFromA = approxIk * edgeLength;
                }

                const titleLabel = label || id || '';
                title = `${type}${titleLabel ? ` – ${titleLabel}` : ''}`;
                displayName = titleLabel;

                pushRow(rows, 'ID', id, {force: true});
                pushRow(rows, 'Name', label ?? detail?.name ?? null, {force: true});
                pushRow(rows, 'Edge', edgeId, {force: true});

                if (edgeId) {
                    this._pushEdgeBasics(rows, edgeId, { labelKey: 'Edge Name' });
                    if (!rows.some(([k]) => k === 'Edge Name')) pushRow(rows, 'Edge Name', null, {force: true});
                } else {
                    pushRow(rows, 'Edge Name', null, {force: true});
                }

                if (Number.isFinite(approxIk)) pushRow(rows, 'IK (A→B)', Number(approxIk).toFixed(5), {force: true});
                else pushRow(rows, 'IK (A→B)', null, {force: true});

                if (Number.isFinite(distanceFromA)) pushRow(rows, 'Dist. from A [m]', String(Math.round(distanceFromA)));

                const intrinsicRefVal = Number.isFinite(detail?.intrinsicRef) ? Number(detail.intrinsicRef).toFixed(5) : null;

                if (type === 'Balise') {
                    const appDir = detail?.applicationDirection ?? el.applicationDirection ?? null;
                    pushRow(rows, 'Application Dir', appDir);
                    pushRow(rows, 'Intrinsic (Ref)', intrinsicRefVal);
                } else if (type === 'Signal') {
                    const kindVal = el.kind ?? detail?.kind ?? detail?.raw?.kind ?? null;
                    if (kindVal) pushRow(rows, 'Kind', kindVal);
                    pushRow(rows, 'Intrinsic (Ref)', intrinsicRefVal);
                    const appDir = detail?.applicationDirection ?? detail?.raw?.applicationDirection ?? null;
                    if (appDir) pushRow(rows, 'Application Dir', appDir);
                } else if (type === 'TDS-Component') {
                    const typeVal = el.type ?? detail?.componentType ?? null;
                    if (typeVal) pushRow(rows, 'Type', typeVal);
                    pushRow(rows, 'Intrinsic (Ref)', intrinsicRefVal);
                    const appDir = detail?.applicationDirection ?? null;
                    if (appDir) pushRow(rows, 'Application Dir', appDir);
                    if (Number.isFinite(detail?.pos)) pushRow(rows, 'Position [m]', String(Math.round(detail.pos)));
                }

                if (detail && typeof detail === 'object') detailPayload = detail.raw || detail;
                if (!detailPayload && detail && typeof detail === 'object') detailPayload = detail;
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
                    this._pushEdgeBasics(rows, edgeId, { labelKey: 'Edge Name' });
                    type = 'Segment';
                    displayName = seg.kind === 'arc' ? 'Arc' : 'Line';
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
                    const edgeObj = this.controller.store.getEdge(id);
                    detailPayload = edgeObj?.raw || edgeObj || null;
                    displayName = label || id || '';
                } else {
                    // Fallback as generic item
                    type = 'Item';
                    title = `Item – ${id}`;
                    rows.push(['ID', id]);
                }
            }

            if (detailPayload && typeof detailPayload === 'object') {
                this._detailPayloads.set(id, {
                    id,
                    type: type || 'Item',
                    name: displayName || null,
                    raw: detailPayload
                });
            }

            htmlCards.push(this._renderCardHtml(id, title, rows, {hasDetails: this._detailPayloads.has(id)}));
        }

        this.elDetailList.innerHTML = htmlCards.join('');

        if (this._detailOverlayActiveId && !this._detailPayloads.has(this._detailOverlayActiveId)) {
            this._closeDetailOverlay();
        }
    }

    _pushEdgeBasics(rows, edgeId, opts = {}) {
        try {
            const e = this.controller.store.getEdge(edgeId);
            if (!e) return;
            const A = e.nodeIdA || e.a || null;
            const B = e.nodeIdB || e.b || null;
            const L = this.controller.store.getEdgeLength(edgeId);
            const label = this.controller.store.getEdgeLabel(edgeId);
            const labelKey = opts.labelKey || 'Name';
            if (label) rows.push([labelKey, label]);
            if (A) rows.push(['Node A', A]);
            if (B) rows.push(['Node B', B]);
            if (Number.isFinite(L)) rows.push(['Length [m]', String(Math.round(L))]);
            if ('refIsA' in e) rows.push(['refIsA', String(e.refIsA)]);
            if ('refNodeId' in e) rows.push(['refNode', String(e.refNodeId)]);
        } catch {}
    }

    _renderCardHtml(id, title, rows, opts = {}) {
        const hasDetails = !!opts.hasDetails;
        const rowsHtml = rows.map(([k, v]) => `<div class="key">${k}</div><div class="val">${String(v)}</div>`).join('');
        return `
        <div class="detail-card" data-sel-id="${id}">
            <div class="card-head">
                <div class="title">${title}</div>
                <div class="actions">
                    ${hasDetails ? `<button class="detail-btn btn btn-sm" data-detail-id="${id}" title="Details ansehen">details</button>` : ''}
                    <button class="remove-btn btn btn-sm" data-remove-id="${id}" title="remove"> x </button>
                </div>
            </div>
            <div class="rows">${rowsHtml}</div>
        </div>`;
    }

    _setupDetailOverlay() {
        if (this._detailOverlayRoot) return;
        const root = document.createElement('div');
        root.className = 'detail-overlay hidden';
        root.setAttribute('aria-hidden', 'true');

        const backdrop = document.createElement('div');
        backdrop.className = 'detail-overlay__backdrop';
        root.appendChild(backdrop);

        const panel = document.createElement('div');
        panel.className = 'detail-overlay__panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        root.appendChild(panel);

        const header = document.createElement('div');
        header.className = 'detail-overlay__header';
        panel.appendChild(header);

        const meta = document.createElement('div');
        meta.className = 'detail-overlay__meta';
        header.appendChild(meta);

        const typeEl = document.createElement('div');
        typeEl.className = 'detail-overlay__type';
        meta.appendChild(typeEl);

        const nameEl = document.createElement('div');
        nameEl.className = 'detail-overlay__name';
        meta.appendChild(nameEl);

        const idEl = document.createElement('div');
        idEl.className = 'detail-overlay__id';
        meta.appendChild(idEl);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'detail-overlay__close btn btn-sm';
        closeBtn.type = 'button';
        closeBtn.textContent = 'close';
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'detail-overlay__body';
        panel.appendChild(body);

        const pre = document.createElement('pre');
        pre.className = 'detail-overlay__pre';
        body.appendChild(pre);

        document.body.appendChild(root);
        this._detailOverlayRoot = root;
        this._detailOverlayEls = {typeEl, nameEl, idEl, pre, closeBtn, panel};

        backdrop.addEventListener('click', () => this._closeDetailOverlay());
        closeBtn.addEventListener('click', () => this._closeDetailOverlay());
    }

    _openDetailOverlay(selId) {
        if (!this._detailOverlayRoot || !this._detailPayloads) return;
        const entry = this._detailPayloads.get(selId);
        if (!entry) return;
        const {type, name, raw, id} = entry;
        const json = (() => {
            try {
                return JSON.stringify(raw, null, 2);
            } catch (err) {
                return String(err || 'Unable to stringify payload');
            }
        })();

        this._detailOverlayEls.typeEl.textContent = type || 'Item';
        this._detailOverlayEls.nameEl.textContent = name ? String(name) : '';
        this._detailOverlayEls.idEl.textContent = id ? `ID: ${id}` : '';
        this._detailOverlayEls.pre.textContent = json;

        this._detailOverlayRoot.classList.remove('hidden');
        this._detailOverlayRoot.setAttribute('aria-hidden', 'false');
        this._detailOverlayEls.closeBtn.focus();
        this._detailOverlayActiveId = id;

        if (!this._detailOverlayKeyHandler) {
            this._detailOverlayKeyHandler = (ev) => {
                if (ev.key === 'Escape') this._closeDetailOverlay();
            };
        }
        document.addEventListener('keydown', this._detailOverlayKeyHandler);
        this._overlayScrollRestore = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }

    _closeDetailOverlay() {
        if (!this._detailOverlayRoot) return;
        this._detailOverlayRoot.classList.add('hidden');
        this._detailOverlayRoot.setAttribute('aria-hidden', 'true');
        this._detailOverlayActiveId = null;
        if (this._detailOverlayKeyHandler) {
            document.removeEventListener('keydown', this._detailOverlayKeyHandler);
        }
        if (this._overlayScrollRestore !== undefined) {
            document.body.style.overflow = this._overlayScrollRestore;
            this._overlayScrollRestore = undefined;
        }
    }
}


// === Overlay Panels & Bottom Dock initializer (no hotkeys) ===
(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const onReady = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  };

  onReady(() => {
    const leftPanel  = document.getElementById('leftpanel')  || document.querySelector('.leftpanel');
    const rightPanel = document.getElementById('rightpanel') || document.querySelector('.rightpanel');
    const dockControls  = document.getElementById('dock-controls');
    const dockSelection = document.getElementById('dock-selection');

    if (!leftPanel || !rightPanel || !dockControls || !dockSelection) {
      // Not the target page or markup missing; abort silently
      return;
    }

    // State + persistence
    const LS = {
      get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
    };

    const MIN_W = 240, MAX_W = 450;
    let leftW  = LS.get('ui_left_w',  320);
    let rightW = LS.get('ui_right_w', 360);
    let leftOpen  = LS.get('ui_left_open',  true);
    let rightOpen = LS.get('ui_right_open', true);

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    const applyWidths = () => {
      // Left panel no longer resizable: rely on CSS var --left-w
      leftPanel.style.removeProperty('width');
      // Keep right panel resizable
      rightPanel.style.width = `${clamp(rightW, MIN_W, MAX_W)}px`;
    };

    const setOpen = (side, open) => {
      const panel = side === 'left' ? leftPanel : rightPanel;
      const btn   = side === 'left' ? dockControls : dockSelection;
      panel.classList.toggle('is-collapsed', !open);
      btn.classList.toggle('active', open);
      btn.setAttribute('aria-expanded', String(open));
      if (side === 'left') { leftOpen = open; LS.set('ui_left_open', open); }
      else { rightOpen = open; LS.set('ui_right_open', open); }
    };

    // Initial apply
    applyWidths();
    setOpen('left',  !!leftOpen);
    setOpen('right', !!rightOpen);

    // Dock button wiring
    dockControls.addEventListener('click', () => setOpen('left',  !leftOpen));
    dockSelection.addEventListener('click', () => setOpen('right', !rightOpen));

    // Build resizers
    const makeResizer = (panel, side) => {
      const res = document.createElement('div');
      res.className = 'panel-resizer';
      const grip = document.createElement('div');
      grip.className = 'grip';
      res.appendChild(grip);
      panel.appendChild(res);

      let drag = null;
      let raf = null;
      const onDown = (ev) => {
        ev.preventDefault();
        drag = { startX: ev.clientX, startW: panel.getBoundingClientRect().width };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', onUp, { once: true });
      };
      const onMove = (ev) => {
        if (!drag) return;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          const dx = ev.clientX - drag.startX;
          const next = side === 'left' ? clamp(drag.startW + dx, MIN_W, MAX_W)
                                       : clamp(drag.startW - dx, MIN_W, MAX_W);
          if (side === 'left') { leftW = next; LS.set('ui_left_w', next); }
          else { rightW = next; LS.set('ui_right_w', next); }
          panel.style.width = `${next}px`;
        });
      };
      const onUp = () => {
        drag = null;
        window.removeEventListener('pointermove', onMove);
      };

      res.addEventListener('pointerdown', onDown);
      res.addEventListener('dblclick', () => {
        const def = side === 'left' ? 320 : 360;
        if (side === 'left') { leftW = def; LS.set('ui_left_w', def); }
        else { rightW = def; LS.set('ui_right_w', def); }
        panel.style.width = `${def}px`;
      });
    };

    // Left panel fixed width: no resizer
    makeResizer(rightPanel, 'right');
  });
})();
