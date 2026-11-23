/**
 * Lets the user drag the right edge of any table column header to resize that column, in every table of the app, without each page doing anything.
 * A watcher adds a drag handle to every header cell of every table (including tables that appear later, such as when data arrives or a tab opens).
 * The first drag fixes every column at its current width, so the others stay where they are and a table wider than its box scrolls sideways.
 */
export const MIN_COLUMN_PX = 40;
const DONE = 'data-col-resize';

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
    const widths = cells.map((c) => c.getBoundingClientRect().width);
    const box = table.parentElement;
    // The table may now be wider than the space it sits in: let that box scroll rather than spill out.
    if (box && getComputedStyle(box).overflowX === 'visible') box.style.overflowX = 'auto';
    cells.forEach((c, i) => { c.style.width = `${widths[i]}px`; c.style.minWidth = `${widths[i]}px`; });
    table.style.tableLayout = 'fixed';
    table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
    table.style.maxWidth = 'none';
    table.setAttribute('data-col-fixed', '');
  };
  cells.forEach((cell) => {
    if (cell.colSpan > 1) return;
    cell.style.position = 'relative';
    const handle = document.createElement('span');
    let dragging = false;
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
      const startX = e.clientX, startWidth = cell.getBoundingClientRect().width, startTable = table.getBoundingClientRect().width;
      try { handle.setPointerCapture(e.pointerId); } catch { /* not supported: the document listeners below still follow the pointer */ }
      const move = (m: PointerEvent) => {
        const w = Math.max(MIN_COLUMN_PX, startWidth + (m.clientX - startX));
        cell.style.width = `${w}px`; cell.style.minWidth = `${w}px`;
        table.style.width = `${startTable + (w - startWidth)}px`;
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); dragging = false; handle.style.borderRightColor = 'transparent'; };
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
