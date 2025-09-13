// =============================
// File: js/main.js
// =============================
// Bootstrapping für beide Renderer + Controller (M2‑Fixpack)

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";


import ISDPDataFetcher from "./ISDPDataFetcher.js";
import GraphDataStore from "./GraphDataStore.js";
import GraphProjector from "./GraphProjector.js";
import GraphController from "./GraphController.js";

import LocatedRendererD3 from "./renderers/LocatedRendererD3.js";
import DynamicRendererD3 from "./renderers/DynamicRendererD3.js";
import Events from "./events.js";

// --- Mounts & Buttons
const elLocated = document.getElementById("located-view");
const elDynamic = document.getElementById("dynamic-view");
const btnLocated = document.getElementById("btn-located");
const btnDynamic = document.getElementById("btn-dynamic");

// --- Renderer-Instanzen (keine Controller-Referenzen im Konstruktor)
const locatedRenderer = new LocatedRendererD3({
    mount: elLocated,
    onSelect: (ids) => controller?.addToSelection?.(ids)
});
const dynamicRenderer = new DynamicRendererD3({
    mount: elDynamic,
    onSelect: (ids) => controller?.addToSelection?.(ids)
});

// --- Pipeline
const fetcher = new ISDPDataFetcher();   // benötigt gültiges ISDP_SCHEMA & Endpunkte
const store = new GraphDataStore(fetcher);
const projector = new GraphProjector(store);

// --- Controller (JETZT erst erzeugen)
const controller = new GraphController({store, projector, locatedRenderer, dynamicRenderer});

// --- UI Wiring
const ui = new Events({ controller });

// --- Start Overlay Flow
const elOverlay = document.getElementById('start-overlay');
const elTopbar = document.querySelector('header.topbar');
const elMain = document.querySelector('main.main');
const inpUrl = document.getElementById('start-base-url');
const selVer = document.getElementById('sel-isdp-version');
const btnLoad = document.getElementById('btn-start-load');
const elStatus = document.getElementById('start-status');

const DEFAULT_URL = fetcher?.schema?.baseUrlKey || 'http://localhost:32308';

(function initStart() {
    try {
        const savedUrl = localStorage.getItem('isdp_base_url');
        const savedVer = localStorage.getItem('isdp_version');
        if (inpUrl && savedUrl) inpUrl.value = savedUrl;
        if (selVer && savedVer) selVer.value = savedVer;
        if (elStatus) elStatus.textContent = '';
    } catch {}
})();

async function doLoad() {
    if (btnLoad) btnLoad.disabled = true;
    if (elStatus) { elStatus.classList.remove('error'); elStatus.textContent = 'Lade Daten...'; }
    try {
        const urlRaw = (inpUrl?.value || '').trim();
        const url = urlRaw || DEFAULT_URL;
        const ver = selVer?.value || '3.0.17';
        try { localStorage.setItem('isdp_base_url', urlRaw); localStorage.setItem('isdp_version', ver); } catch {}
        fetcher.setAddress(url);
        const ok = await controller.loadFromISDP();
        if (ok) {
            if (elOverlay) elOverlay.style.display = 'none';
            if (elTopbar) elTopbar.style.display = '';
            if (elMain) elMain.style.display = '';
            // Initial: Graph sichtbar machen (einmalig zentrieren)
            controller.centerGraph();
            window.__graph = {controller, store, projector, d3};
            if (elStatus) elStatus.textContent = '';
        } else {
            if (elStatus) {
                elStatus.classList.add('error');
                elStatus.textContent = `Kein ISDP-Server unter dieser Adresse erreichbar: ${url}`;
            }
        }
    } catch (err) {
        console.error('Start load failed:', err);
        if (elStatus) {
            elStatus.classList.add('error');
            elStatus.textContent = `Kein ISDP-Server unter dieser Adresse erreichbar: ${((inpUrl?.value || '').trim()) || DEFAULT_URL}`;
        }
    } finally {
        if (btnLoad) btnLoad.disabled = false;
    }
}

if (btnLoad) btnLoad.addEventListener('click', doLoad);
if (inpUrl) inpUrl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doLoad(); });


