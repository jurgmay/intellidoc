/** Thin fetch wrapper. Errors carry the server's message, and the per-field messages when there are some. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly fieldErrors?: Record<string, string>) { super(message); }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const fieldErrors = data['errors'] as Record<string, string> | undefined;
    const msg = (data['error'] as string | undefined) ?? (fieldErrors ? Object.values(fieldErrors).join(' ') : `Request failed (${res.status})`);
    throw new ApiError(msg, res.status, fieldErrors);
  }
  return data as T;
}
