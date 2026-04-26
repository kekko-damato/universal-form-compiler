import type { ViewRenderer } from './router';
import { createWizardImportStep } from './wizard-step-import';
import { createWizardReviewStep } from './wizard-step-review';
import type {
  SaveCanonicalDataRequest,
  SaveCanonicalDataResponse,
} from '@/types/messages';

type WizardStep = 'import' | 'review' | 'done';

// First-time setup: import → review → done. Saves via canonical/save which
// auto-creates the first document profile in the vault.
export function createSetupWizard(
  onFinished: () => Promise<void>,
): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      let step: WizardStep = 'import';
      let importedData: unknown = null;

      const advance = async (to: WizardStep): Promise<void> => {
        step = to;
        const view = await viewFor(step);
        if (view) {
          await view.render(container);
        }
      };

      const viewFor = async (s: WizardStep): Promise<ViewRenderer | null> => {
        switch (s) {
          case 'import':
            return createWizardImportStep(async (data) => {
              importedData = data;
              await advance('review');
            });
          case 'review':
            return createWizardReviewStep({
              data: importedData,
              onSave: async (parsed) => {
                const res = (await chrome.runtime.sendMessage({
                  type: 'canonical/save',
                  data: parsed,
                } as SaveCanonicalDataRequest)) as SaveCanonicalDataResponse;
                return res;
              },
              onDone: async () => {
                await advance('done');
              },
            });
          case 'done':
            container.innerHTML = `
              <div class="loading-block">
                <span class="spinner"></span>
                <span>Fatto, sto caricando…</span>
              </div>
            `;
            await onFinished();
            return null;
        }
      };

      await advance('import');
    },
  };
}
