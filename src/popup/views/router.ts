export type ViewId = 'setup-wizard' | 'main' | 'settings';

export interface ViewRenderer {
  render(container: HTMLElement): void | Promise<void>;
}

export interface Router {
  show(id: ViewId): Promise<void>;
}

export function createRouter(
  container: HTMLElement,
  views: Record<ViewId, () => ViewRenderer>,
): Router {
  return {
    async show(id: ViewId) {
      container.innerHTML = '';
      const view = views[id]();
      await view.render(container);
    },
  };
}
