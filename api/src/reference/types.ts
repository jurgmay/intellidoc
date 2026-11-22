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
  /** Postal services that use this format. */
  usedBy: number;
}
export interface FormatInput { maxWeightG: number; maxThicknessMm: number | null; maxSheets: number | null }

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
  history(limit: number): Promise<HistoryEntry[]>;
}
