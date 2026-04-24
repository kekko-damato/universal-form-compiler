import { scanForm } from './form-scanner';
import { fillField, type FillAction } from './form-filler';
import { clearMarks, markField, showToast } from './overlay';
import type { Mapping } from '@/types/mapping';

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
  | ContentScanRequest
  | ContentFillRequest
  | ContentMarkRequest
  | ContentClearRequest;

chrome.runtime.onMessage.addListener(
  (req: ContentRequest, _sender, sendResponse) => {
    (async () => {
      try {
        switch (req.type) {
          case 'content/scan': {
            const fields = scanForm(document);
            sendResponse({ ok: true, fields });
            return;
          }
          case 'content/fill': {
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
            showToast(
              `Compilati ${results.filter((r) => r.ok).length}/${results.length} campi`,
            );
            sendResponse({ ok: true, results });
            return;
          }
          case 'content/mark': {
            for (const m of req.marks) markField(m.selector, m.status);
            sendResponse({ ok: true });
            return;
          }
          case 'content/clear': {
            clearMarks();
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
