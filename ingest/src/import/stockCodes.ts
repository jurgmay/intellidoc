/** Next free codes for items that have none: 5-digit numbers from `start`, skipping any code already in use. Deterministic. */
export function allocateCodes(inUse: Iterable<string>, count: number, start = 10001): string[] {
  const used = new Set([...inUse].map((c) => c.toUpperCase()));
  const out: string[] = [];
  for (let n = start; out.length < count; n++) {
    if (n > 99999) throw new Error('Ran out of 5-digit stock codes');
    const c = String(n);
    if (!used.has(c)) out.push(c);
  }
  return out;
}
