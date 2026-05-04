/* ============================================================
 * Compilatore (Universale) - Content Script (isolated world)
 * Widget UI + scanner DOM + dispatcher fill via bridge MAIN world
 * Tutta la logica Angular-aware (lettura __ngContext__, FormControl,
 * MatSelect.open ecc.) è nel page-bridge.js — qui delego via postMessage.
 * ============================================================ */

(function () {
  'use strict';
  if (window.__COMPILATORE_RDD_UNIVERSAL_LOADED__) return;
  window.__COMPILATORE_RDD_UNIVERSAL_LOADED__ = true;

  // -----------------------------------------------------------
  // 1) STATO GLOBALE
  // -----------------------------------------------------------
  const state = {
    documents: [],     // [{name, type, text, sizeKB, addedAt}]
    selectedDocId: null, // '__all__' | name del doc | null
    settings: {
      apiKey: '',
      model: 'gpt-4.1',
      theme: 'light'   // 'light' | 'dark'
    },
    widgetOpen: true,
    isWorking: false,
    bridgeReady: false
  };

  // Prezzi per 1M token (USD) — fonte: openai.com/pricing
  const MODELS = [
    { id: 'gpt-4.1',          label: 'GPT-4.1',          desc: 'Il più intelligente, qualità massima (consigliato)', priceIn: 2.00, priceOut: 8.00 },
    { id: 'gpt-4.1-mini',     label: 'GPT-4.1 mini',     desc: 'Buona qualità, 5× più economico',                    priceIn: 0.40, priceOut: 1.60 },
    { id: 'gpt-4o-mini',      label: 'GPT-4o mini',      desc: 'Il più economico, qualità ridotta',                  priceIn: 0.15, priceOut: 0.60 }
  ];

  // Formattazione prezzo come da documentazione OpenAI
  function fmtPrice(p) { return '$' + p.toFixed(2); }
  // Per il log: costo effettivo della chiamata
  function formatCost(usd) {
    if (usd < 0.001) return '$' + usd.toFixed(5);
    if (usd < 1)     return '$' + usd.toFixed(4);
    return '$' + usd.toFixed(2);
  }

  // -----------------------------------------------------------
  // 2) CARICAMENTO IMPOSTAZIONI E DOCUMENTI PERSISTITI
  // -----------------------------------------------------------

  // Wrapper sicuro per chrome.storage: se l'extension context è invalidato
  // (es. utente ha appena ricaricato l'estensione), non lancia errore ma logga.
  function safeStorageSet(area, data) {
    try {
      if (!chrome?.runtime?.id) {
        if (typeof handleContextInvalidated === 'function') handleContextInvalidated();
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        try {
          chrome.storage[area].set(data, () => {
            if (chrome.runtime.lastError) {
              if (typeof handleContextInvalidated === 'function') handleContextInvalidated();
            }
            resolve();
          });
        } catch (err) {
          if (typeof handleContextInvalidated === 'function') handleContextInvalidated();
          resolve();
        }
      });
    } catch (err) {
      if (typeof handleContextInvalidated === 'function') handleContextInvalidated();
      return Promise.resolve();
    }
  }

  function safeStorageGet(area, keys) {
    try {
      if (!chrome?.runtime?.id) return Promise.resolve({});
      return new Promise((resolve) => {
        try {
          chrome.storage[area].get(keys, (data) => resolve(data || {}));
        } catch (err) { resolve({}); }
      });
    } catch (err) { return Promise.resolve({}); }
  }

  async function loadSettings() {
    const data = await safeStorageGet('sync', ['apiKey', 'model', 'theme']);
    state.settings.apiKey = data.apiKey || '';
    const savedModel = data.model || 'gpt-4.1';
    const valid = MODELS.some(m => m.id === savedModel);
    state.settings.model  = valid ? savedModel : 'gpt-4.1';
    if (!valid) safeStorageSet('sync', { model: state.settings.model });
    state.settings.theme  = data.theme  || 'light';
  }

  function saveModel(model) {
    state.settings.model = model;
    safeStorageSet('sync', { model });
  }

  function saveTheme(theme) {
    state.settings.theme = theme;
    safeStorageSet('sync', { theme });
    applyTheme();
  }

  function applyTheme() {
    if (!shadowRoot) return;
    const panel = shadowRoot.querySelector('#panel');
    if (panel) panel.setAttribute('data-theme', state.settings.theme);
  }

  // Documenti: persistiti in chrome.storage.local (10MB di spazio totale)
  // Salviamo solo il testo estratto, non i file binari originali.
  async function loadDocuments() {
    const data = await safeStorageGet('local', ['savedDocuments', 'selectedDocId']);
    if (Array.isArray(data.savedDocuments)) {
      state.documents = data.savedDocuments.map(d => ({
        name: d.name,
        type: d.type,
        text: d.text || '',
        sizeKB: d.sizeKB || 0,
        addedAt: d.addedAt || Date.now()
      }));
    }
    state.selectedDocId = data.selectedDocId || (state.documents.length ? '__all__' : null);
  }

  function saveDocuments() {
    const data = state.documents.map(d => ({
      name: d.name,
      type: d.type,
      text: d.text,
      sizeKB: d.sizeKB,
      addedAt: d.addedAt || Date.now()
    }));
    safeStorageSet('local', { savedDocuments: data });
  }

  // -----------------------------------------------------------
  // 3) CREAZIONE WIDGET (Shadow DOM)
  // -----------------------------------------------------------
  let shadowRoot = null;
  let host = null;

  function createWidget() {
    if (host) return;

    host = document.createElement('div');
    host.id = 'invitalia-ai-compiler-root';
    document.documentElement.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    shadowRoot.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .panel {
          /* --- TEMA CHIARO (default) --- */
          --bg:           #ffffff;
          --bg-soft:      #f5f5f5;
          --bg-input:     #ffffff;
          --border:       #e5e5e5;
          --border-soft:  #ededed;
          --text:         #0a0a0a;
          --text-soft:    #6b6b6b;
          --text-mute:    #9a9a9a;
          --accent:       #0a0a0a;
          --accent-text:  #ffffff;
          --hover:        #ebebeb;
          --ok:           #0a7a3e;
          --err:          #c43030;
          --warn:         #b07e00;
          --info:         #5a5a5a;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: var(--bg);
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06);
          border: 1px solid var(--border);
          color: var(--text);
          font-size: 13px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }
        .panel[data-theme="dark"] {
          --bg:           #0f0f0f;
          --bg-soft:      #1a1a1a;
          --bg-input:     #1a1a1a;
          --border:       #2a2a2a;
          --border-soft:  #232323;
          --text:         #f5f5f5;
          --text-soft:    #a8a8a8;
          --text-mute:    #6a6a6a;
          --accent:       #ffffff;
          --accent-text:  #0a0a0a;
          --hover:        #232323;
          --ok:           #4ade80;
          --err:          #f87171;
          --warn:         #facc15;
          --info:         #93c5fd;
        }
        .header {
          background: #0a0a0a;
          color: #ffffff;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: grab;
          user-select: none;
          border-bottom: 1px solid #0a0a0a;
        }
        .header:active { cursor: grabbing; }
        .header .title {
          flex: 1;
          font-weight: 600;
          font-size: 13px;
          letter-spacing: 0.1px;
          color: #ffffff;
        }
        .icon-btn {
          background: transparent;
          border: 0;
          color: #ffffff;
          width: 24px;
          height: 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 5px;
          cursor: pointer;
          font-size: 13px;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.15); }
        .view {
          padding: 8px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .field { display: flex; flex-direction: column; gap: 2px; }
        .field-label {
          font-size: 10.5px;
          font-weight: 600;
          color: var(--text-soft);
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        select, input[type="text"], input[type="password"] {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--border);
          border-radius: 4px;
          font-size: 12.5px;
          font-family: inherit;
          background: var(--bg-input);
          color: var(--text);
        }
        select:focus, input:focus { outline: none; border-color: var(--accent); }
        .row {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .icon-btn-inline {
          background: var(--bg-soft);
          border: 1px solid var(--border);
          border-radius: 5px;
          width: 28px;
          height: 28px;
          cursor: pointer;
          color: var(--text);
          flex-shrink: 0;
        }
        .icon-btn-inline:hover { background: var(--hover); }
        .actions {
          display: flex;
          gap: 6px;
        }
        .btn {
          flex: 1;
          padding: 8px 10px;
          border-radius: 5px;
          border: 1px solid var(--border);
          cursor: pointer;
          font-size: 12.5px;
          font-weight: 600;
          font-family: inherit;
          transition: all 0.12s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .btn-sm { padding: 5px 7px; font-size: 11px; }
        .btn-primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
        .btn-primary:hover:not(:disabled) { opacity: 0.85; }
        .btn-secondary { background: var(--bg-soft); color: var(--text); }
        .btn-secondary:hover:not(:disabled) { background: var(--hover); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .api-status {
          font-size: 11px;
          padding: 5px 8px;
          border-radius: 5px;
          margin-top: 2px;
          display: none;
          background: var(--bg-soft);
          border: 1px solid var(--border);
        }
        .api-status.ok    { display: block; color: var(--ok); }
        .api-status.err   { display: block; color: var(--err); }
        .api-status.info  { display: block; color: var(--info); }

        /* Accordion log */
        .log-accordion {
          border-top: 1px solid var(--border-soft);
          padding-top: 6px;
          margin-top: 2px;
        }
        .log-toggle {
          display: flex;
          align-items: center;
          gap: 5px;
          width: 100%;
          padding: 4px 2px;
          background: transparent;
          border: 0;
          cursor: pointer;
          font-size: 10px;
          font-weight: 600;
          color: var(--text-soft);
          font-family: inherit;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .log-toggle:hover { color: var(--text); }
        .log-arrow { display: inline-block; transition: transform 0.12s; font-size: 9px; }
        .log-toggle[aria-expanded="true"] .log-arrow { transform: rotate(90deg); }
        .log-count {
          margin-left: auto;
          background: var(--bg-soft);
          color: var(--text-soft);
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0;
          border: 1px solid var(--border);
        }
        .log {
          margin-top: 4px;
          padding: 8px;
          background: var(--bg-soft);
          color: var(--text);
          border-radius: 5px;
          font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
          font-size: 10px;
          max-height: 180px;
          overflow-y: auto;
          line-height: 1.5;
          border: 1px solid var(--border);
        }
        .log .line { white-space: pre-wrap; word-break: break-word; }
        .log .line.ok    { color: var(--ok); }
        .log .line.err   { color: var(--err); }
        .log .line.warn  { color: var(--warn); }
        .log .line.info  { color: var(--info); }

        /* Drop zone mini per impostazioni */
        .drop-zone-mini {
          border: 1px dashed var(--border);
          border-radius: 5px;
          padding: 8px;
          text-align: center;
          color: var(--text-soft);
          cursor: pointer;
          font-size: 11px;
          transition: all 0.12s;
          background: var(--bg-soft);
        }
        .drop-zone-mini:hover, .drop-zone-mini.dragover {
          border-color: var(--accent);
          color: var(--text);
        }
        .doc-list {
          margin-top: 4px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .doc-list:empty { display: none; }
        .doc-item {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 6px;
          background: var(--bg-soft);
          border: 1px solid var(--border);
          border-radius: 5px;
          font-size: 11px;
        }
        .doc-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .doc-item .remove,
        .doc-item .rename {
          background: none;
          border: 0;
          cursor: pointer;
          font-size: 11px;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          flex-shrink: 0;
          color: var(--text-soft);
        }
        .doc-item .rename:hover { color: var(--text); background: var(--hover); }
        .doc-item .remove:hover { color: var(--err); background: var(--hover); }
        .back-btn { margin-right: 2px; }
        /* Model picker (custom dropdown) */
        .model-picker { position: relative; }
        .mp-trigger {
          width: 100%;
          padding: 8px 10px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 5px;
          font-family: inherit;
          font-size: 12.5px;
          color: var(--text);
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .mp-trigger:hover { border-color: var(--text-soft); }
        .mp-trigger.open { border-color: var(--accent); }
        .mp-trigger-info { flex: 1; min-width: 0; }
        .mp-trigger-name { font-weight: 600; font-size: 12.5px; }
        .mp-trigger-desc { font-size: 11px; color: var(--text-soft); margin-top: 1px; }
        .mp-arrow { font-size: 9px; color: var(--text-soft); transition: transform 0.15s; flex-shrink: 0; }
        .mp-trigger.open .mp-arrow { transform: rotate(180deg); }

        /* Menu a COPERTURA INTERA del body del panel: elimina interferenze scroll */
        .mp-menu {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: var(--bg);
          z-index: 50;
          display: flex;
          flex-direction: column;
          padding: 0;
        }
        .mp-menu[hidden] { display: none; }
        .mp-menu-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-soft);
          text-transform: uppercase;
          letter-spacing: 0.4px;
          flex-shrink: 0;
        }
        .mp-menu-header .mp-menu-title { flex: 1; }
        .mp-menu-close {
          background: transparent;
          border: 0;
          font-size: 14px;
          color: var(--text-soft);
          cursor: pointer;
          width: 22px;
          height: 22px;
          border-radius: 4px;
          line-height: 1;
        }
        .mp-menu-close:hover { background: var(--hover); color: var(--text); }
        .mp-menu-list {
          flex: 1;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 4px;
        }
        .log {
          overscroll-behavior: contain;
        }
        .view {
          overscroll-behavior: contain;
        }
        .mp-menu[hidden] { display: none; }
        .mp-option {
          width: 100%;
          background: transparent;
          border: 0;
          padding: 8px 10px;
          font-family: inherit;
          color: var(--text);
          cursor: pointer;
          text-align: left;
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .mp-option:hover { background: var(--hover); }
        .mp-option.selected { background: var(--bg-soft); }
        .mp-option .mp-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .mp-option .mp-name { font-weight: 600; font-size: 12.5px; }
        .mp-option .mp-price {
          font-size: 10.5px;
          color: var(--text-soft);
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          white-space: nowrap;
        }
        .mp-option .mp-desc {
          font-size: 11px;
          color: var(--text-soft);
        }

        /* Theme switch */
        .theme-row {
          display: flex;
          gap: 4px;
          background: var(--bg-soft);
          border: 1px solid var(--border);
          border-radius: 5px;
          padding: 2px;
        }
        .theme-row button {
          flex: 1;
          background: transparent;
          border: 0;
          padding: 5px 8px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-soft);
          cursor: pointer;
          border-radius: 4px;
          font-family: inherit;
        }
        .theme-row button.active {
          background: var(--accent);
          color: var(--accent-text);
        }
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>

      <div class="panel" id="panel" data-theme="light">
        <div class="header" id="dragHandle">
          <button class="icon-btn back-btn" id="btnBack" title="Indietro" style="display:none">&#8592;</button>
          <span class="title" id="panelTitle">Compilatore (Universale)</span>
          <button class="icon-btn" id="btnSettings" title="Impostazioni">&#9881;</button>
          <button class="icon-btn" id="btnClose"    title="Chiudi">&times;</button>
        </div>

        <!-- VISTA MAIN ====================================================== -->
        <div class="view view-main" id="viewMain">
          <div class="field">
            <label class="field-label">Documento</label>
            <select id="docSelect">
              <option value="">— Nessun documento caricato —</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">Modello AI</label>
            <div class="model-picker" id="modelPickerMain"></div>
          </div>

          <div class="actions">
            <button class="btn btn-primary"   id="btnFill"  title="Compila i campi del form usando i documenti">
              <span id="fillLabel">Compila</span>
            </button>
            <button class="btn btn-secondary" id="btnClear" title="Svuota i campi e riabilita quelli disabilitati">
              Pulisci
            </button>
          </div>

          <div class="log-accordion">
            <button class="log-toggle" id="logToggle" aria-expanded="false">
              <span class="log-arrow">&#9656;</span>
              <span>Log</span>
              <span class="log-count" id="logCount">0</span>
            </button>
            <div class="log" id="log" style="display:none"></div>
          </div>
        </div>

        <!-- VISTA SETTINGS ================================================== -->
        <div class="view view-settings" id="viewSettings" style="display:none">
          <div class="field">
            <label class="field-label">OpenAI API Key</label>
            <div class="row">
              <input type="password" id="apiKeyInput" placeholder="sk-..." autocomplete="off" />
              <button class="icon-btn-inline" id="toggleApiKeyVis" title="Mostra/nascondi">&#128065;</button>
            </div>
            <div class="row">
              <button class="btn btn-primary btn-sm" id="saveApiKey">Salva</button>
              <button class="btn btn-secondary btn-sm" id="testApiKey">Test</button>
            </div>
            <div id="apiStatus" class="api-status"></div>
          </div>

          <div class="field">
            <label class="field-label">Modello predefinito</label>
            <div class="model-picker" id="modelPickerSettings"></div>
          </div>

          <div class="field">
            <label class="field-label">Documenti caricati</label>
            <div class="drop-zone-mini" id="dropZone">
              <span><b>+</b> Carica PDF o DOCX</span>
              <input type="file" id="fileInput" accept=".pdf,.docx" multiple style="display:none" />
            </div>
            <div class="doc-list" id="docList"></div>
          </div>

          <div class="field">
            <label class="field-label">Tema</label>
            <div class="theme-row">
              <button id="themeLight" class="active" data-theme="light">Chiaro</button>
              <button id="themeDark" data-theme="dark">Scuro</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Applica tema iniziale dopo creazione DOM
    setTimeout(() => applyTheme(), 0);

    bindUI();
    makeDraggable();
  }

  function bindUI() {
    const $ = (sel) => shadowRoot.querySelector(sel);

    // Header
    $('#btnClose').addEventListener('click', () => toggleWidget(false));
    $('#btnSettings').addEventListener('click', () => showView('settings'));
    $('#btnBack').addEventListener('click', () => showView('main'));

    // ---- VISTA MAIN ----
    // Dropdown documento
    const docSelect = $('#docSelect');
    docSelect.addEventListener('change', (e) => {
      state.selectedDocId = e.target.value || null;
      safeStorageSet('local', { selectedDocId: state.selectedDocId });
      invalidateDocsCache(); // forza ricalcolo testi al prossimo Compila
    });

    // Modello (custom dropdown in main)
    buildModelPicker($('#modelPickerMain'));

    // Azioni
    $('#btnFill').addEventListener('click', onFill);
    $('#btnClear').addEventListener('click', onClear);

    // Log accordion
    $('#logToggle').addEventListener('click', () => {
      const t = $('#logToggle'), l = $('#log');
      const isOpen = t.getAttribute('aria-expanded') === 'true';
      t.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      l.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) l.scrollTop = l.scrollHeight;
    });
    // Stop propagazione scroll in log e view
    ['#log', '.view'].forEach(sel => {
      const el = sel === '.view' ? shadowRoot.querySelectorAll(sel) : [shadowRoot.querySelector(sel)].filter(Boolean);
      el.forEach(node => node.addEventListener('wheel', (e) => {
        const atTop    = node.scrollTop === 0;
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
        if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
          e.preventDefault();
        }
        e.stopPropagation();
      }, { passive: false }));
    });

    // ---- VISTA SETTINGS ----
    // API key
    const apiInput = $('#apiKeyInput');
    apiInput.value = state.settings.apiKey || '';
    $('#toggleApiKeyVis').addEventListener('click', () => {
      apiInput.type = apiInput.type === 'password' ? 'text' : 'password';
    });
    $('#saveApiKey').addEventListener('click', () => {
      const k = apiInput.value.trim();
      if (!k.startsWith('sk-')) { setApiStatus('La API key deve iniziare con "sk-".', 'err'); return; }
      chrome.storage.sync.set({ apiKey: k }, () => {
        state.settings.apiKey = k;
        setApiStatus('✓ API key salvata.', 'ok');
      });
    });
    $('#testApiKey').addEventListener('click', async () => {
      const k = apiInput.value.trim();
      if (!k) { setApiStatus('Inserisci prima la API key.', 'err'); return; }
      setApiStatus('Test in corso…', 'info');
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${k}` }
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setApiStatus(`✓ OK — ${data?.data?.length || 0} modelli disponibili.`, 'ok');
      } catch (err) {
        setApiStatus(`✗ ${err.message}`, 'err');
      }
    });

    // Modello predefinito (custom dropdown in settings)
    buildModelPicker($('#modelPickerSettings'));

    // Tema chiaro/scuro
    function refreshThemeButtons() {
      const lt = $('#themeLight'), dk = $('#themeDark');
      if (state.settings.theme === 'dark') { dk.classList.add('active'); lt.classList.remove('active'); }
      else { lt.classList.add('active'); dk.classList.remove('active'); }
    }
    $('#themeLight').addEventListener('click', () => { saveTheme('light'); refreshThemeButtons(); });
    $('#themeDark').addEventListener('click', () => { saveTheme('dark'); refreshThemeButtons(); });
    refreshThemeButtons();

    // Upload documenti (nelle impostazioni)
    const dz = $('#dropZone');
    const fi = $('#fileInput');
    dz.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') fi.click();
    });
    fi.addEventListener('change', (e) => handleFiles(e.target.files));
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover');
    }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover');
    }));
    dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  }

  // Custom dropdown modelli: trigger compatto + menu aperto con costo+descrizione
  function buildModelPicker(container) {
    if (!container) return;
    const renderTrigger = () => {
      const m = MODELS.find(x => x.id === state.settings.model) || MODELS[0];
      container.querySelector('.mp-trigger-name').textContent = m.label;
      container.querySelector('.mp-trigger-desc').textContent = m.desc;
    };
    container.innerHTML = `
      <button type="button" class="mp-trigger" data-open="false">
        <span class="mp-trigger-info">
          <span class="mp-trigger-name"></span>
          <span class="mp-trigger-desc"></span>
        </span>
        <span class="mp-arrow">▼</span>
      </button>
    `;
    const trigger = container.querySelector('.mp-trigger');

    // Crea o riusa il menu condiviso, posizionato a copertura intera del panel body
    const panel = shadowRoot.querySelector('#panel');
    let menu = shadowRoot.querySelector('#mpSharedMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'mpSharedMenu';
      menu.className = 'mp-menu';
      menu.hidden = true;
      menu.innerHTML = `
        <div class="mp-menu-header">
          <span class="mp-menu-title">Scegli modello AI</span>
          <button type="button" class="mp-menu-close" title="Chiudi">&times;</button>
        </div>
        <div class="mp-menu-list">
          ${MODELS.map(m => `
            <button type="button" class="mp-option" data-id="${m.id}">
              <span class="mp-row">
                <span class="mp-name">${m.label}</span>
                <span class="mp-price">$${m.priceIn.toFixed(2)} in / $${m.priceOut.toFixed(2)} out per 1M</span>
              </span>
              <span class="mp-desc">${m.desc}</span>
            </button>
          `).join('')}
        </div>
      `;
      panel.appendChild(menu);

      // Stop propagazione scroll della lista
      const list = menu.querySelector('.mp-menu-list');
      list.addEventListener('wheel', (e) => {
        const atTop    = list.scrollTop === 0;
        const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
          e.preventDefault();
        }
        e.stopPropagation();
      }, { passive: false });

      // Click sulle opzioni
      menu.querySelectorAll('.mp-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = opt.dataset.id;
          saveModel(id);
          shadowRoot.querySelectorAll('.model-picker').forEach(c => {
            const t = c.querySelector('.mp-trigger-name');
            const d = c.querySelector('.mp-trigger-desc');
            const m = MODELS.find(x => x.id === id);
            if (t && m) t.textContent = m.label;
            if (d && m) d.textContent = m.desc;
          });
          closeMenu();
        });
      });

      menu.querySelector('.mp-menu-close').addEventListener('click', closeMenu);
    }

    function openMenu() {
      menu.querySelectorAll('.mp-option').forEach(o => {
        o.classList.toggle('selected', o.dataset.id === state.settings.model);
      });
      menu.hidden = false;
      shadowRoot.querySelectorAll('.mp-trigger').forEach(t => {
        t.classList.add('open'); t.dataset.open = 'true';
      });
    }
    function closeMenu() {
      menu.hidden = true;
      shadowRoot.querySelectorAll('.mp-trigger').forEach(t => {
        t.classList.remove('open'); t.dataset.open = 'false';
      });
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (trigger.dataset.open === 'true') closeMenu();
      else openMenu();
    });

    renderTrigger();
  }

  function setApiStatus(msg, level = 'info') {
    const el = shadowRoot.querySelector('#apiStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = `api-status ${level}`;
  }

  function showView(name) {
    const main = shadowRoot.querySelector('#viewMain');
    const settings = shadowRoot.querySelector('#viewSettings');
    const back = shadowRoot.querySelector('#btnBack');
    const settingsBtn = shadowRoot.querySelector('#btnSettings');
    const title = shadowRoot.querySelector('#panelTitle');
    if (name === 'settings') {
      main.style.display = 'none';
      settings.style.display = 'flex';
      back.style.display = '';
      settingsBtn.style.display = 'none';
      title.textContent = 'Impostazioni';
    } else {
      main.style.display = 'flex';
      settings.style.display = 'none';
      back.style.display = 'none';
      settingsBtn.style.display = '';
      title.textContent = 'Compilatore (Universale)';
    }
  }


  // -----------------------------------------------------------
  // 4) DRAG & DROP DEL WIDGET
  // -----------------------------------------------------------
  function makeDraggable() {
    const handle = shadowRoot.querySelector('#dragHandle');
    let dragging = false, startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

    // Carica posizione salvata
    safeStorageGet('local', ['widgetPos']).then(data => {
      if (data?.widgetPos && host) {
        const { left, top } = data.widgetPos;
        if (typeof left === 'number') {
          host.style.left = left + 'px';
          host.style.right = 'auto';
        }
        if (typeof top === 'number') host.style.top = top + 'px';
      }
    });

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const rect = host.getBoundingClientRect();
      dragging = true;
      baseLeft = rect.left;
      baseTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      handle.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      const newLeft = Math.max(0, Math.min(window.innerWidth - w, baseLeft + dx));
      const newTop  = Math.max(0, Math.min(window.innerHeight - 40, baseTop + dy)); // lascia almeno 40px header sotto
      host.style.left  = newLeft + 'px';
      host.style.right = 'auto'; // libera dall'ancoraggio destro
      host.style.top   = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = '';
      // Salva posizione
      const rect = host.getBoundingClientRect();
      safeStorageSet('local', { widgetPos: { left: rect.left, top: rect.top } });
    });
  }

  // -----------------------------------------------------------
  // 5) TOGGLE / REOPEN
  // -----------------------------------------------------------
  let reopenBtn = null;
  function toggleWidget(open) {
    state.widgetOpen = open;
    if (open) {
      if (host) host.style.display = '';
      if (reopenBtn) { reopenBtn.remove(); reopenBtn = null; }
    } else {
      if (host) host.style.display = 'none';
      reopenBtn = document.createElement('button');
      reopenBtn.textContent = 'Compilatore (Universale)';
      reopenBtn.title = 'Apri Compilatore (Universale)';
      reopenBtn.style.cssText = `
        position: fixed; top: 80px; right: 24px; z-index: 2147483647;
        background: #0a0a0a; color: #ffffff;
        border: 1px solid #0a0a0a;
        padding: 9px 16px; border-radius: 999px; cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        font-size: 12px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        letter-spacing: 0.2px;
        white-space: nowrap;
      `;
      reopenBtn.addEventListener('mouseenter', () => { reopenBtn.style.background = '#1a1a1a'; });
      reopenBtn.addEventListener('mouseleave', () => { reopenBtn.style.background = '#0a0a0a'; });
      reopenBtn.addEventListener('click', () => toggleWidget(true));
      document.documentElement.appendChild(reopenBtn);
    }
  }

  // -----------------------------------------------------------
  // 6) LOGGING
  // -----------------------------------------------------------
  function log(msg, level = 'info') {
    const el = shadowRoot?.querySelector('#log');
    if (!el) { console.log('[Invitalia AI]', msg); return; }
    const div = document.createElement('div');
    div.className = `line ${level}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    // Aggiorna contatore log
    const countEl = shadowRoot.querySelector('#logCount');
    if (countEl) countEl.textContent = el.children.length;
  }

  // Verifica che il context dell'estensione sia ancora valido. Se l'utente ha
  // ricaricato l'estensione mentre la pagina era aperta, chrome.runtime.id sparisce.
  function isExtensionContextValid() {
    try { return !!(chrome?.runtime?.id); } catch (_) { return false; }
  }

  function handleContextInvalidated() {
    log('⚠ Estensione aggiornata o disabilitata: ricarica la pagina (F5) per continuare.', 'err');
    setWorking(false);
  }

  // -----------------------------------------------------------
  // 7) UPLOAD & PARSING DOCUMENTI
  // -----------------------------------------------------------
  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['pdf', 'docx'].includes(ext)) {
        log(`Formato non supportato: ${file.name}`, 'warn');
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        log(`File troppo grande (>20MB): ${file.name}`, 'warn');
        continue;
      }
      // Evita duplicati per nome
      if (state.documents.some(d => d.name === file.name)) {
        log(`"${file.name}" già caricato. Eliminalo prima per ricaricarlo.`, 'warn');
        continue;
      }
      try {
        log(`Estrazione testo da ${file.name}…`, 'info');
        const text = await extractText(file, ext);
        state.documents.push({
          name: file.name,
          type: ext,
          text,
          sizeKB: Math.round(file.size / 1024),
          addedAt: Date.now()
        });
        saveDocuments();
        log(`✓ ${file.name} (${text.length} caratteri estratti, salvato)`, 'ok');
        renderDocList();
      } catch (err) {
        log(`Errore con ${file.name}: ${err.message}`, 'err');
      }
    }
  }

  function renameDocument(index) {
    const d = state.documents[index];
    if (!d) return;
    const oldName = d.name;
    const newName = prompt(`Rinomina documento:\n\n(estensione "${d.type}" mantenuta automaticamente)`, oldName.replace(/\.[^.]+$/, ''));
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) { log('Nome non valido.', 'warn'); return; }
    // Re-aggiungo l'estensione se l'utente l'ha tolta
    const finalName = trimmed.endsWith('.' + d.type) ? trimmed : `${trimmed}.${d.type}`;
    if (state.documents.some((x, i) => i !== index && x.name === finalName)) {
      log(`Esiste già un documento "${finalName}".`, 'warn'); return;
    }
    d.name = finalName;
    saveDocuments();
    renderDocList();
    log(`Rinominato: "${oldName}" → "${finalName}"`, 'ok');
  }

  function deleteDocument(index) {
    const d = state.documents[index];
    if (!d) return;
    if (!confirm(`Eliminare "${d.name}"?\n\nIl documento verrà rimosso dallo storage dell'estensione.`)) return;
    state.documents.splice(index, 1);
    saveDocuments();
    renderDocList();
    log(`Eliminato: "${d.name}"`, 'info');
  }

  async function extractText(file, ext) {
    const buf = await file.arrayBuffer();
    if (ext === 'pdf') return await extractPdf(buf);
    if (ext === 'docx') return await extractDocx(buf);
    throw new Error('Formato non gestito');
  }

  async function extractPdf(buffer) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('pdf.js non caricato');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const pageText = tc.items.map(it => it.str).join(' ');
      fullText += `\n\n--- Pagina ${i} ---\n${pageText}`;
    }
    return fullText.trim();
  }

  async function extractDocx(buffer) {
    if (typeof mammoth === 'undefined') {
      throw new Error('mammoth.js non caricato');
    }
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return (result?.value || '').trim();
  }

  function renderDocList() {
    if (!shadowRoot) return;
    const list = shadowRoot.querySelector('#docList');
    const docSelect = shadowRoot.querySelector('#docSelect');

    // Lista documenti nelle impostazioni
    if (list) {
      list.innerHTML = '';
      state.documents.forEach((d, i) => {
        const item = document.createElement('div');
        item.className = 'doc-item';
        const date = d.addedAt ? new Date(d.addedAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '';
        const safeName = String(d.name).replace(/</g, '&lt;');
        item.innerHTML = `
          <span class="name" title="${safeName}\nAggiunto: ${date}\n${d.sizeKB} KB · ${d.text.length} caratteri">${safeName}</span>
          <button class="rename" data-i="${i}" title="Rinomina">&#9998;</button>
          <button class="remove" data-i="${i}" title="Elimina">&times;</button>
        `;
        item.querySelector('.rename').addEventListener('click', () => renameDocument(i));
        item.querySelector('.remove').addEventListener('click', () => deleteDocument(i));
        list.appendChild(item);
      });
    }

    // Dropdown documento nel widget main
    if (docSelect) {
      const prev = state.selectedDocId || docSelect.value || '';
      docSelect.innerHTML = '';
      if (state.documents.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— Carica documenti dalle impostazioni ⚙ —';
        docSelect.appendChild(opt);
      } else {
        const allOpt = document.createElement('option');
        allOpt.value = '__all__';
        allOpt.textContent = `Tutti i documenti (${state.documents.length})`;
        docSelect.appendChild(allOpt);
        state.documents.forEach(d => {
          const o = document.createElement('option');
          o.value = d.name;
          o.textContent = d.name.length > 40 ? d.name.slice(0, 38) + '…' : d.name;
          docSelect.appendChild(o);
        });
        // Ripristina selezione
        if (prev && Array.from(docSelect.options).some(o => o.value === prev)) {
          docSelect.value = prev;
          state.selectedDocId = prev;
        } else {
          docSelect.value = '__all__';
          state.selectedDocId = '__all__';
        }
      }
    }
  }

  // Restituisce i documenti effettivamente da inviare all'AI in base alla selezione
  function getActiveDocuments() {
    if (!state.documents.length) return [];
    const sel = state.selectedDocId;
    if (!sel || sel === '__all__') return state.documents;
    const found = state.documents.find(d => d.name === sel);
    return found ? [found] : state.documents;
  }

  // ---------------------------------------------------------------------------
  // VALIDAZIONE DETERMINISTICA ANTI-INVENZIONE
  // Verifica che il valore proposto dall'AI esista davvero nei documenti.
  // Per booleani/numeri brevi salta il check. Per stringhe usa match diretto +
  // fallback compresso (rimuove spazi, punti, trattini).
  // ---------------------------------------------------------------------------
  let _normalizedDocsCache = null;
  function getNormalizedDocsText() {
    if (_normalizedDocsCache !== null) return _normalizedDocsCache;
    const all = getActiveDocuments().map(d => d.text).join(' ').toLowerCase();
    _normalizedDocsCache = {
      raw: all,
      compressed: all.replace(/[\s.\-_/]/g, '')
    };
    return _normalizedDocsCache;
  }
  function invalidateDocsCache() {
    _normalizedDocsCache = null;
    if (typeof _wordRegexCache !== 'undefined') _wordRegexCache.clear();
  }

  // Lista di campi "strutturali" Sede operativa che possono essere copiati
  // dalla Sede legale anche se non presenti nei documenti (mirror coincide)
  const MIRROR_ALLOWED_FORMCONTROLS = new Set([
    'indirizzo', 'cap', 'numeroCivico', 'nazione', 'regione',
    'provincia', 'comune', 'codiceCatastale', 'frazione'
  ]);

  // Campi deducibili dal Codice Fiscale italiano (se presente nei docs)
  // CF struttura: AAAAAAYYMSSCNNNX → anno (YY), mese (M), giorno+sesso (SS), comune (CCNN), check (X)
  const CF_INFERABLE_FIELDS = new Set([
    'sesso', 'genere',
    'datanascita', 'datadinascita', 'birthdate', 'dataNascita', 'dataDiNascita',
    'luogonascita', 'comunenascita', 'comuneNascita', 'provincianascita', 'provinciaNascita',
    'nazionenascita', 'nazioneNascita', 'natoa', 'natoA'
  ]);

  function hasCodiceFiscaleInDocs() {
    const cfRegex = /\b[a-z]{6}\d{2}[a-z]\d{2}[a-z]\d{3}[a-z]\b/i;
    return cfRegex.test(getNormalizedDocsText().raw);
  }

  // Campi per cui l'AI può fare INFERENZA da contesto (no validazione letterale richiesta).
  function isInferableField(field) {
    if (field.kind === 'mat-checkbox' || field.kind === 'checkbox') return true;
    const fc = (field.formControlName || '').toLowerCase();
    // Pattern: is*, has*, flag*, coincide* → booleani
    if (/^(is|has|flag|coincide|accept|consent)/i.test(fc)) return true;
    // mat-select con label terminante in "?" o options binarie Sì/No
    if (field.kind === 'mat-select') {
      const lbl = (field.label || '').trim();
      if (/\?$/.test(lbl)) return true;
      // Se le options sono solo binarie sì/no
      const opts = (field.options || []).map(o => String(o.label || o).toLowerCase().trim());
      if (opts.length > 0 && opts.length <= 2 &&
          opts.every(o => /^(s[iì]|no|true|false|yes)$/.test(o))) return true;
    }
    // Campi sesso/genere → mat-select binario sempre inferibile
    if (fc === 'sesso' || fc === 'genere') return true;
    // Campi deducibili dal Codice Fiscale (se presente nei docs)
    if (CF_INFERABLE_FIELDS.has(fc) && hasCodiceFiscaleInDocs()) return true;
    return false;
  }

  // Stop-words italiane comuni che non contano come "match significativo"
  const STOP_WORDS = new Set([
    'via', 'viale', 'piazza', 'corso', 'strada', 'largo', 'vicolo',
    'della', 'delle', 'dello', 'degli', 'sulla', 'sulle', 'sullo',
    'con', 'per', 'che', 'come', 'sono', 'questo', 'quella', 'questa',
    'tutti', 'tutte', 'tutto', 'tutta', 'molto', 'anche', 'ancora',
    'italia', 'italiana', 'italiano', 'srl', 'spa', 'sas', 'snc'
  ]);

  function valueIsInDocs(value, field) {
    // Booleani: accettiamo decisione AI
    if (typeof value === 'boolean') return true;
    // Campi inferibili (Sì/No, checkbox, sesso, dataCF) → accettiamo decisione AI
    if (isInferableField(field)) return true;
    const sval = String(value).trim();
    if (!sval || sval.length < 2) return true; // valori troppo brevi: skip check

    const docs = getNormalizedDocsText();
    const v = sval.toLowerCase();

    // 1) Match diretto (sostringa)
    if (docs.raw.includes(v)) return true;

    // 2) Match compresso (per CF/PIVA/IBAN/telefono con/senza spazi/punti)
    const compress = s => s.replace(/[\s.\-_/]/g, '');
    if (docs.compressed.includes(compress(v))) return true;

    // 3) Email: cerca parte locale (almeno 4 char)
    if (v.includes('@')) {
      const local = v.split('@')[0];
      if (local.length >= 4 && docs.raw.includes(local)) return true;
    }

    // 4) Stringhe lunghe (>15 char): match per parole chiave significative (cached regex)
    if (sval.length > 15) {
      const words = v.split(/[\s,;:.()/-]+/)
        .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
      if (words.length >= 2) {
        const matched = words.filter(w => wordInDocs(w, docs.raw)).length;
        if (matched / words.length >= 0.75) return true;
      }
    }
    return false;
  }

  // Cache regex word-boundary (evita ricreazione per ogni parola)
  const _wordRegexCache = new Map();
  function wordInDocs(word, docsText) {
    let re = _wordRegexCache.get(word);
    if (!re) {
      re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      _wordRegexCache.set(word, re);
    }
    return re.test(docsText);
  }

  // Override per sede operativa quando il campo è mirrorable da sede legale
  function isMirrorableFromSedeLegale(field) {
    if (!field.section) return false;
    const sec = field.section.toLowerCase();
    if (!sec.includes('operativa')) return false;
    return MIRROR_ALLOWED_FORMCONTROLS.has(field.formControlName);
  }

  // -----------------------------------------------------------
  // 8) FORM SCANNING — Angular Material / PrimeNG / native
  // -----------------------------------------------------------
  function getLabel(el) {
    // 1) <label for="id">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent?.trim()) return clean(lbl.textContent);
    }
    // 2) aria-label / aria-labelledby
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    if (el.getAttribute('aria-labelledby')) {
      const ids = el.getAttribute('aria-labelledby').split(/\s+/);
      const txt = ids.map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (txt) return clean(txt);
    }
    // 3) placeholder
    if (el.placeholder) return clean(el.placeholder);
    // 4) mat-label dentro mat-form-field
    const mff = el.closest('mat-form-field');
    if (mff) {
      const ml = mff.querySelector('mat-label');
      if (ml?.textContent?.trim()) return clean(ml.textContent);
    }
    // 5) label PrimeNG: cerca .p-float-label o sibling
    const pff = el.closest('.p-field, .field, .form-group, .ui-inputgroup');
    if (pff) {
      const lbl = pff.querySelector('label');
      if (lbl?.textContent?.trim()) return clean(lbl.textContent);
    }
    // 6) nome o id
    return clean(el.name || el.id || '');
  }

  function clean(str) {
    return (str || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();
  }

  function inferFieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    const t = (el.type || 'text').toLowerCase();
    if (['checkbox', 'radio', 'date', 'email', 'number', 'tel', 'url'].includes(t)) return t;
    return 'text';
  }

  function getOptions(el) {
    if (el.tagName.toLowerCase() === 'select') {
      return Array.from(el.options).map(o => ({ value: o.value, label: o.textContent.trim() })).filter(o => o.label);
    }
    return null;
  }

  function isFillable(el) {
    if (el.disabled) return false;
    if (el.readOnly) return false;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'file') return false;
    if (el.offsetParent === null && el.type !== 'hidden') return false; // non visibile
    return true;
  }

  function getFormControlName(el) {
    return el.getAttribute('formcontrolname')
        || el.getAttribute('ng-reflect-name')
        || el.closest('[formcontrolname]')?.getAttribute('formcontrolname')
        || null;
  }

  // ---- CONTESTO SEZIONE -----------------------------------------------------
  // Macro-sezione: pagina attiva nella nav laterale (Impresa proponente,
  // Rappresentante legale, Delegato, ...) oppure ultima slug dell'URL.
  function getPageSection() {
    // 1) Link "active" nella nav laterale
    const activeLink = document.querySelector(
      'a.is-active, a.active, a.mat-list-item-active, [aria-current="page"]'
    );
    if (activeLink?.textContent?.trim()) return clean(activeLink.textContent);

    // 2) Slug dall'URL (es. /richiesta-finanziamento/rappresentante-legale)
    const slug = location.pathname.split('/').filter(Boolean).pop() || '';
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // Sotto-sezione (step interno della pagina, es. Anagrafica, Sede legale,
  // Sede operativa, Contatti Sede Legale)
  function findStepSection(el) {
    // a) mat-step contenitore (Angular Material stepper)
    const matStep = el.closest('mat-step, [class*="mat-step"]');
    if (matStep) {
      // Lo step header per quello step può essere uno step-header con stesso indice
      const allStepHeaders = Array.from(document.querySelectorAll('mat-step-header, .mat-step-header'));
      // Header più vicino verso l'alto nel DOM
      const previousHeader = previousMatchingNode(el, 'mat-step-header, .mat-step-header, .mat-step-text-label, .step-text-label');
      if (previousHeader?.textContent?.trim()) return clean(previousHeader.textContent);
    }
    // b) Heading h2/h3 più vicino verso l'alto
    const prevHeading = previousMatchingNode(el, 'h2, h3, mat-card-title, [class*="section-title"], [class*="step-text-label"]');
    if (prevHeading?.textContent?.trim()) return clean(prevHeading.textContent);
    // c) fieldset/legend
    const fs = el.closest('fieldset');
    const lg = fs?.querySelector('legend');
    if (lg?.textContent?.trim()) return clean(lg.textContent);
    return '';
  }

  // Cerca il nodo precedente (in document order) che match un selettore CSS.
  function previousMatchingNode(start, selector) {
    let node = start;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    walker.currentNode = node;
    while (walker.previousNode()) {
      const cur = walker.currentNode;
      if (cur && cur.matches && cur.matches(selector)) return cur;
    }
    return null;
  }

  function getSectionContext(el) {
    const page = getPageSection();
    const step = findStepSection(el);
    return [page, step].filter(Boolean).join(' › ');
  }

  function getMatLabel(el) {
    // 1) data-placeholder sull'input/textarea (Angular Material lo setta dal mat-label)
    if (el.dataset?.placeholder) return clean(el.dataset.placeholder);
    // 2) mat-form-field contenitore
    const mff = el.closest('mat-form-field');
    if (!mff) return '';
    // a) <mat-label> esplicito
    const ml = mff.querySelector('mat-label');
    if (ml?.textContent?.trim()) return clean(ml.textContent);
    // b) <span class="mat-form-field-label"> renderizzato
    const lblWrap = mff.querySelector('.mat-form-field-label, .mat-form-field-label-wrapper label');
    if (lblWrap?.textContent?.trim()) return clean(lblWrap.textContent);
    // c) data-placeholder su un input figlio (caso mat-select)
    const innerInput = mff.querySelector('input[data-placeholder]');
    if (innerInput?.dataset?.placeholder) return clean(innerInput.dataset.placeholder);
    return '';
  }

  function isMatSelectVisible(matSel) {
    return matSel.offsetParent !== null;
  }

  // NOTA ARCHITETTURALE:
  // Tutta la logica Angular-aware (lettura __ngContext__, enable() FormControl,
  // setValue() / writeValue() su MatSelect, ecc.) è nel page-bridge.js (MAIN world).
  // Il content.js gira in isolated world dove __ngContext__ non è accessibile.
  // Per qualsiasi operazione su istanze Angular usa bridgeCall(op, {bridgeId, ...}).

  function scanForm() {
    const fields = [];
    let idx = 0;

    // 1) Input/textarea/select nativi (esclude quelli interni a mat-select / mat-checkbox / mat-radio)
    const all = document.querySelectorAll('input, select, textarea');
    all.forEach((el) => {
      if (el.closest('mat-select')) return;          // input nascosto interno a mat-select
      if (el.closest('mat-checkbox')) return;        // gestito come mat-checkbox a parte
      if (el.closest('mat-radio-button')) return;    // gestito come mat-radio a parte (TODO)
      if (!isFillable(el)) return;
      const type = inferFieldType(el);
      if (type === 'radio') {
        const name = el.name;
        if (!name || fields.some(f => f.kind === 'radio-group' && f.name === name)) return;
        const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
        const opts = Array.from(group).map(r => ({ value: r.value, label: getLabel(r) || r.value }));
        const repr = group[0];
        fields.push({
          ref: `f${idx++}`,
          kind: 'radio-group',
          name,
          label: getLabel(repr) || name,
          formControlName: getFormControlName(repr),
          section: getSectionContext(repr),
          options: opts,
          element: repr
        });
      } else {
        fields.push({
          ref: `f${idx++}`,
          kind: type,
          label: getLabel(el) || getMatLabel(el),
          formControlName: getFormControlName(el),
          section: getSectionContext(el),
          required: el.required,
          maxLength: el.maxLength > 0 ? el.maxLength : null,
          options: getOptions(el),
          element: el
        });
      }
    });

    // 2) mat-select (Angular Material custom select) — includi anche se disabled,
    //    proveremo a sbloccarli a runtime (lo scopo dell'estensione è proprio compilare campi disabled)
    document.querySelectorAll('mat-select').forEach((ms) => {
      if (!isMatSelectVisible(ms)) return;
      const lbl = getMatLabel(ms) || getLabel(ms) || '';
      fields.push({
        ref: `f${idx++}`,
        kind: 'mat-select',
        label: lbl,
        formControlName: getFormControlName(ms),
        section: getSectionContext(ms),
        currentValue: ms.querySelector('.mat-select-value-text')?.textContent?.trim() || null,
        wasDisabled: ms.classList.contains('mat-select-disabled') || ms.getAttribute('aria-disabled') === 'true',
        element: ms
      });
    });

    // 3) mat-checkbox (Angular Material custom checkbox)
    document.querySelectorAll('mat-checkbox').forEach((mc) => {
      if (mc.offsetParent === null) return; // non visibile
      const innerInput = mc.querySelector('input[type="checkbox"]');
      const lbl = clean(mc.querySelector('.mat-checkbox-label, label')?.textContent || '')
               || getMatLabel(innerInput || mc)
               || mc.getAttribute('aria-label')
               || '';
      const fc = mc.getAttribute('ng-reflect-name')
              || innerInput?.getAttribute('formcontrolname')
              || mc.getAttribute('formcontrolname');
      fields.push({
        ref: `f${idx++}`,
        kind: 'mat-checkbox',
        label: lbl,
        formControlName: fc,
        section: getSectionContext(mc),
        currentValue: !!innerInput?.checked || mc.classList.contains('mat-checkbox-checked'),
        element: mc
      });
    });

    return fields;
  }

  // -----------------------------------------------------------
  // 9) FORM FILLING
  // -----------------------------------------------------------
  function setNativeValue(el, value) {
    const tag = el.tagName.toLowerCase();
    const proto = tag === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fireEvents(el, events = ['input', 'change', 'blur']) {
    events.forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
  }

  // Compila un mat-select via bridge MAIN world. Strategia ibrida:
  // - Primo passo: setValue veloce (Angular FormControl)
  // - Retry: realClick=true → vero click DOM sull'opzione (scatena fetch HTTP a cascata)
  async function fillMatSelect(matSel, value, opts = {}) {
    const bridgeId = tagForBridge(matSel);
    const res = await bridgeCall('fillMatSelect', { bridgeId, value, options: opts });
    if (!res.ok) {
      const fcn = matSel.getAttribute('formcontrolname') || '';
      if (res.availableOptions) {
        log(`Opzione "${value}" non trovata per "${fcn}". Disponibili: ${res.availableOptions.join(' | ')}`, 'warn');
      } else if (!opts.realClick) {
        // Silenzioso al primo tentativo: il retry farà il vero log
      } else {
        log(`✗ mat-select "${fcn}" — ${res.error || 'errore sconosciuto'}`, 'warn');
      }
      return false;
    }
    return true;
  }

  // Riabilita TUTTI i campi del form via bridge MAIN world (Angular-aware).
  async function softEnableAll() {
    const res = await bridgeCall('softEnableAll', {}, 8000);
    return res?.count || 0;
  }

  async function fillField(field, value) {
    if (value === null || value === undefined || value === '') return false;
    const el = field.element;
    if (!el) return false;

    try {
      switch (field.kind) {
        case 'text':
        case 'textarea':
        case 'email':
        case 'tel':
        case 'url':
        case 'number':
        case 'date': {
          // Delega al bridge MAIN world (Angular-aware: setta sia FormControl che DOM)
          const bridgeId = tagForBridge(el);
          const res = await bridgeCall('fillNativeInput', { bridgeId, value: String(value) });
          if (res?.ok) return true;
          // Fallback DOM-only se il bridge non risponde
          setNativeValue(el, String(value));
          fireEvents(el);
          return true;
        }
        case 'select': {
          if (!isFillable(el)) return false;
          const v = String(value).toLowerCase();
          const opt = Array.from(el.options).find(o =>
            o.value.toLowerCase() === v ||
            o.textContent.trim().toLowerCase() === v ||
            o.textContent.trim().toLowerCase().includes(v)
          );
          if (!opt) return false;
          el.value = opt.value;
          fireEvents(el, ['input', 'change']);
          return true;
        }
        case 'mat-select': {
          if (!isMatSelectVisible(el)) return false;
          return await fillMatSelect(el, value, field._retryRealClick ? { realClick: true } : {});
        }
        case 'checkbox': {
          if (!isFillable(el)) return false;
          const want = (value === true || /^(true|1|si|sì|yes|y|on)$/i.test(String(value)));
          if (el.checked !== want) el.click();
          return true;
        }
        case 'mat-checkbox': {
          if (el.offsetParent === null) return false;
          const bridgeId = tagForBridge(el);
          const res = await bridgeCall('fillMatCheckbox', { bridgeId, value });
          if (!res.ok) {
            log(`✗ mat-checkbox "${field.formControlName || field.label}" — ${res.error || 'errore'}`, 'warn');
            return false;
          }
          return true;
        }
        case 'radio-group': {
          const v = String(value).toLowerCase();
          const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(field.name)}"]`);
          let target = null;
          radios.forEach(r => {
            const lbl = (getLabel(r) || '').toLowerCase();
            if (r.value.toLowerCase() === v || lbl === v || lbl.includes(v)) target = r;
          });
          if (target) { target.click(); return true; }
          return false;
        }
        default:
          return false;
      }
    } catch (err) {
      log(`Errore compilazione "${field.label}": ${err.message}`, 'err');
      return false;
    }
  }

  // -----------------------------------------------------------
  // 10) PULISCI: svuota + riabilita campi disabled/readonly
  // -----------------------------------------------------------
  async function onClear() {
    if (!confirm('Sicuro di voler svuotare e riabilitare tutti i campi del form?')) return;
    if (state.isWorking) return;
    setWorking(true);

    // 0) Sblocca FormControl Angular tramite il bridge MAIN world
    //    (essenziale: il solo cleanup DOM non sblocca i FormControl interni)
    try {
      const enabled = await softEnableAll();
      if (enabled > 0) log(`Pulisci: riabilitati ${enabled} campi a livello Angular.`, 'info');
    } catch (_) { /* bridge non disponibile, prosegui col cleanup DOM */ }

    let cleared = 0, reenabled = 0;

    // 1) input / select / textarea nativi
    document.querySelectorAll('input, select, textarea').forEach(el => {
      const t = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'file', 'image', 'reset'].includes(t)) return;

      if (el.disabled) { el.disabled = false; reenabled++; }
      if (el.readOnly) { el.readOnly = false; reenabled++; }
      el.removeAttribute('readonly');
      el.removeAttribute('disabled');

      if (t === 'checkbox' || t === 'radio') {
        if (el.checked) { el.checked = false; fireEvents(el, ['input', 'change']); cleared++; }
      } else if (el.tagName.toLowerCase() === 'select') {
        if (el.value) { el.value = ''; fireEvents(el, ['input', 'change']); cleared++; }
      } else if (el.value) {
        setNativeValue(el, '');
        fireEvents(el);
        cleared++;
      }
    });

    // 2) mat-select disabilitati: rimuovi attributi e classi, poi prova a "resettare" la selezione
    document.querySelectorAll('mat-select').forEach(ms => {
      if (ms.classList.contains('mat-select-disabled')) {
        ms.classList.remove('mat-select-disabled');
        reenabled++;
      }
      ms.setAttribute('aria-disabled', 'false');
      ms.removeAttribute('aria-disabled');
      const valueEl = ms.querySelector('.mat-select-value-text');
      if (valueEl && valueEl.textContent.trim()) {
        valueEl.textContent = '';
        cleared++;
      }
      // Tenta di rimuovere ng-reflect-disabled
      ms.removeAttribute('ng-reflect-disabled');
    });

    // 3) Rimuovi classi wrapper Angular Material / PrimeNG
    document.querySelectorAll(
      '.mat-form-field-disabled, .mat-form-field-readonly, .mat-input-disabled, .ng-disabled, .p-disabled'
    ).forEach(el => {
      el.classList.remove(
        'mat-form-field-disabled', 'mat-form-field-readonly', 'mat-input-disabled',
        'ng-disabled', 'p-disabled'
      );
    });

    // 4) Rimuovi attributo disabled da bottoni tipo "Salva/Aggiorna" (per consentire l'invio finale all'utente)
    document.querySelectorAll('button[disabled]').forEach(b => {
      b.disabled = false;
      b.removeAttribute('disabled');
      b.classList.remove('mat-button-disabled');
      reenabled++;
    });

    log(`Pulizia: svuotati ${cleared} campi, riabilitati ${reenabled} elementi DOM.`, 'ok');
    setWorking(false);
  }

  // -----------------------------------------------------------
  // 11) COMPILA: orchestrazione AI
  // -----------------------------------------------------------
  async function onFill() {
    if (state.isWorking) return;
    if (!state.settings.apiKey) {
      log('Configura prima la API key OpenAI nelle Impostazioni.', 'err');
      showView('settings');
      return;
    }
    if (state.documents.length === 0) {
      log('Carica almeno un documento dalle Impostazioni ⚙ prima di compilare.', 'warn');
      showView('settings');
      return;
    }
    const active = getActiveDocuments();
    if (!active.length) {
      log('Seleziona un documento valido dal dropdown.', 'warn');
      return;
    }

    if (!isExtensionContextValid()) { handleContextInvalidated(); return; }

    setWorking(true);
    try {
      // Auto-sblocco preventivo via bridge MAIN world (sblocca FormControl Angular)
      const enabled = await softEnableAll();
      if (enabled > 0) log(`Riabilitati ${enabled} campi/elementi prima della compilazione.`, 'info');

      const fields = scanForm();
      if (fields.length === 0) {
        log('Nessun campo compilabile trovato sulla pagina.', 'warn');
        return;
      }
      const matSelects = fields.filter(f => f.kind === 'mat-select').length;
      log(`Trovati ${fields.length} campi (${matSelects} mat-select). Invio a ${state.settings.model}…`, 'info');

      const mapping = await askAI(fields);
      if (!mapping) {
        log('Nessuna risposta valida dall\'AI.', 'err');
        return;
      }

      let ok = 0, fail = 0, skipped = 0, hallucinated = 0;
      const perSection = {}; // {sectionName: {ok, fail, skipped}}
      const failedFields = []; // per retry tecnico (DOM)
      const skippedFields = []; // per retry AI (second-pass)
      invalidateDocsCache();

      // PERFORMANCE: separa input nativi (parallelizzabili) da mat-select/checkbox (sequenziali)
      const nativeFields = [];
      const sequentialFields = [];
      for (const f of fields) {
        const sec = f.section || '(senza sezione)';
        perSection[sec] = perSection[sec] || { ok: 0, fail: 0, skipped: 0 };
        const v = mapping[f.ref];
        if (v === undefined || v === null || v === '') {
          skipped++; perSection[sec].skipped++;
          skippedFields.push(f);
          continue;
        }
        if (!valueIsInDocs(v, f) && !isMirrorableFromSedeLegale(f)) {
          hallucinated++; perSection[sec].skipped++;
          log(`⚠ [${sec}] "${f.label || f.formControlName}" = "${String(v).slice(0,60)}" — IGNORATO: non trovato nei documenti`, 'warn');
          continue;
        }
        if (f.kind === 'mat-select' || f.kind === 'mat-checkbox') {
          sequentialFields.push({ f, v, sec });
        } else {
          nativeFields.push({ f, v, sec });
        }
      }

      // ORDINE: prima mat-checkbox, poi mat-select, infine input nativi (batch).
      // Motivo: i mat-select cross-field (sesso, dimensione...) triggerano validators che
      // resettano i campi nativi correlati (es. CF). Settandoli PRIMA, i validator sono ok
      // quando arrivano i valori nativi.
      const checkboxFirst = sequentialFields.filter(x => x.f.kind === 'mat-checkbox');
      const matSelectAfter = sequentialFields.filter(x => x.f.kind === 'mat-select');

      // FASE 1 — mat-checkbox in BATCH (un solo round-trip bridge)
      if (checkboxFirst.length > 0) {
        // I checkbox usano fillField singolo perché passano per fillMatCheckbox del bridge
        for (const { f, v, sec } of checkboxFirst) {
          const okFlag = await fillField(f, v);
          if (okFlag) {
            ok++; perSection[sec].ok++;
            log(`✓ [${sec}] "${f.label || f.formControlName}" = ${String(v).slice(0,60)}`, 'ok');
          } else {
            perSection[sec].fail++;
            failedFields.push({ f, v, sec });
            log(`✗ [${sec}] "${f.label || f.formControlName}" non compilato (retry)`, 'warn');
          }
        }
      }

      // FASE 2 — mat-select in BATCH (sequenziale lato bridge, ma 1 solo postMessage)
      if (matSelectAfter.length > 0) {
        // IMPORTANTE: payload postMessage NON può contenere DOM node, solo primitivi
        const items = matSelectAfter.map(({ f, v }) => ({
          bridgeId: tagForBridge(f.element),
          value: v
        }));
        const res = await bridgeCall('fillMatSelectBatch', { items }, 30000);
        const results = res?.results || [];
        matSelectAfter.forEach(({ f, v, sec }, i) => {
          const r = results[i];
          if (r?.ok) {
            ok++; perSection[sec].ok++;
            log(`✓ [${sec}] "${f.label || f.formControlName}" = ${String(v).slice(0,60)}`, 'ok');
          } else {
            perSection[sec].fail++;
            failedFields.push({ f, v, sec });
            const err = r?.availableOptions ? `Disponibili: ${r.availableOptions.join(' | ')}` : (r?.error || 'errore');
            log(`✗ [${sec}] "${f.label || f.formControlName}" — ${err}`, 'warn');
          }
        });
      }

      // FASE 3 — input nativi in BATCH (1 solo round-trip bridge per N campi)
      if (nativeFields.length > 0) {
        const items = nativeFields.map(({ f, v }) => ({
          bridgeId: tagForBridge(f.element),
          value: String(v)
        }));
        const res = await bridgeCall('fillNativeBatch', { items }, 30000);
        const results = res?.results || [];
        nativeFields.forEach(({ f, v, sec }, i) => {
          const r = results[i];
          if (r?.ok) {
            ok++; perSection[sec].ok++;
            log(`✓ [${sec}] "${f.label || f.formControlName}" = ${String(v).slice(0,60)}`, 'ok');
          } else {
            perSection[sec].fail++;
            failedFields.push({ f, v, sec });
            log(`✗ [${sec}] "${f.label || f.formControlName}" non compilato (retry)`, 'warn');
          }
        });
      }

      // FASE 4 — RECOVERY PASS sui nativi (in batch anche questo)
      const recoveryNeeded = nativeFields.filter(({ f, v }) =>
        f.element && f.element.value !== String(v)
      );
      if (recoveryNeeded.length > 0) {
        log(`Recovery: ${recoveryNeeded.length} campi nativi resettati da validator, riapplico…`, 'info');
        const items = recoveryNeeded.map(({ f, v }) => ({
          bridgeId: tagForBridge(f.element),
          value: String(v)
        }));
        await bridgeCall('fillNativeBatch', { items }, 30000);
        recoveryNeeded.forEach(({ f, v }) => {
          if (f.element?.value === String(v)) {
            log(`✓ [recovery] "${f.label || f.formControlName}" ripristinato`, 'ok');
          }
        });
      }
      if (hallucinated > 0) {
        log(`Anti-invenzione: ${hallucinated} valori scartati perché non presenti nei documenti.`, 'info');
      }

      // REGOLE DETERMINISTICHE: applica mirror tra sezioni "coincide" PRIMA del second-pass AI
      // così la second-pass non chiede inutilmente all'AI campi che possiamo dedurre dal contesto
      try {
        const mirrored = await applyCoincideRules(fields);
        if (mirrored > 0) {
          // Rimuovi dai skippedFields i campi che abbiamo riempito col mirror
          const stillSkipped = skippedFields.filter(f => {
            const v = readCurrentValue(f);
            return v === null || v === undefined || v === '' || v === false;
          });
          const recovered = skippedFields.length - stillSkipped.length;
          if (recovered > 0) {
            ok += recovered;
            skipped = Math.max(0, skipped - recovered);
          }
          skippedFields.length = 0;
          skippedFields.push(...stillSkipped);
        }
      } catch (err) {
        log(`Mirror rules: ${err.message}`, 'warn');
      }

      // SECOND-PASS AI DISATTIVATA: spingeva l'AI a inventare per "riempire a tutti i costi"
      // Se i campi mancano davvero, è meglio lasciarli vuoti (l'utente può completarli manualmente)

      // RETRY: dropdown a cascata (provincia → comune) o campi che si caricano lazy.
      // Strategia: per ogni campo fallito, ricerco il mat-select PADRE nella stessa sezione
      // (es. regione/provincia) e lo ri-applico con click DOM reale per scatenare la fetch HTTP.
      if (failedFields.length > 0) {
        log(`Retry ${failedFields.length} campi con click DOM reale (scatena fetch a cascata)…`, 'info');

        // Identifica i mat-select già compilati con successo che potrebbero essere "padri" cascata
        // di campi falliti: stessa sezione, formControlName tipico cascata
        const cascadeParents = ['nazione', 'regione', 'provincia'];
        const parentMap = {};
        fields.forEach(f => {
          if (f.kind === 'mat-select' && cascadeParents.includes(f.formControlName) && mapping[f.ref]) {
            parentMap[`${f.section}|${f.formControlName}`] = { f, v: mapping[f.ref] };
          }
        });

        for (let attempt = 1; attempt <= 2; attempt++) {
          // Ri-applica i padri con click reale per "svegliare" la fetch a cascata
          const sectionsToReapply = new Set(failedFields.map(x => x.sec));
          for (const sec of sectionsToReapply) {
            for (const fc of cascadeParents) {
              const parent = parentMap[`${sec}|${fc}`];
              if (parent) {
                parent.f._retryRealClick = true;
                await fillField(parent.f, parent.v);
                parent.f._retryRealClick = false;
                await new Promise(r => setTimeout(r, 250)); // attesa fetch dipendente
              }
            }
          }
          await new Promise(r => setTimeout(r, 700));

          // Ora ritenta i campi falliti, anche con click reale
          const stillFailed = [];
          for (const { f, v, sec } of failedFields) {
            f._retryRealClick = true;
            const okFlag = await fillField(f, v);
            f._retryRealClick = false;
            if (okFlag) {
              ok++;
              perSection[sec].fail = Math.max(0, perSection[sec].fail - 1);
              perSection[sec].ok++;
              log(`✓ [${sec}] "${f.label || f.formControlName}" = ${String(v).slice(0,60)} (retry ${attempt} click reale)`, 'ok');
            } else {
              stillFailed.push({ f, v, sec });
            }
          }
          failedFields.length = 0;
          failedFields.push(...stillFailed);
          if (failedFields.length === 0) break;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        }
        fail = failedFields.length;
        for (const { f, sec } of failedFields) {
          log(`✗ [${sec}] "${f.label || f.formControlName}" non compilato dopo retry — potrebbe richiedere click manuale`, 'err');
        }
      }

      // Riepilogo per sezione
      log('— Riepilogo per sezione —', 'info');
      Object.entries(perSection).forEach(([sec, s]) => {
        const total = s.ok + s.fail + s.skipped;
        const status = s.ok === 0 && s.skipped === total ? '○ omessa (no dati)' : `${s.ok}/${total} compilati`;
        log(`  ${sec}: ${status}`, s.ok ? 'ok' : 'info');
      });
      log(`Totale: ✓ ${ok}  ✗ ${fail}  – ${skipped} omessi (no dati nei documenti).`, ok ? 'ok' : 'warn');
    } catch (err) {
      if (/Extension context invalidated/i.test(err.message || '')) {
        handleContextInvalidated();
      } else {
        log(`Errore: ${err.message}`, 'err');
        console.error(err);
      }
    } finally {
      setWorking(false);
    }
  }

  function setWorking(working) {
    state.isWorking = working;
    const btn = shadowRoot.querySelector('#btnFill');
    const lbl = shadowRoot.querySelector('#fillLabel');
    btn.disabled = working;
    shadowRoot.querySelector('#btnClear').disabled = working;
    if (working) {
      lbl.innerHTML = '<span class="spinner"></span> Compilo…';
    } else {
      lbl.textContent = 'Compila';
    }
  }

  // -----------------------------------------------------------
  // 12) CHIAMATA OPENAI
  // -----------------------------------------------------------
  async function askAI(fields) {
    const docsText = getActiveDocuments().map(d => `### ${d.name}\n${d.text}`).join('\n\n');
    const fieldSchema = fields.map(f => ({
      ref: f.ref,
      section: f.section || undefined,
      label: f.label,
      formControlName: f.formControlName || undefined,
      kind: f.kind,
      currentValue: f.currentValue || undefined,
      options: f.options ? f.options.map(o => o.label || o.value).slice(0, 100) : undefined
    }));

    // Lista delle sezioni distinte presenti nel form (per le istruzioni)
    const sectionsList = Array.from(new Set(fields.map(f => f.section).filter(Boolean)));

    const system = `Sei un assistente esperto nella compilazione di bandi di finanziamento italiani (Invitalia, Angular Material forms).
Riceverai (a) il contenuto testuale di documenti aziendali e (b) la lista dei campi di un form.

Ogni campo ha:
- ref: identificatore univoco
- section: SEZIONE/PAGINA del form (es. "Impresa proponente › Anagrafica", "Rappresentante legale", "Delegato", "Sede legale", "Sede operativa")
- label: etichetta visibile (es. "Denominazione", "CAP", "Email", "Indirizzo")
- formControlName: nome tecnico Angular (es. denominazione, indirizzo, cap, email, pec, codiceFiscale)
- kind: tipo di input
- currentValue: valore già presente

Devi restituire un oggetto JSON che mappa "ref" → valore.

═══════════════════════════════════════════════════════════════════════════
REGOLA #1 — COMPILA TUTTI I DATI VISIBILI NEI DOCUMENTI
═══════════════════════════════════════════════════════════════════════════
Per OGNI campo del form, cerca nei documenti se c'è un valore corrispondente,
anche con formattazione diversa. DEVI compilarlo se lo trovi.

Esempi di compilazione CORRETTA che DEVI fare:
- Doc: "Email: fortunamarco1@gmail.com" → field "email" = "fortunamarco1@gmail.com" ✓
- Doc: "PEC: effemmefortuna@pec.it" → field "pec" = "effemmefortuna@pec.it" ✓
- Doc: "tel. 347 1705531" → field "telefono"/"recapitiTelefonici" = "3471705531" ✓
- Doc: "Via Valle Toniche, 25" sotto Sede legale → field "indirizzo" = "Via Valle Toniche, 25" ✓
- Doc: "Cap 03024 Ceprano (FR), Italia" → field "cap" = "03024", "comune" = "Ceprano", "provincia" = "FR", "nazione" = "ITALIA" ✓

INFERENZE OVVIE che DEVI fare (per booleani / mat-select Sì-No):
- Doc dice "Italia" → field "Impresa estera?" = "No" ✓ (è ovvio: italiana ≠ estera)
- Doc cita una sola sede → field checkbox "coincide" = true ✓
- Doc parla di "ditta individuale Mario Rossi" → field "Forma giuridica" = "Ditta individuale" ✓

INFERENZE DA CODICE FISCALE ITALIANO (struttura AAAAAA YY M GG CCCC X):
Se nei documenti trovi un Codice Fiscale, DEVI dedurre:
- "Data di nascita" (formato YYYY-MM-DD): es. FRTMRC72M16C479C → 1972-08-16
  (mese: A=gen, B=feb, C=mar, D=apr, E=mag, H=giu, L=lug, M=ago, P=set, R=ott, S=nov, T=dic)
  (giorno: per donne aggiungi 40, quindi se >40 sottrai 40)
- "Sesso": se le ultime 2 cifre del giorno sono 1-31 → M, se 41-71 → F
  (es. M16 = 16 → maschio, M56 = giorno 16 ma >40 → femmina)
- "Luogo/Comune di nascita": le 4 cifre dopo il giorno (C479) sono il codice catastale del comune
  (es. C479 = comune che inizia con C, presumibilmente "Ceprano" → metti il nome del comune che vedi nei docs)
- "Provincia di nascita": ricavabile dal comune (es. Ceprano → FR)

CASI in cui DEVI omettere il campo (NON inventare):
- Il dato NON appare in nessun documento E non è deducibile da contesto evidente
  → ometti (es. fax aziendale assente nei docs → ometti il campo fax)
- NON usare un dato di un campo per riempirne un altro non collegato
  → NON copiare email nel campo PEC, NON copiare telefono in fax, ecc.
- NON inventare codici, identificativi, numeri civici se non presenti

═══════════════════════════════════════════════════════════════════════════
REGOLA #2 — ANTI-LEAKAGE TRA SEZIONI DI PERSONE
═══════════════════════════════════════════════════════════════════════════
Le sezioni "Rappresentante legale", "Delegato", "Referente da contattare"
rappresentano PERSONE DIFFERENTI. NON riusare mai i dati di una sezione per
un'altra. Se nei documenti c'è SOLO un ruolo (es. solo il rappresentante legale),
ometti tutti i campi delle altre sezioni-ruolo.

═══════════════════════════════════════════════════════════════════════════
REGOLA #3 — CHECKBOX "COINCIDE" — DEVI SEMPRE VALORIZZARLA
═══════════════════════════════════════════════════════════════════════════
ECCEZIONE alle regole 1 e 2: per le checkbox/mat-checkbox la cui label
contiene "coincide" (es. "Sede Legale coincide con Sede Operativa", "Sede
operativa coincide con Sede legale"), DEVI obbligatoriamente determinare
true o false. NON omettere mai questi campi.

Logica di decisione:
- true → se nei documenti c'è UNA SOLA sede menzionata (es. solo la sede
  legale, senza una sede operativa esplicitamente diversa) OPPURE i
  documenti dicono esplicitamente che coincidono.
- false → solo se i documenti citano DUE SEDI con indirizzi distinti
  (es. "sede legale: Via X" e "sede operativa: Via Y" con Via X ≠ Via Y).

Nel dubbio (un solo indirizzo nei documenti) → SEMPRE true.

Quando metti true → NON compilare i campi della sezione "Sede operativa"
(verranno copiati automaticamente dalla Sede legale dal sistema).

═══════════════════════════════════════════════════════════════════════════
SEZIONI RILEVATE IN QUESTO FORM:
${sectionsList.map(s => '  • ' + s).join('\n')}
═══════════════════════════════════════════════════════════════════════════

Format dei valori:
- mat-select: usa il TESTO visualizzato dell'opzione (es. "Società in accomandita semplice", "Micro", "Sì", "No", "ITALIA", "LAZIO", "FR", "CEPRANO")
- checkbox / mat-checkbox: true/false (boolean)
- date: YYYY-MM-DD
- Codice fiscale / Partita IVA: senza spazi né punti
- Codice ATECO: formato xx.xx.xx (con punti)
- CAP: 5 cifre
- Provincia: sigla 2 lettere maiuscole (FR, RM, MI…)
- Telefono: solo cifre, no spazi/trattini

Restituisci SOLO l'oggetto JSON, niente markdown.`;

    const user = `### CAMPI DEL FORM\n${JSON.stringify(fieldSchema, null, 2)}\n\n### DOCUMENTI DISPONIBILI\n${docsText}\n\nIstruzioni operative:\n1. Per OGNI campo della lista, cerca nei documenti il valore corrispondente.\n2. Per i dati AZIENDALI (denominazione, indirizzo, CAP, email, telefono, codici fiscali...): COMPILA SEMPRE se trovi un valore plausibile.\n3. Per i dati di RUOLI specifici (rappresentante, delegato, referente): compila solo se il ruolo è esplicitamente menzionato nei documenti.\n4. Se "Sede legale coincide con Sede operativa" è true (o detto nei doc): replica i dati della Sede legale nella Sede operativa.\n5. Restituisci {ref: valore} per TUTTI i campi compilabili.`;

    const response = await chrome.runtime.sendMessage({
      type: 'OPENAI_CHAT',
      payload: {
        model: state.settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        response_format: { type: 'json_object' },
        temperature: 0
      }
    });

    if (response?.error) throw new Error(response.error);
    if (!response?.content) throw new Error('Risposta vuota');

    if (response.usage) {
      const m = MODELS.find(x => x.id === state.settings.model);
      const cost = m ? (response.usage.prompt_tokens * m.priceIn + response.usage.completion_tokens * m.priceOut) / 1_000_000 : 0;
      log(`Token: in ${response.usage.prompt_tokens} / out ${response.usage.completion_tokens} ≈ ${formatCost(cost)}`, 'info');
    }

    try {
      return JSON.parse(response.content);
    } catch (e) {
      const m = response.content.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('Risposta non in formato JSON valido');
    }
  }

  // ---------------------------------------------------------------------------
  // REGOLE DETERMINISTICHE — applicate DOPO la compilazione AI per garantire
  // coerenza in casi che l'AI può sbagliare (es. mirror tra sezioni "coincide").
  // ---------------------------------------------------------------------------

  // Estrae il valore corrente di un campo dal DOM live (post-compilazione)
  function readCurrentValue(field) {
    const el = field.element;
    if (!el) return null;
    if (field.kind === 'mat-select') {
      const ctx = el.__ngContext__;
      if (Array.isArray(ctx)) {
        for (const item of ctx) {
          if (item?._elementRef?.nativeElement === el && typeof item.open === 'function') {
            return item.selected?.viewValue ?? item.value;
          }
        }
      }
      // Fallback DOM
      return el.querySelector('.mat-select-value-text')?.textContent?.trim() || null;
    }
    if (field.kind === 'mat-checkbox') {
      return el.classList.contains('mat-checkbox-checked')
          || !!el.querySelector('input[type="checkbox"]')?.checked;
    }
    if (field.kind === 'checkbox' || field.kind === 'radio-group') {
      return el.checked;
    }
    return el.value || null;
  }

  // Trova checkbox "coincide" che sono true e applica il mirror dei campi
  // dalla sezione sorgente alla sezione destinazione.
  async function applyCoincideRules(fields) {
    let mirrored = 0;

    // Identifica le checkbox "coincide" con stato true
    const allCheckboxes = fields.filter(f => f.kind === 'mat-checkbox' || f.kind === 'checkbox');
    const flags = allCheckboxes.filter(f =>
      /coincid/i.test(f.label || f.formControlName || '') &&
      readCurrentValue(f) === true
    );

    if (!flags.length) {
      // Diagnostica: se ci sono checkbox "coincide" ma a false, lo segnalo
      const coincideFalse = allCheckboxes.filter(f => /coincid/i.test(f.label || f.formControlName || ''));
      if (coincideFalse.length) {
        log(`Mirror: checkbox "coincide" trovata ma non attiva — nessun mirror.`, 'info');
      }
      return 0;
    }

    const SECTION_NAMES = ['legale', 'operativa', 'produttiva', 'amministrativa', 'fatturazione', 'fiscale'];

    for (const flag of flags) {
      const lbl = (flag.label || '').toLowerCase();
      const flagSection = (flag.section || '').toLowerCase();

      // Source: dove sta la checkbox (sezione attuale del flag) — es. "sede legale"
      let sourceKey = SECTION_NAMES.find(k => flagSection.includes(k));
      // Target: l'altra sezione menzionata nella label — es. "sede operativa prevalente"
      let targetKey = SECTION_NAMES.find(k => k !== sourceKey && lbl.includes(k));

      // Se non riusciamo a determinare, proviamo cercando entrambe le sezioni nella label
      if (!sourceKey || !targetKey) {
        const found = SECTION_NAMES.filter(k => lbl.includes(k));
        if (found.length === 2) {
          // Esempio: "La Sede Legale coincide con la Sede Operativa"
          // → la PRIMA citata è source, la SECONDA è target
          // Ma in pratica vogliamo copiare DA quella già compilata nell'altra
          [sourceKey, targetKey] = found;
        }
      }

      if (!sourceKey || !targetKey) {
        log(`Mirror: impossibile determinare sezioni source/target dalla label "${flag.label}"`, 'warn');
        continue;
      }

      // Trova le sezioni reali nei fields (matchando la SEZIONE, non solo il nome chiave)
      const allSections = Array.from(new Set(fields.map(f => f.section).filter(Boolean)));
      const sourceSection = allSections.find(s => s.toLowerCase().includes(sourceKey));
      const targetSection = allSections.find(s => s.toLowerCase().includes(targetKey));

      if (!sourceSection || !targetSection) {
        log(`Mirror: sezioni "${sourceKey}" / "${targetKey}" non presenti nel form (avail: ${allSections.join(' | ')})`, 'warn');
        continue;
      }

      const sourceFields = fields.filter(f => f.section === sourceSection);
      const targetFields = fields.filter(f => f.section === targetSection);

      log(`Mirror: copio ${sourceFields.length} campi da "${sourceSection}" verso "${targetSection}"`, 'info');

      // Prima passa: campi non-cascade (testo, ecc.)
      const cascadeKeys = ['nazione', 'regione', 'provincia', 'comune'];
      const nonCascade = targetFields.filter(f => !cascadeKeys.includes(f.formControlName));
      for (const tf of nonCascade) {
        if (!tf.formControlName) continue;
        const sf = sourceFields.find(s => s.formControlName === tf.formControlName);
        if (!sf) continue;
        const value = readCurrentValue(sf);
        if (value === null || value === undefined || value === '' || value === false) continue;
        const tgtVal = readCurrentValue(tf);
        if (tgtVal && String(tgtVal).toLowerCase() === String(value).toLowerCase()) continue;
        const okFlag = await fillField(tf, value);
        if (okFlag) {
          mirrored++;
          log(`✓ [${tf.section}] "${tf.label || tf.formControlName}" = ${String(value).slice(0,60)} (mirror)`, 'ok');
        } else {
          log(`✗ Mirror fallito su "${tf.formControlName}" = "${value}"`, 'warn');
        }
      }

      // Seconda passa: dropdown a cascata, in ORDINE (nazione → regione → provincia → comune)
      // Con click reale per scatenare le fetch HTTP del backend
      for (const key of cascadeKeys) {
        const tf = targetFields.find(f => f.formControlName === key);
        const sf = sourceFields.find(f => f.formControlName === key);
        if (!tf || !sf) continue;
        const value = readCurrentValue(sf);
        if (!value) continue;
        const tgtVal = readCurrentValue(tf);
        if (tgtVal && String(tgtVal).toLowerCase() === String(value).toLowerCase()) continue;
        if (tf.kind === 'mat-select') {
          tf._retryRealClick = true;
          const okFlag = await fillField(tf, value);
          tf._retryRealClick = false;
          if (okFlag) {
            mirrored++;
            log(`✓ [${tf.section}] "${tf.label || key}" = ${String(value).slice(0,60)} (mirror cascata)`, 'ok');
          } else {
            log(`✗ Mirror cascata fallito su "${key}" = "${value}"`, 'warn');
          }
          await new Promise(r => setTimeout(r, 700)); // attesa fetch dipendente
        }
      }
    }
    return mirrored;
  }

  // -----------------------------------------------------------
  // 13) AVVIO
  // -----------------------------------------------------------
  const VERSION = '3.4.0-universal';
  const VARIANT = 'universal'; // 'invitalia' | 'universal'

  // ============================================================
  // BRIDGE — comunicazione con page-bridge.js (MAIN world)
  // I content script Manifest V3 girano in isolated world e NON vedono __ngContext__.
  // Tutta la logica Angular-aware è nel bridge MAIN world.
  // ============================================================
  let _bridgeReqId = 0;
  const _bridgePending = new Map();
  let _bridgeReadyResolvers = [];

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data) return;
    if (data.kind === 'INVITALIA_AI_BRIDGE_READY') {
      state.bridgeReady = true;
      _bridgeReadyResolvers.forEach(r => r());
      _bridgeReadyResolvers = [];
      return;
    }
    if (data.kind !== 'INVITALIA_AI_BRIDGE_RES') return;
    const pending = _bridgePending.get(data.id);
    if (pending) {
      _bridgePending.delete(data.id);
      pending.resolve(data.result);
    }
  });

  // Aspetta che il bridge MAIN world abbia segnalato READY (fino a maxMs ms)
  function waitForBridgeReady(maxMs = 3000) {
    if (state.bridgeReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, maxMs);
      _bridgeReadyResolvers.push(() => {
        if (done) return;
        done = true; clearTimeout(t); resolve(true);
      });
    });
  }

  // Sanitizza un payload prima di postMessage: rimuove DOM nodes e funzioni
  // che non sono clonabili. Mantiene solo primitivi, array e oggetti plain.
  function sanitizeForPostMessage(value, depth = 0) {
    if (depth > 5) return null;
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return value;
    if (t === 'function') return undefined;
    if (value instanceof Element || value instanceof Node) return undefined;
    if (Array.isArray(value)) return value.map(v => sanitizeForPostMessage(v, depth + 1));
    if (t === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        const v = sanitizeForPostMessage(value[k], depth + 1);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    return undefined;
  }

  async function bridgeCall(op, payload = {}, timeoutMs = 5000) {
    if (!state.bridgeReady) await waitForBridgeReady(2000);
    const id = ++_bridgeReqId;
    const safe = sanitizeForPostMessage(payload);
    return new Promise((resolve) => {
      _bridgePending.set(id, { resolve });
      try {
        window.postMessage({ kind: 'INVITALIA_AI_BRIDGE_REQ', id, op, ...safe }, '*');
      } catch (err) {
        _bridgePending.delete(id);
        resolve({ ok: false, error: 'postMessage error: ' + (err.message || err) });
        return;
      }
      setTimeout(() => {
        if (_bridgePending.has(id)) {
          _bridgePending.delete(id);
          resolve({ ok: false, error: 'bridge timeout' });
        }
      }, timeoutMs);
    });
  }

  // Assegna un id univoco a un elemento DOM per riferimento dal bridge
  let _bridgeIdCounter = 0;
  function tagForBridge(el) {
    let id = el.getAttribute('data-iaibid');
    if (!id) {
      id = 'iaib_' + (++_bridgeIdCounter);
      el.setAttribute('data-iaibid', id);
    }
    return id;
  }

  async function init() {
    if (!chrome?.runtime?.id) {
      console.warn('[Compilatore (Universale)] Extension context invalidato all\'avvio. Ricarica la pagina (F5).');
      return;
    }
    try { await loadSettings(); } catch (_) {}
    try { await loadDocuments(); } catch (_) {}
    createWidget();
    renderDocList();
    log(`Estensione v${VERSION} attiva su ${location.host}.`, 'info');
    if (state.documents.length > 0) {
      log(`📁 ${state.documents.length} documento/i caricato/i da sessione precedente.`, 'info');
    }
    if (!state.settings.apiKey) {
      log('⚠ API key OpenAI non configurata. Apri le Impostazioni.', 'warn');
    }
    // Widget chiuso all'avvio: l'utente vede solo la pillola "Compilatore (Universale)"
    toggleWidget(false);

    // Listener per click toolbar -> toggle widget
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'TOGGLE_WIDGET') toggleWidget(!state.widgetOpen);
    });

    // Sincronizza stato quando cambia in altri tab (es. tema)
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
          if (changes.apiKey) {
            state.settings.apiKey = changes.apiKey.newValue || '';
          }
          if (changes.model) {
            state.settings.model = changes.model.newValue || 'gpt-4.1';
            // Aggiorna entrambi i picker custom (main + settings)
            shadowRoot.querySelectorAll('.model-picker').forEach(c => {
              const t = c.querySelector('.mp-trigger-name');
              const d = c.querySelector('.mp-trigger-desc');
              const m = MODELS.find(x => x.id === state.settings.model);
              if (t && m) t.textContent = m.label;
              if (d && m) d.textContent = m.desc;
            });
          }
          if (changes.theme) {
            state.settings.theme = changes.theme.newValue || 'light';
            applyTheme();
          }
        }
      });
    } catch (_) { /* context invalidato, ignora */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
