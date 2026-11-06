import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

/**
 * Тонкая обёртка над базой: в продакшене — настоящий PostgreSQL (DATABASE_URL),
 * для разработки и тестов — встроенный PGlite (тот же Postgres, без установки).
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

function fromPglite(pg: PGlite | Parameters<Parameters<PGlite['transaction']>[0]>[0]): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params as never[])).rows;
    },
    async tx(fn) {
      if (!('transaction' in pg)) return fn(this);
      return (pg as PGlite).transaction((t) => fn(fromPglite(t)));
    },
    async close() {
      if ('close' in pg) await (pg as PGlite).close();
    },
  };
}

function fromPostgres(sql: postgres.Sql | postgres.TransactionSql): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params.map((p) => (p !== null && typeof p === 'object' ? sql.json(p as never) : p)) as never[])) as unknown as T[];
    },
    async tx(fn) {
      if (!('begin' in sql)) return fn(this);
      return (sql as postgres.Sql).begin((t) => fn(fromPostgres(t))) as never;
    },
    async close() {
      if ('end' in sql) await (sql as postgres.Sql).end();
    },
  };
}

export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  const db = opts.url ? fromPostgres(postgres(opts.url, { max: 10 })) : fromPglite(new PGlite(opts.dataDir));
  await migrate(db);
  return db;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id text PRIMARY KEY,
    username text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    is_admin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  CREATE TABLE campaigns (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    dm_id text NOT NULL REFERENCES users(id),
    invite_code text NOT NULL UNIQUE,
    settings jsonb NOT NULL DEFAULT '{}',
    combat jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE content (
    id text PRIMARY KEY,
    kind text NOT NULL,
    name text NOT NULL,
    owner_id text REFERENCES users(id) ON DELETE CASCADE,
    campaign_id text REFERENCES campaigns(id) ON DELETE CASCADE,
    visibility text NOT NULL DEFAULT 'private',
    source text NOT NULL DEFAULT 'custom',
    source_url text,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX content_kind_name ON content(kind, name);
  CREATE UNIQUE INDEX content_source_url ON content(source_url) WHERE source_url IS NOT NULL AND owner_id IS NULL;
  CREATE TABLE characters (
    id text PRIMARY KEY,
    owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id text REFERENCES campaigns(id) ON DELETE SET NULL,
    data jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE campaign_members (
    campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, user_id)
  );
  CREATE TABLE npcs (
    id text PRIMARY KEY,
    campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE achievements (
    id text PRIMARY KEY,
    campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    icon text NOT NULL DEFAULT 'star',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE achievement_awards (
    id text PRIMARY KEY,
    achievement_id text NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    note text NOT NULL DEFAULT '',
    awarded_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE events (
    id bigserial PRIMARY KEY,
    campaign_id text REFERENCES campaigns(id) ON DELETE CASCADE,
    actor_id text REFERENCES users(id) ON DELETE SET NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    type text NOT NULL,
    summary text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}',
    before jsonb,
    undone boolean NOT NULL DEFAULT false,
    hidden boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX events_campaign ON events(campaign_id, id DESC);
  `,
];

async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_version (version integer NOT NULL)`);
  const rows = await db.query<{ version: number }>(`SELECT version FROM schema_version`);
  let current = rows[0]?.version ?? 0;
  if (!rows.length) await db.query(`INSERT INTO schema_version VALUES (0)`);
  for (; current < MIGRATIONS.length; current++) {
    const sql = MIGRATIONS[current]!;
    await db.tx(async (t) => {
      for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query(`UPDATE schema_version SET version = $1`, [current + 1]);
    });
  }
}
