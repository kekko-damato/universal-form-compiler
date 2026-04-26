import { scanForm } from './form-scanner';
import { fillField, type FillAction } from './form-filler';
import {
  clearMarks,
  hideWidget,
  markField,
  showToast,
  showWidget,
} from './overlay';
import type { Mapping } from '@/types/mapping';

// Idempotent install guard: when the service worker re-injects the content
// script via chrome.scripting.executeScript on a page where it's already
// alive, this prevents double-registering the message listener.
const INSTALL_FLAG = '__UFC_CONTENT_INSTALLED__';
declare global {
  interface Window {
    [INSTALL_FLAG]?: boolean;
  }
}
if (window[INSTALL_FLAG]) {
  console.log('[UFC] content script already installed, skipping');
} else {
  window[INSTALL_FLAG] = true;
  install();
}

interface ContentPingRequest {
  type: 'content/ping';
}
interface ContentScanRequest {
  type: 'content/scan';
}
interface ContentFillRequest {
  type: 'content/fill';
  mappings: Mapping[];
  valuesById: Record<string, string>;
  selectorsById: Record<string, string>;
}
interface ContentMarkRequest {
  type: 'content/mark';
  marks: { selector: string; status: Mapping['status'] }[];
}
interface ContentClearRequest {
  type: 'content/clear';
}

type ContentRequest =
  | ContentPingRequest
  | ContentScanRequest
  | ContentFillRequest
  | ContentMarkRequest
  | ContentClearRequest;

function install(): void {
  chrome.runtime.onMessage.addListener(
    (req: ContentRequest, _sender, sendResponse) => {
    (async () => {
      try {
        switch (req.type) {
          case 'content/ping': {
            sendResponse({ ok: true });
            return;
          }
          case 'content/scan': {
            const fields = scanForm(document);
            sendResponse({ ok: true, fields });
            return;
          }
          case 'content/fill': {
            showWidget({
              status: 'filling',
              title: 'Compilazione in corso…',
              detail: `${req.mappings.length} campi`,
            });
            const results = [];
            for (const m of req.mappings) {
              const selector = req.selectorsById[m.fieldId];
              const value = req.valuesById[m.fieldId];
              if (!selector || value === undefined) continue;
              const action: FillAction = {
                selector,
                value,
                fieldId: m.fieldId,
              };
              const r = await fillField(action);
              results.push(r);
              markField(selector, r.ok ? m.status : 'skipped');
            }
            const okCount = results.filter((r) => r.ok).length;
            const total = results.length;
            const allOk = okCount === total;
            showWidget({
              status: allOk ? 'done' : 'error',
              title: allOk ? 'Form compilato' : 'Compilato parzialmente',
              detail: `${okCount} di ${total} campi compilati`,
              autoHideMs: allOk ? 4500 : 0,
            });
            showToast(
              `Compilati ${okCount}/${total} campi`,
              allOk ? 'success' : 'warning',
            );
            sendResponse({ ok: true, results });
            return;
          }
          case 'content/mark': {
            for (const m of req.marks) markField(m.selector, m.status);
            const counts = req.marks.reduce(
              (acc, m) => {
                acc[m.status] = (acc[m.status] ?? 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            );
            const detailParts: string[] = [];
            if (counts['certain']) detailParts.push(`${counts['certain']} certi`);
            if (counts['uncertain']) detailParts.push(`${counts['uncertain']} incerti`);
            if (counts['unmapped']) detailParts.push(`${counts['unmapped']} saltati`);
            showWidget({
              status: 'ready',
              title: 'Pronto per compilare',
              detail: detailParts.join(' · ') || `${req.marks.length} campi`,
            });
            sendResponse({ ok: true });
            return;
          }
          case 'content/clear': {
            clearMarks();
            hideWidget();
            sendResponse({ ok: true });
            return;
          }
        }
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    })();
    return true; // async
    },
  );

  console.log('[UFC] content script ready');
}
