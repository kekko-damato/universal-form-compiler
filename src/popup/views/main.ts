import type { ViewRenderer } from './router';

export function createMainView(onLock: () => Promise<void>): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Vault unlocked</h1>
        <p class="muted">
          Phase 1a complete. Compile and import features arrive in Phase 1b/1c.
        </p>
        <div class="actions">
          <button id="lock-btn" class="secondary">Lock vault</button>
        </div>
      `;
      const btn = container.querySelector<HTMLButtonElement>('#lock-btn');
      btn?.addEventListener('click', async () => {
        await onLock();
      });
    },
  };
}
