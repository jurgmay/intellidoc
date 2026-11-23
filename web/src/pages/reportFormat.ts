export const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const nf = (v: number): string => v.toLocaleString('en-GB');
export const gbp = (v: number): string => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
export const shortDay = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
