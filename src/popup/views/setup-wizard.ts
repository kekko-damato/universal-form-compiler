import type { ViewRenderer } from './router';
import { createWizardPasswordStep } from './wizard-step-password';
import { createWizardImportStep } from './wizard-step-import';
import { createWizardReviewStep } from './wizard-step-review';

type WizardStep = 'password' | 'import' | 'review' | 'done';

export function createSetupWizard(
  onFinished: () => Promise<void>,
): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      let step: WizardStep = 'password';
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
          case 'password':
            return createWizardPasswordStep(() => advance('import'));
          case 'import':
            return createWizardImportStep(async (data) => {
              importedData = data;
              await advance('review');
            });
          case 'review':
            return createWizardReviewStep(importedData, async () => {
              await advance('done');
            });
          case 'done':
            container.innerHTML = '<p class="muted">Fatto, sto caricando…</p>';
            await onFinished();
            return null;
        }
      };

      await advance('password');
    },
  };
}
