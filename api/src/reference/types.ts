export interface PaperView {
  id: number;
  /** As it arrives in the XML. Fixed: it is how an incoming job finds its paper. */
  name: string;
  /** Papers with the same batch name are printed together and batch together, e.g. "A4 Plain" and "A4 White" both -> "A4 WHITE". */
  batchName: string;
  paperCode: string | null;
  /** Print option sets (so jobs) that use this paper. A paper that is used cannot be deleted. */
  usedBy: number;
}
export interface PaperInput { batchName: string; paperCode: string | null }

export interface FormatView {
  id: number;
  name: string;
  rank: number;
  maxWeightG: number;
  maxThicknessMm: number | null;
  maxSheets: number | null;
  /** Royal Mail length: the longer side, mm. */
  maxLengthMm: number;
  /** Royal Mail width: the shorter side, mm. */
  maxWidthMm: number;
  /** Postal services that use this format. */
  usedBy: number;
}
export interface FormatInput { maxWeightG: number; maxThicknessMm: number | null; maxSheets: number | null; maxLengthMm: number; maxWidthMm: number }

/** A size an insert can be shown as (A4, A3, DL ...). */
export interface InsertSizeView { id: number; name: string; /** Width and height in mm, filled into an insert when this size is chosen for it; null when not set. */ widthMm: number | null; heightMm: number | null; /** Inserts using it. A size that is used cannot be removed. */ usedBy: number }
export interface InsertSizeInput { widthMm: number | null; heightMm: number | null }

export interface HistoryEntry { id: number; changedAt: string; changedBy: string; summary: string }

export interface ReferenceStore {
  papers(): Promise<PaperView[]>;
  updatePaper(id: number, input: PaperInput, by: string): Promise<void>;
  deletePaper(id: number, by: string): Promise<void>;
  formats(): Promise<FormatView[]>;
  updateFormat(id: number, input: FormatInput, by: string): Promise<void>;
  /** The normalised texts, in order. */
  anonymous(): Promise<string[]>;
  /** Normalises the text and adds it; returns what was stored. */
  addAnonymous(text: string, by: string): Promise<string>;
  deleteAnonymous(normalised: string, by: string): Promise<void>;
  insertSizes(): Promise<InsertSizeView[]>;
  addInsertSize(name: string, by: string): Promise<InsertSizeView>;
  updateInsertSize(id: number, input: InsertSizeInput, by: string): Promise<void>;
  deleteInsertSize(id: number, by: string): Promise<void>;
  history(limit: number): Promise<HistoryEntry[]>;
}
