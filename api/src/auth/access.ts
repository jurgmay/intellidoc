import type { SessionUser } from './session.js';

/** The two roles, as they are named in the Entra ID app registration (App roles). Admin includes everything User can do. */
export const ROLE_USER = 'User';
export const ROLE_ADMIN = 'Admin';

export const hasRole = (u: SessionUser, role: string): boolean => u.roles.includes(ROLE_ADMIN) || u.roles.includes(role);

interface Rule { prefix: string; /** Only these methods need the role; omit for every method. */ methods?: string[] }
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * What only an Admin may do. Everything else needs the User role. Settings and the margin report show or change money and production
 * behaviour; the reference data, price lists, postal rates and re-pricing change what customers are charged.
 */
export const ADMIN_ONLY: Rule[] = [
  { prefix: '/api/settings' },
  { prefix: '/api/reports/margin' },
  { prefix: '/api/reference' },
  { prefix: '/api/costing', methods: WRITES },
  { prefix: '/api/postal', methods: WRITES },
  { prefix: '/api/reprice' },
];

export function needsAdmin(method: string, path: string): boolean {
  return ADMIN_ONLY.some((r) => (path === r.prefix || path.startsWith(`${r.prefix}/`) || path.startsWith(`${r.prefix}.`)) && (!r.methods || r.methods.includes(method.toUpperCase())));
}
