import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fillField, type FillAction } from '@/content/form-filler';

function setupForm(): void {
  document.body.innerHTML = `
    <form>
      <input id="txt" type="text" />
      <input id="mail" type="email" />
      <input id="pw" type="password" />
      <input id="num" type="number" />
      <input id="cb" type="checkbox" />
      <input type="radio" name="gender" value="M" id="r1" />
      <input type="radio" name="gender" value="F" id="r2" />
      <select id="sel">
        <option value="">--</option>
        <option value="it">Italy</option>
        <option value="us">United States</option>
      </select>
      <textarea id="ta"></textarea>
      <input id="file" type="file" />
    </form>
  `;
}

describe('fillField — text-like', () => {
  beforeEach(setupForm);

  it('fills text input and dispatches input+change events', async () => {
    const el = document.getElementById('txt') as HTMLInputElement;
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    el.addEventListener('input', inputSpy);
    el.addEventListener('change', changeSpy);

    const action: FillAction = { selector: '#txt', value: 'Antonio' };
    const res = await fillField(action);
    expect(res.ok).toBe(true);
    expect(el.value).toBe('Antonio');
    expect(inputSpy).toHaveBeenCalled();
    expect(changeSpy).toHaveBeenCalled();
  });

  it('fills email input', async () => {
    const el = document.getElementById('mail') as HTMLInputElement;
    await fillField({ selector: '#mail', value: 'a@b.co' });
    expect(el.value).toBe('a@b.co');
  });

  it('fills password input', async () => {
    const el = document.getElementById('pw') as HTMLInputElement;
    await fillField({ selector: '#pw', value: 's3cr3t' });
    expect(el.value).toBe('s3cr3t');
  });

  it('fills number input', async () => {
    const el = document.getElementById('num') as HTMLInputElement;
    await fillField({ selector: '#num', value: '42' });
    expect(el.value).toBe('42');
  });

  it('fills textarea', async () => {
    const el = document.getElementById('ta') as HTMLTextAreaElement;
    await fillField({ selector: '#ta', value: 'Some long text' });
    expect(el.value).toBe('Some long text');
  });
});

describe('fillField — checkbox', () => {
  beforeEach(setupForm);

  it('checks checkbox for truthy value', async () => {
    const el = document.getElementById('cb') as HTMLInputElement;
    const res = await fillField({ selector: '#cb', value: 'true' });
    expect(res.ok).toBe(true);
    expect(el.checked).toBe(true);
  });

  it('unchecks checkbox for falsy value', async () => {
    const el = document.getElementById('cb') as HTMLInputElement;
    el.checked = true;
    const res = await fillField({ selector: '#cb', value: 'false' });
    expect(res.ok).toBe(true);
    expect(el.checked).toBe(false);
  });
});

describe('fillField — radio', () => {
  beforeEach(setupForm);

  it('selects matching radio by value', async () => {
    const res = await fillField({
      selector: 'input[type="radio"][name="gender"]',
      value: 'F',
    });
    expect(res.ok).toBe(true);
    expect((document.getElementById('r1') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('r2') as HTMLInputElement).checked).toBe(true);
  });

  it('returns ok=false when no radio matches', async () => {
    const res = await fillField({
      selector: 'input[type="radio"][name="gender"]',
      value: 'X',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no matching/i);
  });
});

describe('fillField — select', () => {
  beforeEach(setupForm);

  it('selects option by value', async () => {
    const el = document.getElementById('sel') as HTMLSelectElement;
    const res = await fillField({ selector: '#sel', value: 'it' });
    expect(res.ok).toBe(true);
    expect(el.value).toBe('it');
  });

  it('selects option by display text when value mismatch', async () => {
    const el = document.getElementById('sel') as HTMLSelectElement;
    const res = await fillField({ selector: '#sel', value: 'Italy' });
    expect(res.ok).toBe(true);
    expect(el.value).toBe('it');
  });

  it('returns ok=false when no option matches', async () => {
    const res = await fillField({ selector: '#sel', value: 'XY' });
    expect(res.ok).toBe(false);
  });
});

describe('fillField — file', () => {
  beforeEach(setupForm);

  it('skips file input with informational error', async () => {
    const res = await fillField({ selector: '#file', value: '/tmp/foo.pdf' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/file upload/i);
  });
});

describe('fillField — missing element', () => {
  beforeEach(setupForm);

  it('returns ok=false when selector matches nothing', async () => {
    const res = await fillField({ selector: '#missing', value: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});
