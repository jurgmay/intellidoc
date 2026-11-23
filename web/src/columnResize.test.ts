import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enhanceTable, installColumnResize, MIN_COLUMN_PX } from './columnResize';

const make = (): HTMLTableElement => {
  document.body.innerHTML = '<div id="box"><table><thead><tr><th>Status</th><th>File</th><th>Size</th></tr></thead><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table></div>';
  return document.querySelector('table')!;
};
const drag = (handle: Element, from: number, to: number) => {
  handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: from, bubbles: true, cancelable: true }));
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: to, bubbles: true }));
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
};
beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { const w = this.tagName === 'TABLE' ? 300 : this.tagName === 'TH' ? 100 : 0; return { width: w } as DOMRect; }); });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('column resizing', () => {
  it('puts a drag handle on every header and does nothing to the widths until a drag starts', () => {
    const t = make();
    expect(enhanceTable(t)).toBe(true);
    expect(t.querySelectorAll('[data-col-handle]')).toHaveLength(3);
    expect(t.style.tableLayout).toBe('');
    expect(enhanceTable(t)).toBe(true);
    expect(t.querySelectorAll('[data-col-handle]')).toHaveLength(3);   // not added twice
  });
  it('fixes all columns at their current widths on the first drag, then widens the dragged column and the table', () => {
    const t = make(); enhanceTable(t);
    drag(t.querySelectorAll('[data-col-handle]')[1]!, 200, 260);
    const [a, b, c] = [...t.tHead!.rows[0]!.cells];
    expect(a!.style.width).toBe('100px'); expect(c!.style.width).toBe('100px');
    expect(b!.style.width).toBe('160px');
    expect(t.style.tableLayout).toBe('fixed'); expect(t.style.width).toBe('360px');
    expect(t.parentElement!.style.overflowX).toBe('auto');
  });
  it('never makes a column narrower than the minimum', () => {
    const t = make(); enhanceTable(t);
    drag(t.querySelectorAll('[data-col-handle]')[0]!, 200, -500);
    expect(t.tHead!.rows[0]!.cells[0]!.style.width).toBe(`${MIN_COLUMN_PX}px`);
  });
  it('is not triggered as a click on the header', () => {
    const t = make(); enhanceTable(t);
    const th = t.tHead!.rows[0]!.cells[0]!; const clicked = vi.fn(); th.addEventListener('click', clicked);
    t.querySelector('[data-col-handle]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).not.toHaveBeenCalled();
  });
  it('finds tables that appear later, and skips a table with no header row', async () => {
    const stop = installColumnResize(document.body);
    document.body.insertAdjacentHTML('beforeend', '<table id="plain"><tbody><tr><td>x</td><td>y</td></tr></tbody></table><table id="late"><thead><tr><th>A</th><th>B</th></tr></thead></table>');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll('#late [data-col-handle]')).toHaveLength(2);
    expect(document.querySelectorAll('#plain [data-col-handle]')).toHaveLength(0);
    stop();
  });
});
