/**
 * Lets the user drag the right edge of any table column header to resize that column, in every table of the app, without each page doing anything.
 * A watcher adds a drag handle to every header cell of every table (including tables that appear later, such as when data arrives or a tab opens).
 * The table keeps its width: widening a column takes the space from the columns to its right (nearest first, none below the minimum), and narrowing
 * one gives the space to the next column, so nothing is ever pushed out of the table. The last column has no handle, as its left neighbour's handle
 * moves the same boundary.
 */
/** Wide enough for any column name to show in full. */
export const MIN_COLUMN_PX = 96;
const DONE = 'data-col-resize';

/** Each column's own minimum: a header may ask for more than the default with data-min-width (in px). */
export function minimums(cells: HTMLTableCellElement[]): number[] {
  return cells.map((c) => Math.max(MIN_COLUMN_PX, Number(c.dataset['minWidth']) || 0));
}

/**
 * Raises any column narrower than its minimum to it, paying for that out of the columns that have room, in proportion to how much they have, so the
 * total stays the same. If there is not enough room (the table is narrower than all its columns at their minimums) the total grows to fit.
 */
export function atLeastMinimum(widths: number[], mins: number[] = widths.map(() => MIN_COLUMN_PX)): number[] {
  const deficit = widths.reduce((t, w, i) => t + Math.max(0, mins[i]! - w), 0);
  if (deficit === 0) return [...widths];
  const spare = widths.reduce((t, w, i) => t + Math.max(0, w - mins[i]!), 0);
  const pay = Math.min(1, deficit / spare || 0);
  return widths.map((w, i) => (w < mins[i]! ? mins[i]! : w - (w - mins[i]!) * pay));
}

/**
 * The widths after moving the right edge of column `i` by `delta` px, with the total unchanged: a wider column takes space from the columns to its
 * right, nearest first, never taking one below its minimum (so the drag stops when they are all at their minimums); a narrower one gives its space
 * to the next column, and never goes below its own minimum.
 */
export function resizeColumns(widths: number[], i: number, delta: number, mins: number[] = widths.map(() => MIN_COLUMN_PX)): number[] {
  const out = [...widths];
  if (i >= widths.length - 1) return out;
  const room = (j: number) => Math.max(0, widths[j]! - mins[j]!);
  if (delta >= 0) {
    let want = Math.min(delta, widths.slice(i + 1).reduce((t, _, k) => t + room(i + 1 + k), 0));
    out[i] = widths[i]! + want;
    for (let j = i + 1; j < widths.length && want > 0; j++) { const take = Math.min(want, room(j)); out[j] = widths[j]! - take; want -= take; }
  } else {
    const give = Math.min(-delta, room(i));
    out[i] = widths[i]! - give; out[i + 1] = widths[i + 1]! + give;
  }
  return out;
}

/** Adds the drag handles to the headers of `table` (once). Returns false when it has nothing to resize. */
export function enhanceTable(table: HTMLTableElement): boolean {
  if (table.hasAttribute(DONE)) return true;
  const row = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!row || row.cells.length < 2) return false;
  table.setAttribute(DONE, '');
  const cells = [...row.cells];
  let frozen = false;
  const freeze = () => {
    if (frozen) return;
    frozen = true;
    const widths = atLeastMinimum(cells.map((c) => c.getBoundingClientRect().width), minimums(cells));
    const box = table.parentElement;
    // A table whose columns cannot all fit at the minimum is wider than its box: let the box scroll rather than spill out.
    if (box && getComputedStyle(box).overflowX === 'visible') box.style.overflowX = 'auto';
    cells.forEach((c, i) => { c.style.width = `${widths[i]}px`; c.style.minWidth = '0'; });
    table.style.tableLayout = 'fixed';
    table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
    table.setAttribute('data-col-fixed', '');
  };
  cells.forEach((cell, i) => {
    if (cell.colSpan > 1 || i === cells.length - 1) return;
    cell.style.position = 'relative';
    let dragging = false;
    const handle = document.createElement('span');
    handle.setAttribute('data-col-handle', '');
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Resize the ${cell.textContent?.trim() || 'column'} column`);
    Object.assign(handle.style, { position: 'absolute', top: '0', right: '0', bottom: '0', width: '8px', cursor: 'col-resize', touchAction: 'none', userSelect: 'none', borderRight: '2px solid transparent', zIndex: '1' });
    handle.addEventListener('pointerenter', () => { handle.style.borderRightColor = 'var(--mantine-color-gray-4, #ced4da)'; });
    handle.addEventListener('pointerleave', () => { if (!dragging) handle.style.borderRightColor = 'transparent'; });
    handle.addEventListener('click', (e) => e.stopPropagation());   // a header that sorts or selects must not react to the drag
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      freeze(); dragging = true;
      const startX = e.clientX, start = cells.map((c) => c.getBoundingClientRect().width);
      try { handle.setPointerCapture(e.pointerId); } catch { /* not supported: the document listeners below still follow the pointer */ }
      const move = (m: PointerEvent) => {
        const next = resizeColumns(start, i, m.clientX - startX, minimums(cells));
        cells.forEach((c, k) => { c.style.width = `${next[k]}px`; });
      };
      const up = () => { dragging = false; handle.style.borderRightColor = 'transparent'; document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
    cell.appendChild(handle);
  });
  return true;
}

/** Enhances every table now and each one that appears later. Returns a function that stops watching. */
export function installColumnResize(root: HTMLElement = document.body): () => void {
  if (!document.getElementById('col-resize-style')) {
    // Once the columns are fixed, a cell holds only as much as its width: it must clip rather than spill into the next column.
    const style = document.createElement('style'); style.id = 'col-resize-style';
    style.textContent = 'table[data-col-fixed] th, table[data-col-fixed] td { overflow: hidden; text-overflow: ellipsis; }';
    document.head.appendChild(style);
  }
  const scan = () => root.querySelectorAll('table').forEach((t) => { if (!t.hasAttribute(DONE)) enhanceTable(t); });
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
