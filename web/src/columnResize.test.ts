import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enhanceTable, installColumnResize, MIN_COLUMN_PX, resizeColumns } from './columnResize';

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

describe('resizeColumns', () => {
  it('keeps the total, takes from the nearest column on the right first, and respects the minimum', () => {
    expect(resizeColumns([100, 100, 100], 0, 30)).toEqual([130, 70, 100]);
    expect(resizeColumns([100, 60, 100], 0, 50)).toEqual([150, 40, 70]);
    expect(resizeColumns([100, 100, 100], 1, -30)).toEqual([100, 70, 130]);
    expect(resizeColumns([100, 100, 100], 2, 50)).toEqual([100, 100, 100]);
    for (const d of [-500, -10, 0, 10, 500]) expect(resizeColumns([100, 100, 100], 0, d).reduce((a, b) => a + b, 0)).toBe(300);
  });
});

describe('column resizing', () => {
  it('puts a drag handle on every header but the last, and does nothing to the widths until a drag starts', () => {
    const t = make();
    expect(enhanceTable(t)).toBe(true);
    expect(t.querySelectorAll('[data-col-handle]')).toHaveLength(2);
    expect(t.style.tableLayout).toBe('');
    expect(enhanceTable(t)).toBe(true);
    expect(t.querySelectorAll('[data-col-handle]')).toHaveLength(2);   // not added twice
  });
  it('fixes the columns on the first drag, then moves space between the dragged column and those to its right, keeping the table\'s width', () => {
    const t = make(); enhanceTable(t);
    drag(t.querySelectorAll('[data-col-handle]')[0]!, 100, 160);
    const [a, b, c] = [...t.tHead!.rows[0]!.cells];
    expect([a!.style.width, b!.style.width, c!.style.width]).toEqual(['160px', '40px', '100px']);   // File gave 60 px, but only had 60 above the minimum
    expect(t.style.tableLayout).toBe('fixed'); expect(t.style.width).toBe('300px');
  });
  it('stops widening when the columns to the right are all at the minimum, and never narrows below the minimum', () => {
    const t = make(); enhanceTable(t);
    drag(t.querySelectorAll('[data-col-handle]')[0]!, 100, 900);
    expect([...t.tHead!.rows[0]!.cells].map((c) => c.style.width)).toEqual(['220px', '40px', '40px']);
    const t2 = make(); enhanceTable(t2);
    drag(t2.querySelectorAll('[data-col-handle]')[0]!, 100, -900);
    expect([...t2.tHead!.rows[0]!.cells].map((c) => c.style.width)).toEqual(['40px', '160px', '100px']);   // the next column takes what this one gave up
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
    expect(document.querySelectorAll('#late [data-col-handle]')).toHaveLength(1);
    expect(document.querySelectorAll('#plain [data-col-handle]')).toHaveLength(0);
    stop();
  });
});
