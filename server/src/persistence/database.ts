import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { runMigrations } from './migrate';
import * as schema from './schema';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export function getDatabaseConfig(): DatabaseConfig {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: url.searchParams.get('sslmode') === 'require',
    };
  }

  const password = process.env.DB_PASSWORD;
  if (!password && process.env.NODE_ENV === 'production') {
    throw new Error('DB_PASSWORD is required in production. Set it in .env or environment.');
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'eliza_dungeons',
    user: process.env.DB_USER || 'postgres',
    password: password || 'postgres', // default only for local dev
    ssl: process.env.DB_SSL === 'true',
  };
}

/**
 * True when no external Postgres is configured. In that case we run an
 * embedded Postgres (PGlite) in-process so the server starts with zero setup.
 */
export function usesEmbeddedDatabase(): boolean {
  return !process.env.DATABASE_URL && !process.env.DB_HOST && !process.env.DB_PASSWORD;
}

let embedded: { close: () => Promise<void> } | null = null;

async function initializeEmbedded(): Promise<void> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');

  // PGLITE_DIR persists data to disk; default is in-memory (rooms are in-memory too).
  const dataDir = process.env.PGLITE_DIR || undefined;
  const client = new PGlite(dataDir);
  await client.waitReady;

  await runMigrations((sql) => client.exec(sql).then(() => undefined), async () => {
    const res = await client.query<{ t: string | null }>(`SELECT to_regclass('public.campaigns')::text AS t`);
    return res.rows[0]?.t != null;
  });

  embedded = client;
  db = drizzlePglite(client, { schema }) as unknown as ReturnType<typeof drizzle<typeof schema>>;
  console.log(`Database: embedded Postgres (${dataDir ? `persisted at ${dataDir}` : 'in-memory'})`);
}

export async function initializeDatabase(config?: DatabaseConfig): Promise<void> {
  if (db) {
    console.log('Database already initialized');
    return;
  }

  if (!config && usesEmbeddedDatabase()) {
    await initializeEmbedded();
    return;
  }

  const dbConfig = config || getDatabaseConfig();

  pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl ? { rejectUnauthorized: false } : undefined,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('Database pool error:', err.message);
  });

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    // Create tables on first boot so a fresh database needs no manual migrate step.
    await runMigrations((sql) => client.query(sql).then(() => undefined), async () => {
      const res = await client.query(`SELECT to_regclass('public.campaigns')::text AS t`);
      return res.rows[0]?.t != null;
    });
  } finally {
    client.release();
  }

  db = drizzle(pool, { schema });

  console.log(`Database connected to ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
}

export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized (or running on the embedded database, which has no pool).');
  }
  return pool;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (embedded) {
    await embedded.close();
    embedded = null;
  }
  if (db) {
    db = null;
    console.log('Database connection closed');
  }
}

export async function withTransaction<T>(
  callback: (tx: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
): Promise<T> {
  const database = getDatabase();
  return database.transaction(async (tx) => {
    return callback(tx as unknown as ReturnType<typeof drizzle<typeof schema>>);
  });
}

export function isDatabaseConnected(): boolean {
  return db !== null;
}

export { schema };
