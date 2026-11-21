/** 422: the request is well formed but a value is not acceptable. One message per field. */
export class ValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) { super(Object.values(fieldErrors).join(' ')); }
}
/** 409: the change would clash with existing data (duplicate code, record in use). */
export class ConflictError extends Error {}
/** 404 */
export class NotFoundError extends Error {}
