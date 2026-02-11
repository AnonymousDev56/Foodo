import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

const DEFAULT_DATABASE_URL = "postgresql://foodo:foodo@localhost:5432/foodo";
const MIGRATION_LOCK_KEY = 8342001;

type SqlScalar = string | number | boolean | Date | null;
export type SqlParam = SqlScalar | SqlScalar[];

export interface DbExecutor {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: SqlParam[]): Promise<QueryResult<T>>;
}

export interface DatabaseClient extends DbExecutor {
  init(): Promise<void>;
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function resolveMigrationPath() {
  const candidates = [
    path.resolve(process.cwd(), "infra/postgres/migrations/001_init.sql"),
    path.resolve(process.cwd(), "../infra/postgres/migrations/001_init.sql"),
    path.resolve(process.cwd(), "../../infra/postgres/migrations/001_init.sql"),
    path.resolve(process.cwd(), "../../../infra/postgres/migrations/001_init.sql")
  ];

  const migrationPath = candidates.find((candidate) => existsSync(candidate));
  if (!migrationPath) {
    throw new Error("Unable to locate migration file: infra/postgres/migrations/001_init.sql");
  }

  return migrationPath;
}

function loadMigrationSql() {
  const migrationPath = resolveMigrationPath();
  return readFileSync(migrationPath, "utf8");
}

export function createDatabaseClient(serviceName: string, databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): DatabaseClient {
  const pool = new Pool({ connectionString: databaseUrl });
  let initialized = false;
  let initPromise: Promise<void> | null = null;

  const query: DbExecutor["query"] = async (sql, params = []) => pool.query(sql, params);

  const init = async () => {
    if (initialized) {
      return;
    }
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      const sql = loadMigrationSql();
      const client = await pool.connect();
      try {
        // Serialize migration/seed execution across all services to avoid startup deadlocks.
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await client.query(sql);
      } finally {
        try {
          await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
        } catch {
          // No-op: unlock can fail if connection already dropped.
        }
        client.release();
      }
      initialized = true;
      // Keep startup logs visible per service; helps debug infra issues fast.
      console.log(`[${serviceName}] PostgreSQL migration+seed ready`);
    })();

    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  };

  const transaction: DatabaseClient["transaction"] = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tx: DbExecutor = {
        query: async (sql, params = []) => client.query(sql, params)
      };
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const close = async () => {
    await pool.end();
  };

  return {
    query,
    init,
    transaction,
    close
  };
}

export async function probeDatabase(databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("SELECT 1");
    return true;
  } finally {
    await pool.end();
  }
}
