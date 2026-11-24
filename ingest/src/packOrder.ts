/** Packs are put in this order before they are matched into mailpieces, and mailpieces are numbered in it: owner account, owner user, release date, then position in the source PDF. */
export interface PackOrderKey { ownerAccount: string; ownerUser: string; releaseDate: Date; startPage: number }

const text = (a: string, b: string): number => { const x = a.trim().toLowerCase(), y = b.trim().toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

export const comparePacks = (a: PackOrderKey, b: PackOrderKey): number =>
  text(a.ownerAccount, b.ownerAccount) || text(a.ownerUser, b.ownerUser) || a.releaseDate.getTime() - b.releaseDate.getTime() || a.startPage - b.startPage;
