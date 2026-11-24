import { NotFoundError } from '../errors.js';
import type { SearchScope } from '../recipients/types.js';
import type { AuditMailpiece, AuditStore } from './types.js';

export interface MemoryAudit extends AuditMailpiece { /** The submitting account and every account above it. */ ancestors: number[] }

/** In-memory audit details for the stub server and the tests. */
export class MemoryAuditStore implements AuditStore {
  scopeList: SearchScope[] = [];
  rows: MemoryAudit[] = [];
  async details(accountId: number, ids: number[]) {
    const scope = this.scopeList.find((s) => s.id === accountId);
    if (!scope) throw new NotFoundError('That account does not exist.');
    const found = ids.map((id) => this.rows.find((r) => r.mailpieceId === id && r.ancestors.includes(accountId))).filter((r): r is MemoryAudit => !!r);
    return { scopeLabel: scope.label, rows: found.map(({ ancestors: _a, ...r }) => r) };
  }
}
