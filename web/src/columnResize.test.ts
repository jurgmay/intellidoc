import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atLeastMinimum, enhanceTable, installColumnResize, MIN_COLUMN_PX, resizeColumns } from './columnResize';

const make = (): HTMLTableElement => {
  document.body.innerHTML = '<div id="box"><table><thead><tr><th>Status</th><th>File</th><th>Size</th></tr></thead><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table></div>';
  return document.querySelector('table')!;
};
const drag = (handle: Element, from: number, to: number) => {
  handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: from, bubbles: true, cancelable: true }));
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: to, bubbles: true }));
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
};
beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { const w = this.tagName === 'TABLE' ? 600 : this.tagName === 'TH' ? parseFloat(this.style.width) || 200 : 0; return { width: w } as DOMRect; }); });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('resizeColumns', () => {
  const M = MIN_COLUMN_PX;
  it('keeps the total, takes from the nearest column on the right first, and respects the minimum', () => {
    expect(resizeColumns([200, 200, 200], 0, 30)).toEqual([230, 170, 200]);
    expect(resizeColumns([200, M + 10, 200], 0, 50)).toEqual([250, M, 200 - 40]);
    expect(resizeColumns([200, 200, 200], 1, -30)).toEqual([200, 170, 230]);
    expect(resizeColumns([200, 200, 200], 2, 50)).toEqual([200, 200, 200]);
    for (const d of [-500, -10, 0, 10, 500]) expect(resizeColumns([200, 200, 200], 0, d).reduce((a, b) => a + b, 0)).toBe(600);
    expect(resizeColumns([200, 200, 200], 0, 9999)).toEqual([600 - 2 * M, M, M]);
    expect(resizeColumns([200, 200, 200], 0, -9999)).toEqual([M, 400 - M, 200]);
  });
  it('lifts narrow columns to the minimum at the expense of the wide ones, keeping the total when there is room', () => {
    const out = atLeastMinimum([60, 300, 200, 40]);
    expect(out[0]).toBe(M); expect(out[3]).toBe(M);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(600, 5);
    expect(out.every((w) => w >= M)).toBe(true);
    expect(atLeastMinimum([200, 300])).toEqual([200, 300]);
    expect(atLeastMinimum([50, 50, 50])).toEqual([M, M, M]);   // no room: the table grows
  });
});

describe('a column\'s own minimum', () => {
  it('uses data-min-width when it is larger than the default, when lifting narrow columns and when dragging', () => {
    expect(atLeastMinimum([100, 300, 300], [96, 288, 96])).toEqual([100, 300, 300]);
    expect(atLeastMinimum([200, 100, 400], [96, 288, 96])[1]).toBe(288);
    expect(resizeColumns([200, 300, 200], 0, 500, [96, 288, 96])).toEqual([200 + 12 + 104, 288, 96]);
    expect(resizeColumns([200, 300, 200], 1, -500, [96, 288, 96])).toEqual([200, 288, 212]);
  });
  it('holds from the moment the table is set up, before any drag', () => {
    const t = make(); const th = t.tHead!.rows[0]!.cells[1]!; th.setAttribute('data-min-width', '300'); enhanceTable(t);
    expect(th.style.minWidth).toBe('300px');
    expect(t.tHead!.rows[0]!.cells[0]!.style.minWidth).toBe('');   // a column that asks for nothing is left alone
    expect(t.hasAttribute('data-col-fixed')).toBe(false);
  });
  it('reads it from the header', () => {
    const t = make(); const th = t.tHead!.rows[0]!.cells[1]!; th.setAttribute('data-min-width', '288'); enhanceTable(t);
    drag(t.querySelectorAll('[data-col-handle]')[1]!, 100, -900);   // narrow File: it may not go below 288
    expect(t.tHead!.rows[0]!.cells[1]!.style.width).toBe('288px');
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
    drag(t.querySelectorAll('[data-col-handle]')[0]!, 100, 130);
    expect([...t.tHead!.rows[0]!.cells].map((c) => c.style.width)).toEqual(['230px', '170px', '200px']);
    expect(t.style.tableLayout).toBe('fixed'); expect(t.style.width).toBe('600px');
  });
  it('stops widening when the columns to the right are all at the minimum, and never narrows below the minimum', () => {
    const t = make(); enhanceTable(t);
    drag(t.querySelectorAll('[data-col-handle]')[0]!, 100, 900);
    expect([...t.tHead!.rows[0]!.cells].map((c) => c.style.width)).toEqual([`${600 - 2 * MIN_COLUMN_PX}px`, `${MIN_COLUMN_PX}px`, `${MIN_COLUMN_PX}px`]);
    const t2 = make(); enhanceTable(t2);
    drag(t2.querySelectorAll('[data-col-handle]')[0]!, 100, -900);
    expect([...t2.tHead!.rows[0]!.cells].map((c) => c.style.width)).toEqual([`${MIN_COLUMN_PX}px`, `${400 - MIN_COLUMN_PX}px`, '200px']);
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
