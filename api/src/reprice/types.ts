export interface RepriceScope { accountId: number; from: string | null; to: string | null; overwrite: boolean }
export interface RepricePreview { inScope: number; alreadyPriced: number; wouldPrice: number; noModel: number; unknownColours: number }
export interface RepriceResult { priced: number; noModel: number; unknownColours: number }
/** What the ingest package's Repricer offers. Kept as a shape here so the API does not share a database driver with it. */
export interface RepriceEngine { preview(scope: RepriceScope): Promise<RepricePreview>; run(scope: RepriceScope): Promise<RepriceResult> }
export interface RepriceInput { from: string | null; to: string | null; overwrite: boolean }
export interface RepriceStore {
  preview(customerId: number, input: RepriceInput): Promise<RepricePreview>;
  run(customerId: number, input: RepriceInput, by: string): Promise<RepriceResult>;
}
