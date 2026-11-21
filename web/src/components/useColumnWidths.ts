import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

export interface ColumnSpec<Row> {
  key: string;
  /** Text used to work out the width the column needs so nothing wraps. */
  header: string;
  cell: (row: Row) => string;
  /** Extra width for indents or badges, in pixels. */
  extra?: number | ((row: Row) => number);
  min?: number;
}

const FONT = '14px Poppins, system-ui, sans-serif';
const HEADER_FONT = '600 14px Poppins, system-ui, sans-serif';
const PADDING = 28; // cell padding plus a little air

let canvas: CanvasRenderingContext2D | null | undefined;
/** Width of a piece of text in pixels. jsdom (the tests) has no canvas, so it falls back to an estimate. */
function textWidth(text: string, font: string): number {
  if (canvas === undefined) { try { canvas = document.createElement('canvas').getContext('2d'); } catch { canvas = null; } }
  if (!canvas) return text.length * 8.4;
  canvas.font = font;
  return canvas.measureText(text).width;
}

/**
 * Column widths for a table whose columns fit their content (no wrapping) and can be dragged wider or narrower.
 * Dragged widths are remembered in this browser; double-click a handle to fit that column to its content again.
 */
export function useColumnWidths<Row>(storageKey: string, columns: ColumnSpec<Row>[], rows: Row[]) {
  const [custom, setCustom] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, number>; } catch { return {}; }
  });
  const fitted = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of columns) {
      let w = textWidth(c.header, HEADER_FONT);
      for (const r of rows) w = Math.max(w, textWidth(c.cell(r), FONT) + (typeof c.extra === 'function' ? c.extra(r) : c.extra ?? 0));
      out[c.key] = Math.ceil(Math.max(w + PADDING, c.min ?? 60));
    }
    return out;
  }, [columns, rows]);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(custom)); } catch { /* storage unavailable: widths just are not remembered */ } }, [storageKey, custom]);

  const widthOf = useCallback((key: string) => custom[key] ?? fitted[key] ?? 100, [custom, fitted]);
  const drag = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const startResize = (key: string) => (e: ReactMouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    drag.current = { key, startX: e.clientX, startWidth: widthOf(key) };
    setDragging(key);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const d = drag.current; if (!d) return;
      const min = columns.find((c) => c.key === d.key)?.min ?? 40;
      setCustom((c) => ({ ...c, [d.key]: Math.max(min, Math.round(d.startWidth + e.clientX - d.startX)) }));
    };
    const up = () => { drag.current = null; setDragging(null); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging, columns]);

  const fit = (key: string) => setCustom((c) => { const { [key]: _gone, ...rest } = c; return rest; });
  const total = columns.reduce((sum, c) => sum + widthOf(c.key), 0);
  return { widthOf, startResize, fit, total, dragging };
}
