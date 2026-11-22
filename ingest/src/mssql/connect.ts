import sql from 'mssql';

/**
 * Opens a connection pool with the mssql driver that the ingest code imports. The API calls ingest code from its own folder and has its own copy
 * of the driver; passing a pool made by that copy into ingest code fails ("type.validate is not a function"), so code that calls ingest owns a
 * pool made here.
 */
export function connectPool(connectionString: string): Promise<sql.ConnectionPool> {
  return new sql.ConnectionPool(connectionString).connect();
}
