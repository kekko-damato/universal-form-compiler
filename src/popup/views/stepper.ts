import { icon } from '../icons';

const STEPS: { label: string }[] = [
  { label: 'Importa' },
  { label: 'Rivedi' },
];

// Renders a 2-step horizontal stepper. `current` is 1-based.
export function stepperHtml(current: 1 | 2): string {
  const parts: string[] = ['<div class="stepper">'];
  for (let i = 0; i < STEPS.length; i++) {
    const n = i + 1;
    const isDone = n < current;
    const isActive = n === current;
    const cls = isDone ? 'step done' : isActive ? 'step active' : 'step';
    const inner = isDone ? icon('check', { size: 12 }) : String(n);
    parts.push(`<span class="${cls}">${inner}</span>`);
    parts.push(`<span class="step-label">${STEPS[i]!.label}</span>`);
    if (i < STEPS.length - 1) {
      parts.push(
        `<span class="step-line ${isDone ? 'done' : ''}"></span>`,
      );
    }
  }
  parts.push('</div>');
  return parts.join('');
}
