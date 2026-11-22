import sql from 'mssql';
import { longTimeout } from '../mssql/devDb.js';
import { allocateCodes } from './stockCodes.js';

/**
 * Gives every stock item that has no stock_code a unique 5-digit code (existing codes are never changed).
 *   npm run stock:codes                  list what would be assigned
 *   npm run stock:codes -- --apply       assign them   (add --start=20001 to choose the first number)
 * Order is customer, type, description, id, so a given set of items always gets the same codes.
 */
const apply = process.argv.includes('--apply');
const start = Number(process.argv.find((a) => a.startsWith('--start='))?.slice(8) ?? 10001);
const cs = process.env['INTELLIDOC_DB'];
if (!cs) { console.error('Set INTELLIDOC_DB first'); process.exit(2); }
const pool = new sql.ConnectionPool(longTimeout(cs));
await pool.connect();
const tx = new sql.Transaction(pool);
await tx.begin();
try {
  const q = async <T>(text: string): Promise<T[]> => (await new sql.Request(tx).query(text)).recordset as T[];
  const used = (await q<{ stock_code: string }>('SELECT stock_code FROM idoc.stock_item WHERE stock_code IS NOT NULL')).map((r) => r.stock_code);
  const items = await q<{ stock_item_id: number; customer: string | null; stock_type: string | null; description: string }>(
    `SELECT s.stock_item_id, a.name AS customer, s.stock_type, s.description FROM idoc.stock_item s LEFT JOIN idoc.account a ON a.account_id = s.account_id
     WHERE s.stock_code IS NULL ORDER BY a.name, s.stock_type, s.description, s.stock_item_id`);
  const codes = allocateCodes(used, items.length, start);
  items.forEach((it, i) => console.log(`${codes[i]}  ${it.customer ?? '(no owner)'} | ${it.stock_type ?? ''} | ${it.description}`));
  if (apply) {
    for (const [i, it] of items.entries())
      await new sql.Request(tx).input('c', sql.NVarChar(50), codes[i]).input('i', sql.Int, it.stock_item_id).query('UPDATE idoc.stock_item SET stock_code = @c WHERE stock_item_id = @i AND stock_code IS NULL');
    await tx.commit();
    console.log(`\nAssigned ${items.length} codes.`);
  } else { await tx.rollback(); console.log(`\n${items.length} items would get a code. Add --apply to assign them.`); }
} catch (e) { try { await tx.rollback(); } catch { /* already rolled back */ } throw e; } finally { await pool.close(); }
