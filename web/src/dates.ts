/** dd/mm/yyyy from an ISO date or timestamp ("2026-11-18" or "2026-11-18T09:30:00"), read as written (no time zone shift). Anything else is returned as it is. */
export function ukDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** dd/mm/yyyy hh:mm from an ISO timestamp. */
export function ukDateTime(iso: string): string {
  const t = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(iso);
  return t ? `${ukDate(iso)} ${t[1]}:${t[2]}` : ukDate(iso);
}
