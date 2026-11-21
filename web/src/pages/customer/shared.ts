import { notifications } from '@mantine/notifications';
import type { CustomerDetail, DetailsInput, Lookups } from '../../api/customers';
import { ApiError } from '../../api/client';

/** What each customer tab is given by the page that loaded the customer. */
export interface TabProps {
  detail: CustomerDetail;
  lookups: Lookups;
  /** Reload the customer after a change. */
  reload: () => Promise<void>;
  /** Save the customer record with some fields changed. */
  patchDetails: (patch: Partial<DetailsInput>) => Promise<void>;
}

export interface RunResult { ok: boolean; fieldErrors?: Record<string, string>; message?: string }

/** Runs a save, shows a success or error notification, and hands back the field errors for the form to show. */
export async function run(action: () => Promise<unknown>, success: string): Promise<RunResult> {
  try {
    await action();
    notifications.show({ color: 'teal', title: 'Saved', message: success });
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    notifications.show({ color: 'red', title: 'Not saved', message: err.message });
    return { ok: false, fieldErrors: e instanceof ApiError ? e.fieldErrors : undefined, message: err.message };
  }
}

export const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());
