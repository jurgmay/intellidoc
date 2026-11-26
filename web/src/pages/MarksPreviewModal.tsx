import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Box, Button, Center, Group, Loader, Modal, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { getMarksPreview, type MarksPreviewPage, type SettingValue } from '../api/settings';

const MIN_ZOOM = 1, MAX_ZOOM = 6, ZOOM_STEP = 1.25;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface Props { opened: boolean; onClose: () => void; /** The values on screen, saved or not. */ values: Record<string, SettingValue> }

/** A picture of the page with the envelope window and the control marks where the settings put them, drawn by the same code that makes the print files. */
export function MarksPreviewModal({ opened, onClose, values }: Props) {
  const [page, setPage] = useState<MarksPreviewPage>('window');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 1 = the whole page fits in the box; larger values enlarge it and the box scrolls. */
  const [zoom, setZoom] = useState(1);
  /** The width in pixels at which the whole page fits the box; 0 until the picture has loaded and been measured. */
  const [fitWidth, setFitWidth] = useState(0);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!box || !img || !img.naturalWidth || !box.clientWidth || !box.clientHeight) return;
    setFitWidth(Math.floor(Math.min(box.clientWidth - 2, (box.clientHeight - 2) * img.naturalWidth / img.naturalHeight)));
  }, [box]);

  // Ctrl (or Cmd) and the mouse wheel zoom the picture instead of the browser page. Added by hand because React's wheel handler cannot prevent the default.
  useEffect(() => {
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(e.deltaY < 0 ? z * ZOOM_STEP : z / ZOOM_STEP));
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    // The page is fitted to the box again when the window changes size.
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    resized?.observe(box);
    return () => { box.removeEventListener('wheel', onWheel); resized?.disconnect(); };
  }, [box, measure]);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false, made: string | null = null;
    setUrl(null); setError(null);
    getMarksPreview(page, values).then((blob) => {
      if (cancelled) return;
      made = URL.createObjectURL(blob); setUrl(made);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
    // The picture is drawn when the window opens or the page is changed; values on screen at that moment are used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, page]);

  return (
    <Modal opened={opened} onClose={onClose} title="Where the control marks fall" size="min(1200px, 95vw)" yOffset={0}
      styles={{ content: { height: '100dvh', maxHeight: '100dvh', display: 'flex', flexDirection: 'column' }, body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }}>
      <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
        <SegmentedControl value={page} onChange={(v) => setPage(v as MarksPreviewPage)} data={[
          { value: 'window', label: 'First page of a mailpiece' }, { value: 'mrdf', label: 'MRDF page codes' }]} />
        <Text size="xs" c="dimmed">
          Drawn from the values on screen, including changes you have not saved. To check a change, close this window, edit, and open it again. The blue box is the envelope window; the orange dashes are the boxes the marks are fitted in (the solid edge of the OCR box is where its text starts; the box is not turned, so make it tall for 90° or 270°). The grid is every 10 mm from the top left of the page.
        </Text>
        {error && <Alert color="red" icon={<IconAlertCircle />} title="Could not draw the preview">{error}</Alert>}
        {!error && !url && <Center h={300} style={{ flex: 1 }}><Loader /></Center>}
        {url && (
          <>
            <Group gap="xs" justify="flex-end">
              <Tooltip label="Zoom out"><ActionIcon variant="default" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => clampZoom(z / ZOOM_STEP))}><IconZoomOut size={18} /></ActionIcon></Tooltip>
              <Text size="sm" w={48} ta="center" aria-label="Zoom level">{Math.round(zoom * 100)}%</Text>
              <Tooltip label="Zoom in"><ActionIcon variant="default" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => clampZoom(z * ZOOM_STEP))}><IconZoomIn size={18} /></ActionIcon></Tooltip>
              <Button variant="default" size="compact-sm" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit page</Button>
            </Group>
            <Box ref={setBox} mih={200} style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--mantine-color-gray-4)', background: 'var(--mantine-color-gray-0)' }}>
              <img ref={imgRef} src={url} onLoad={measure}
                style={{ display: 'block', margin: '0 auto', maxWidth: 'none', width: fitWidth ? fitWidth * zoom : `${zoom * 100}%` }}
                alt={page === 'window' ? 'The first page of a mailpiece with the envelope window and control marks' : 'A sheet front with the MRDF page codes'} />
            </Box>
            <Text size="xs" c="dimmed">Use the buttons, or hold Ctrl and turn the mouse wheel, to zoom. When zoomed in, scroll or drag the scroll bars to move around.</Text>
          </>
        )}
      </Stack>
    </Modal>
  );
}
