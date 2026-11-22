import type { InvoicingAccount, MarginLine, ReportStore, UsageLine, UsageQuery } from './types.js';

/** In-memory report data for the stub server and the tests. */
export class MemoryReportStore implements ReportStore {
  accounts: InvoicingAccount[] = [];
  lines = new Map<number, UsageLine[]>();
  marginLines_ = new Map<number, MarginLine[]>();
  async invoicingAccounts(): Promise<InvoicingAccount[]> { return this.accounts; }
  async usageLines(q: UsageQuery) {
    const account = this.accounts.find((a) => a.id === q.invoicingAccountId);
    if (!account) return null;
    return { account, lines: (this.lines.get(account.id) ?? []).filter((l) => l.day >= q.from && l.day <= q.to) };
  }
  async marginLines(q: UsageQuery) {
    const account = this.accounts.find((a) => a.id === q.invoicingAccountId);
    if (!account) return null;
    return { account, lines: (this.marginLines_.get(account.id) ?? []).filter((l) => l.day >= q.from && l.day <= q.to) };
  }
}
