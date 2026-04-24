import { describe, it, expect } from 'vitest';
import { detectWidget } from '@/content/widget-detector';

function el(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild as HTMLElement;
}

describe('detectWidget', () => {
  it('classifies text input', () => {
    expect(detectWidget(el('<input type="text">'))).toEqual({
      kind: 'native-input',
      type: 'text',
    });
  });

  it('classifies email input', () => {
    expect(detectWidget(el('<input type="email">'))).toEqual({
      kind: 'native-input',
      type: 'email',
    });
  });

  it('classifies password input', () => {
    expect(detectWidget(el('<input type="password">'))).toEqual({
      kind: 'native-input',
      type: 'password',
    });
  });

  it('treats unknown input type as text fallback', () => {
    expect(detectWidget(el('<input type="foobar">'))).toEqual({
      kind: 'native-input',
      type: 'text',
    });
  });

  it('defaults input without type to text', () => {
    expect(detectWidget(el('<input>'))).toEqual({
      kind: 'native-input',
      type: 'text',
    });
  });

  it('classifies checkbox', () => {
    expect(detectWidget(el('<input type="checkbox">'))).toEqual({
      kind: 'native-input',
      type: 'checkbox',
    });
  });

  it('classifies radio', () => {
    expect(detectWidget(el('<input type="radio">'))).toEqual({
      kind: 'native-input',
      type: 'radio',
    });
  });

  it('classifies file', () => {
    expect(detectWidget(el('<input type="file">'))).toEqual({
      kind: 'native-input',
      type: 'file',
    });
  });

  it('classifies textarea', () => {
    expect(detectWidget(el('<textarea></textarea>'))).toEqual({
      kind: 'native-textarea',
    });
  });

  it('classifies single select', () => {
    expect(detectWidget(el('<select></select>'))).toEqual({
      kind: 'native-select',
      multiple: false,
    });
  });

  it('classifies multi select', () => {
    expect(detectWidget(el('<select multiple></select>'))).toEqual({
      kind: 'native-select',
      multiple: true,
    });
  });

  it('returns unsupported for non-form elements', () => {
    const result = detectWidget(el('<div></div>'));
    expect(result.kind).toBe('unsupported');
  });
});
