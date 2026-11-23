import { useEffect, useState } from 'react';
import { Alert, Center, Image, Loader, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { getMarksPreview, type MarksPreviewPage, type SettingValue } from '../api/settings';

interface Props { opened: boolean; onClose: () => void; /** The values on screen, saved or not. */ values: Record<string, SettingValue> }

/** A picture of the page with the envelope window and the control marks where the settings put them, drawn by the same code that makes the print files. */
export function MarksPreviewModal({ opened, onClose, values }: Props) {
  const [page, setPage] = useState<MarksPreviewPage>('window');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <Modal opened={opened} onClose={onClose} title="Where the control marks fall" size="xl" centered>
      <Stack gap="sm">
        <SegmentedControl value={page} onChange={(v) => setPage(v as MarksPreviewPage)} data={[
          { value: 'window', label: 'First page of a mailpiece' }, { value: 'mrdf', label: 'MRDF page codes' }]} />
        <Text size="xs" c="dimmed">
          Drawn from the values on screen, including changes you have not saved. To check a change, close this window, edit, and open it again. The blue box is the envelope window; the orange dashes are the boxes the marks are fitted in (the solid edge of the OCR box is where its text starts; the box is not turned, so make it tall for 90° or 270°). The grid is every 10 mm from the top left of the page.
        </Text>
        {error && <Alert color="red" icon={<IconAlertCircle />} title="Could not draw the preview">{error}</Alert>}
        {!error && !url && <Center h={300}><Loader /></Center>}
        {url && (
          <Image src={url} fit="contain" mah="calc(100vh - 340px)" mx="auto" style={{ border: '1px solid var(--mantine-color-gray-4)' }}
            alt={page === 'window' ? 'The first page of a mailpiece with the envelope window and control marks' : 'A sheet front with the MRDF page codes'} />
        )}
      </Stack>
    </Modal>
  );
}
