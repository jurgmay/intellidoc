import type { InvoicingAccount, ReportStore, UsageLine, UsageQuery } from './types.js';

/** In-memory report data for the stub server and the tests. */
export class MemoryReportStore implements ReportStore {
  accounts: InvoicingAccount[] = [];
  lines = new Map<number, UsageLine[]>();
  async invoicingAccounts(): Promise<InvoicingAccount[]> { return this.accounts; }
  async usageLines(q: UsageQuery) {
    const account = this.accounts.find((a) => a.id === q.invoicingAccountId);
    if (!account) return null;
    return { account, lines: (this.lines.get(account.id) ?? []).filter((l) => l.day >= q.from && l.day <= q.to) };
  }
}
