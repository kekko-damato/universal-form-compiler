/* ============================================================
 * Invitalia AI Compiler - Page Bridge (MAIN world)
 * Gira nel main world della pagina per accedere a __ngContext__ (Ivy),
 * bypassando l'isolamento di Manifest V3.
 * Comunica con il content script isolato via window.postMessage.
 * ============================================================ */
(function () {
  'use strict';
  if (window.__INVITALIA_AI_BRIDGE_LOADED__) return;
  window.__INVITALIA_AI_BRIDGE_LOADED__ = true;

  const REQ = 'INVITALIA_AI_BRIDGE_REQ';
  const RES = 'INVITALIA_AI_BRIDGE_RES';

  // ---------- Helpers Angular ----------
  function clean(s) { return (s || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim(); }

  // Alias semantici per i mat-select dove l'AI risponde con la "forma estesa"
  // ma le opzioni reali sono sigle/abbreviazioni (caso classico: sesso M/F).
  const SEMANTIC_ALIASES = {
    // Sesso / genere
    'maschio': ['m'], 'maschile': ['m'], 'uomo': ['m'], 'male': ['m'], 'm': ['maschio', 'uomo'],
    'femmina': ['f'], 'femminile': ['f'], 'donna': ['f'], 'female': ['f'], 'f': ['femmina', 'donna'],
    // Booleani
    'sì': ['si', 'yes', 'true', 's'], 'si': ['sì', 'yes', 'true', 's'],
    'no': ['n', 'false'],
    'true': ['sì', 'si', 'yes'], 'false': ['no', 'n']
  };

  function findOptionFuzzy(opts, value, getLabel = o => o.label, getValue = o => o.value) {
    const v = String(value).toLowerCase().trim();
    if (!v) return null;
    // 1) Match esatto label
    let opt = opts.find(o => clean(String(getLabel(o))).toLowerCase() === v);
    if (opt) return opt;
    // 2) Match esatto value
    opt = opts.find(o => String(getValue(o)).toLowerCase() === v);
    if (opt) return opt;
    // 3) Alias semantici (es. "maschio" → trova opzione "M")
    const aliases = SEMANTIC_ALIASES[v] || [];
    for (const alias of aliases) {
      opt = opts.find(o => clean(String(getLabel(o))).toLowerCase() === alias);
      if (opt) return opt;
      opt = opts.find(o => String(getValue(o)).toLowerCase() === alias);
      if (opt) return opt;
    }
    // 4) Inverso alias: l'AI ha mandato "M" ma le opzioni sono "Maschio"
    for (const opt2 of opts) {
      const lblLower = clean(String(getLabel(opt2))).toLowerCase();
      const aliasesOfOpt = SEMANTIC_ALIASES[lblLower] || [];
      if (aliasesOfOpt.includes(v)) return opt2;
    }
    // 5) includes (parziale): doc dice "Italia" → opzione "REPUBBLICA ITALIANA"
    opt = opts.find(o => clean(String(getLabel(o))).toLowerCase().includes(v));
    if (opt) return opt;
    // 6) includes inverso (label è sostringa del valore AI)
    opt = opts.find(o => {
      const l = clean(String(getLabel(o))).toLowerCase();
      return l.length > 1 && v.includes(l);
    });
    return opt || null;
  }

  function tickAngular(cdr) {
    try { cdr?.detectChanges?.(); } catch (_) {}
    try { cdr?.markForCheck?.(); } catch (_) {}
  }

  function getAngularBindings(el) {
    const ctx = el?.__ngContext__;
    if (!Array.isArray(ctx)) return {};

    const looksLikeMatSelect = (item) =>
      typeof item.open === 'function' &&
      typeof item.close === 'function' &&
      typeof item.writeValue === 'function' &&
      ('_panelOpen' in item || 'panelOpen' in item || 'options' in item || '_options' in item);

    const looksLikeFormControl = (item) => {
      if (!item || typeof item !== 'object') return false;
      const proto = Object.getPrototypeOf(item);
      const protoNames = proto ? Object.getOwnPropertyNames(proto) : [];
      return protoNames.includes('enable') && protoNames.includes('disable') &&
             protoNames.includes('setValue') && 'value' in item;
    };

    // Filtra istanze il cui _elementRef è il NOSTRO elemento
    const ownInstances = [];
    for (const item of ctx) {
      if (!item || typeof item !== 'object') continue;
      if (item._elementRef?.nativeElement === el) ownInstances.push(item);
    }

    let matSelect = null, ngControl = null, cdr = null, control = null;

    for (const item of ownInstances) {
      if (!matSelect && looksLikeMatSelect(item)) matSelect = item;
      if (!ngControl && (item.ngControl || item._ngControl)) ngControl = item.ngControl || item._ngControl;
      if (!cdr && (item._changeDetectorRef || item.changeDetectorRef)) cdr = item._changeDetectorRef || item.changeDetectorRef;
    }

    if (!matSelect) {
      // Fallback su tutto il context
      for (const item of ctx) {
        if (!item || typeof item !== 'object') continue;
        if (looksLikeMatSelect(item) && (!item._elementRef || item._elementRef.nativeElement === el)) {
          matSelect = item;
          ngControl = ngControl || item.ngControl;
          cdr = cdr || item._changeDetectorRef;
          break;
        }
      }
    }

    if (ngControl?.control) control = ngControl.control;
    if (!control) {
      for (const item of ownInstances) {
        if (looksLikeFormControl(item)) { control = item; break; }
      }
    }

    return { matSelect, control, ngControl, cdr };
  }

  function readOptionsFromInstance(matSelect) {
    if (!matSelect) return [];
    const optsCol = matSelect.options || matSelect._options;
    if (!optsCol) return [];
    const list = optsCol.toArray ? optsCol.toArray() : Array.from(optsCol);
    return list.map(o => ({
      value: o.value,
      label: o.viewValue || o._element?.nativeElement?.textContent?.trim() || String(o.value)
    }));
  }

  // HACK necessario: dopo setValue programmatico, Angular Material non re-renderizza
  // l'interno di .mat-select-value-text (usa una *ngIf interna che non si aggiorna).
  // Inseriamo manualmente lo span che mostra la selezione, allineando il display al modello.
  function syncMatSelectDisplay(el, matSelect) {
    const valueText = el.querySelector('.mat-select-value-text');
    if (!valueText) return;
    const viewValue = matSelect?.selected?.viewValue
                   || matSelect?.triggerValue
                   || (matSelect?.selected && matSelect.selected.length
                       ? matSelect.selected.map(o => o.viewValue).join(', ')
                       : '');
    if (!viewValue) {
      // Niente selezione: lascia vuoto
      return;
    }
    // Solo se il display è effettivamente vuoto (non vogliamo sovrascrivere render Angular nativo)
    const currentText = valueText.textContent.trim();
    if (!currentText) {
      valueText.innerHTML = `<span class="mat-select-min-line">${String(viewValue)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
    }
  }

  function waitFor(predicate, timeoutMs = 1500, intervalMs = 30) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        let res;
        try { res = predicate(); } catch (_) { res = null; }
        if (res) return resolve(res);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  function unlockMatSelectInstance(el, matSelect, control, cdr) {
    if (control?.enable) {
      try { control.enable({ emitEvent: false }); } catch (_) { try { control.enable(); } catch (_) {} }
    }
    tickAngular(cdr);
    el.classList.remove('mat-select-disabled');
    el.removeAttribute('aria-disabled');
    el.removeAttribute('ng-reflect-disabled');
    el.setAttribute('tabindex', '0');
    el.style.pointerEvents = 'auto';
    const mff = el.closest('mat-form-field');
    if (mff) {
      mff.classList.remove('mat-form-field-disabled', 'mat-form-field-readonly');
      mff.style.pointerEvents = 'auto';
    }
  }

  function unlockNativeInstance(el, control, cdr) {
    if (control?.enable) {
      try { control.enable({ emitEvent: false }); } catch (_) { try { control.enable(); } catch (_) {} }
    }
    tickAngular(cdr);
    if (el.disabled) { el.disabled = false; el.removeAttribute('disabled'); }
    if (el.readOnly) { el.readOnly = false; el.removeAttribute('readonly'); }
  }

  // ---------- API esposte via postMessage ----------
  async function probeMatSelect(el) {
    const { matSelect, control, cdr } = getAngularBindings(el);
    return {
      ok: !!matSelect,
      ctxLen: el.__ngContext__?.length || 0,
      hasControl: !!control,
      hasCdr: !!cdr,
      currentValue: matSelect?.value ?? control?.value,
      currentDisplay: el.querySelector('.mat-select-value-text')?.textContent?.trim()
    };
  }

  async function getMatSelectOptions(el) {
    const { matSelect, control, cdr } = getAngularBindings(el);
    if (!matSelect) return { ok: false, error: 'instance not found' };

    // Sblocca preventivamente
    unlockMatSelectInstance(el, matSelect, control, cdr);
    await new Promise(r => setTimeout(r, 30));

    let opts = readOptionsFromInstance(matSelect);
    if (!opts.length) {
      try { matSelect.open(); tickAngular(cdr); } catch (_) {}
      await waitFor(() => readOptionsFromInstance(matSelect).length > 0, 1500);
      opts = readOptionsFromInstance(matSelect);
      try { matSelect.close(); tickAngular(cdr); } catch (_) {}
    }
    return { ok: true, options: opts };
  }

  async function fillMatSelect(el, value, options = {}) {
    const { matSelect, control, cdr } = getAngularBindings(el);
    if (!matSelect) return { ok: false, error: 'instance not found' };

    unlockMatSelectInstance(el, matSelect, control, cdr);
    await new Promise(r => setTimeout(r, 30));

    // Strategia REAL CLICK: apri overlay, clicca davvero sull'opzione (replica click utente).
    // Triggera tutti i listener inclusa la fetch HTTP per dropdown a cascata.
    if (options.realClick) {
      try { matSelect.open(); tickAngular(cdr); } catch (_) {}
      const optionsCol = await waitFor(() => {
        const list = matSelect.options || matSelect._options;
        if (!list) return null;
        const arr = list.toArray ? list.toArray() : Array.from(list);
        return arr.length > 0 ? arr : null;
      }, 2000);
      if (!optionsCol) {
        try { matSelect.close(); tickAngular(cdr); } catch (_) {}
        return { ok: false, error: 'no options (realClick)' };
      }
      const optInst = findOptionFuzzy(optionsCol, value, o => o.viewValue || o.value, o => o.value);
      if (!optInst) {
        try { matSelect.close(); tickAngular(cdr); } catch (_) {}
        return { ok: false, error: 'no match (realClick)', availableOptions: optionsCol.map(o => o.viewValue).slice(0, 8) };
      }
      // Click DOM reale sull'elemento dell'opzione
      const optEl = optInst._element?.nativeElement || optInst._getHostElement?.();
      if (optEl) {
        ['mousedown', 'mouseup', 'click'].forEach(ev =>
          optEl.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window, button: 0 }))
        );
      } else {
        // fallback al metodo Angular interno
        try { optInst._selectViaInteraction?.(); } catch (_) {}
      }
      tickAngular(cdr);
      await new Promise(r => setTimeout(r, 80));
      syncMatSelectDisplay(el, matSelect);
      return {
        ok: true,
        matchedLabel: optInst.viewValue,
        matchedValue: optInst.value,
        finalDisplay: el.querySelector('.mat-select-value-text')?.textContent?.trim(),
        method: 'realClick'
      };
    }

    // Strategia setValue veloce (default)
    let opts = readOptionsFromInstance(matSelect);
    if (!opts.length) {
      try { matSelect.open(); tickAngular(cdr); } catch (_) {}
      await waitFor(() => readOptionsFromInstance(matSelect).length > 0, 1500);
      opts = readOptionsFromInstance(matSelect);
      try { matSelect.close(); tickAngular(cdr); } catch (_) {}
    }

    if (!opts.length) return { ok: false, error: 'no options' };

    const opt = findOptionFuzzy(opts, value, o => o.label, o => o.value);
    if (!opt) {
      return { ok: false, error: 'no match', availableOptions: opts.map(o => o.label).slice(0, 8) };
    }

    try { control?.enable({ emitEvent: false }); } catch (_) {}
    tickAngular(cdr);
    try { matSelect.writeValue(opt.value); } catch (_) {}
    tickAngular(cdr);
    try { control?.setValue(opt.value, { emitEvent: true }); } catch (_) {}
    tickAngular(cdr);
    try { matSelect.stateChanges?.next?.(); } catch (_) {}
    tickAngular(cdr);
    try { matSelect.selectionChange?.emit?.({ source: matSelect, value: opt.value }); } catch (_) {}
    try { matSelect._onChange?.(opt.value); } catch (_) {}
    try { matSelect.valueChange?.emit?.(opt.value); } catch (_) {}
    tickAngular(cdr);
    await new Promise(r => setTimeout(r, 50));
    syncMatSelectDisplay(el, matSelect);

    return {
      ok: true,
      matchedLabel: opt.label,
      matchedValue: opt.value,
      finalDisplay: el.querySelector('.mat-select-value-text')?.textContent?.trim(),
      method: 'setValue'
    };
  }

  async function fillMatCheckbox(el, value) {
    // 'el' è il wrapper <mat-checkbox> oppure l'<input> interno
    const wrapper = el.matches('mat-checkbox') ? el : el.closest('mat-checkbox');
    const innerInput = wrapper?.querySelector('input[type="checkbox"]')
                    || (el.tagName === 'INPUT' ? el : null);
    if (!wrapper && !innerInput) return { ok: false, error: 'no checkbox found' };

    const want = (value === true || /^(true|1|si|sì|yes|y|on|checked)$/i.test(String(value)));

    // Cerco l'istanza MatCheckbox tramite __ngContext__ del wrapper
    let matCheckbox = null, control = null, cdr = null;
    const ctx = (wrapper || innerInput).__ngContext__;
    if (Array.isArray(ctx)) {
      for (const item of ctx) {
        if (!item || typeof item !== 'object') continue;
        if (item._elementRef?.nativeElement === wrapper && 'checked' in item) {
          matCheckbox = item;
          control = item.ngControl?.control || control;
          cdr = item._changeDetectorRef || cdr;
          break;
        }
      }
      // Fallback: se wrapper non c'è (caso input puro), cerca un'istanza che abbia
      // _elementRef === innerInput O wrapper, e che abbia 'checked' come own property
      if (!matCheckbox) {
        const targetEl = innerInput || wrapper;
        for (const item of ctx) {
          if (!item || typeof item !== 'object') continue;
          if (item._elementRef?.nativeElement !== targetEl) continue;
          if (Object.prototype.hasOwnProperty.call(item, 'checked') && item.ngControl != null) {
            matCheckbox = item;
            control = item.ngControl?.control || control;
            cdr = item._changeDetectorRef || cdr;
            break;
          }
        }
      }
    }

    // Sblocca FormControl
    if (control?.enable) {
      try { control.enable({ emitEvent: false }); } catch (_) {}
    }
    tickAngular(cdr);

    // Sblocca DOM/CSS
    if (wrapper) {
      wrapper.classList.remove('mat-checkbox-disabled');
      wrapper.removeAttribute('aria-disabled');
    }
    if (innerInput) {
      innerInput.disabled = false;
      innerInput.removeAttribute('disabled');
    }

    // Applica valore
    if (matCheckbox) {
      try { matCheckbox.checked = want; } catch (_) {}
    }
    if (control?.setValue) {
      try { control.setValue(want, { emitEvent: true }); } catch (_) {}
    }
    if (innerInput) {
      innerInput.checked = want;
      try { innerInput.indeterminate = false; } catch (_) {}
      ['input', 'change'].forEach(ev => innerInput.dispatchEvent(new Event(ev, { bubbles: true })));
    }
    tickAngular(cdr);

    // Sincronizzazione visuale del wrapper (Angular Material non re-renderizza la classe)
    if (wrapper) {
      if (want) {
        wrapper.classList.add('mat-checkbox-checked');
        wrapper.classList.remove('mat-checkbox-indeterminate');
      } else {
        wrapper.classList.remove('mat-checkbox-checked');
      }
    }

    await new Promise(r => setTimeout(r, 30));

    return {
      ok: true,
      finalChecked: innerInput?.checked,
      hasWrapperClass: wrapper?.classList.contains('mat-checkbox-checked'),
      controlValue: control?.value,
      method: matCheckbox ? 'angular' : 'dom-only'
    };
  }

  async function fillNativeInput(el, value) {
    const { control, cdr } = getAngularBindings(el);
    unlockNativeInstance(el, control, cdr);
    const sval = String(value);

    // 1) PRIMA aggiorna FormControl Angular (così Angular sa qual è il "valore vero")
    if (control?.setValue) {
      try {
        control.setValue(sval, { emitEvent: true });
        control.markAsDirty?.();
        control.markAsTouched?.();
        control.updateValueAndValidity?.();
      } catch (_) {}
    }
    tickAngular(cdr);

    // 2) DOPO setter nativo + eventi (l'ultimo a parlare al DOM, garantisce display corretto)
    const tag = el.tagName.toLowerCase();
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, sval); else el.value = sval;
    ['input', 'change', 'blur'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));

    // 3) Sincronizza display di mat-form-field (toglie classe empty, fa "float" il label)
    const mff = el.closest('mat-form-field');
    if (mff && sval) {
      mff.classList.remove('mat-form-field-empty', 'mat-form-field-hide-placeholder');
      mff.classList.add('mat-form-field-should-float', 'mat-form-field-has-label');
    }
    tickAngular(cdr);

    // 4) Quick check: se Angular ha resettato il valore subito, re-applica
    //    senza emitEvent (evita che i validator lo rigettino di nuovo).
    if (el.value !== sval) {
      if (control?.setValue) {
        try {
          control.setValue(sval, { emitEvent: false });
          control.markAsDirty?.();
        } catch (_) {}
      }
      if (setter) setter.call(el, sval); else el.value = sval;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      tickAngular(cdr);
    }
    if (mff && el.value) mff.classList.add('mat-form-field-should-float');

    return { ok: true, finalValue: el.value };
  }

  // Batch processing: tutti gli input nativi in UN solo round-trip postMessage.
  // Elimina N×latency di N bridgeCall separate.
  async function fillNativeBatch(items) {
    const results = [];
    for (const it of items) {
      const el = document.querySelector(`[data-iaibid="${it.bridgeId}"]`);
      if (!el) { results.push({ bridgeId: it.bridgeId, ok: false, error: 'no element' }); continue; }
      const r = await fillNativeInput(el, it.value);
      results.push({ bridgeId: it.bridgeId, ...r });
    }
    return { ok: true, results };
  }

  // Batch per mat-select sequenziali (overlay aperto/chiuso a turno).
  async function fillMatSelectBatch(items) {
    const results = [];
    for (const it of items) {
      const el = document.querySelector(`[data-iaibid="${it.bridgeId}"]`);
      if (!el) { results.push({ bridgeId: it.bridgeId, ok: false, error: 'no element' }); continue; }
      const r = await fillMatSelect(el, it.value, it.options || {});
      results.push({ bridgeId: it.bridgeId, ...r });
    }
    return { ok: true, results };
  }

  function softEnableAll() {
    let count = 0;
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.disabled || el.readOnly) {
        const { control, cdr } = getAngularBindings(el);
        unlockNativeInstance(el, control, cdr);
        count++;
      }
    });
    document.querySelectorAll('mat-select').forEach(el => {
      if (el.classList.contains('mat-select-disabled') || el.getAttribute('aria-disabled') === 'true') {
        const { matSelect, control, cdr } = getAngularBindings(el);
        unlockMatSelectInstance(el, matSelect, control, cdr);
        count++;
      }
    });
    document.querySelectorAll(
      '.mat-form-field-disabled, .mat-form-field-readonly, .mat-input-disabled'
    ).forEach(el => {
      el.classList.remove('mat-form-field-disabled', 'mat-form-field-readonly', 'mat-input-disabled');
    });
    return { ok: true, count };
  }

  // ---------- Listener postMessage ----------
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.kind !== REQ) return;

    const { id, op, bridgeId, value } = data;
    let el = null;
    if (bridgeId) el = document.querySelector(`[data-iaibid="${bridgeId}"]`);

    let result;
    try {
      switch (op) {
        case 'probe':              result = el ? await probeMatSelect(el)    : { ok: false, error: 'no element' }; break;
        case 'getMatOptions':      result = el ? await getMatSelectOptions(el): { ok: false, error: 'no element' }; break;
        case 'fillMatSelect':      result = el ? await fillMatSelect(el, value, data.options || {}): { ok: false, error: 'no element' }; break;
        case 'fillNativeInput':    result = el ? await fillNativeInput(el, value): { ok: false, error: 'no element' }; break;
        case 'fillMatCheckbox':    result = el ? await fillMatCheckbox(el, value): { ok: false, error: 'no element' }; break;
        case 'fillNativeBatch':    result = await fillNativeBatch(data.items || []); break;
        case 'fillMatSelectBatch': result = await fillMatSelectBatch(data.items || []); break;
        case 'softEnableAll':      result = softEnableAll(); break;
        default: result = { ok: false, error: 'unknown op: ' + op };
      }
    } catch (err) {
      result = { ok: false, error: err.message || String(err) };
    }

    window.postMessage({ kind: RES, id, result }, '*');
  });

  // Segnala disponibilità
  window.postMessage({ kind: 'INVITALIA_AI_BRIDGE_READY' }, '*');
  console.log('[Invitalia AI] page-bridge MAIN world loaded.');
})();
