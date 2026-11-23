/** The marks preview: the settings turned into what the composer draws, and the function that draws it. */
import { renderMarksPreview, type PreviewPage, type WindowSettings } from '../../../ingest/src/compose/preview.js';
import type { MarkSettings, PageSize } from '../../../ingest/src/compose/marks.js';
import type { SettingValue } from './catalogue.js';

/** Draws the page and returns PNG bytes. Replaceable, so tests need no Ghostscript. */
export type MarksPreviewer = (page: PreviewPage, marks: MarkSettings, window: WindowSettings, size: PageSize) => Promise<Uint8Array>;
export const drawMarksPreview: MarksPreviewer = (page, marks, window, size) => renderMarksPreview(page, marks, window, size);

export function marksFromValues(v: Record<string, SettingValue>): MarkSettings {
  const n = (k: string): number => v[k] as number;
  return {
    seq: { fontPt: n('markSeqFontPt'), leftMm: n('markSeqLeftMm'), topMm: n('markSeqTopMm'), widthMm: n('markSeqWidthMm'), heightMm: n('markSeqHeightMm') },
    dm: { leftMm: n('markDmLeftMm'), topMm: n('markDmTopMm'), widthMm: n('markDmWidthMm'), heightMm: n('markDmHeightMm') },
    dot: { xMm: n('markDotXMm'), yMm: n('markDotYMm'), diameterMm: n('markDotDiameterMm') },
    mrdf: {
      dm: { leftMm: n('mrdfDmLeftMm'), topMm: n('mrdfDmTopMm'), widthMm: n('mrdfDmWidthMm'), heightMm: n('mrdfDmHeightMm') },
      ocr: { fontPt: n('mrdfOcrFontPt'), leftMm: n('mrdfOcrLeftMm'), topMm: n('mrdfOcrTopMm'), widthMm: n('mrdfOcrWidthMm'), heightMm: n('mrdfOcrHeightMm'), rotationDeg: n('mrdfOcrRotationDeg') },
    },
  };
}
export const windowFromValues = (v: Record<string, SettingValue>): WindowSettings =>
  ({ leftMm: v['windowLeftMm'] as number, topMm: v['windowTopMm'] as number, widthMm: v['windowWidthMm'] as number, heightMm: v['windowHeightMm'] as number });
export const pageSizeFromValues = (v: Record<string, SettingValue>): PageSize => ({ widthMm: v['pageWidthMm'] as number, heightMm: v['pageHeightMm'] as number });
