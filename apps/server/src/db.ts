/**
 * База — Cloudflare D1 (SQLite). Код запросов писался под PostgreSQL, поэтому обёртка
 * переводит знакомые конструкции: параметры $1 → ?1, now(), приведения типов ::text,
 * объекты в параметрах — в JSON, JSON-колонки и логические колонки — обратно при чтении.
 * Интерактивных транзакций у D1 нет: tx() просто выполняет шаги по очереди.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
}

const JSON_COLUMNS = new Set(['data', 'settings', 'combat', 'payload', 'before']);
const BOOL_COLUMNS = new Set(['is_admin', 'undone', 'hidden']);
export const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export function translate(sql: string): string {
  return sql
    .replace(/\$(\d+)/g, '?$1')
    .replace(/now\(\)/g, NOW)
    .replace(/([\w.]+)::text\s+AS\s+(\w+)/gi, 'CAST($1 AS TEXT) AS $2')
    .replace(/(\b(?:\w+\.)?id)::text\b/g, (_, col: string) => `CAST(${col} AS TEXT) AS ${col.split('.').pop()}`)
    .replace(/::(?:text|int|integer|boolean|jsonb)\b/g, '');
}

function toParam(p: unknown): unknown {
  if (p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (p !== null && typeof p === 'object') return JSON.stringify(p);
  return p;
}

function fromRow(row: Record<string, unknown>) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (JSON_COLUMNS.has(k) && typeof v === 'string') row[k] = JSON.parse(v);
    else if (BOOL_COLUMNS.has(k) && typeof v === 'number') row[k] = v === 1;
  }
  return row;
}

export function fromD1(d1: D1Database): Db {
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await d1.prepare(translate(text)).bind(...params.map(toParam)).all();
      return (res.results ?? []).map((r) => fromRow(r as Record<string, unknown>)) as T[];
    },
    tx: (fn) => fn(db),
  };
  return db;
}

const NOW_DEFAULT = `DEFAULT (${NOW})`;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id text PRIMARY KEY,
    username text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    is_admin integer NOT NULL DEFAULT 0,
    created_at text NOT NULL ${NOW_DEFAULT}
  );
  CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at text NOT NULL
  );
  CREATE TABLE campaigns (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    dm_id text NOT NULL REFERENCES users(id),
    invite_code text NOT NULL UNIQUE,
    settings text NOT NULL DEFAULT '{}',
    combat text,
    created_at text NOT NULL ${NOW_DEFAULT}
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
    data text NOT NULL,
    name_lc text NOT NULL DEFAULT '',
    updated_at text NOT NULL ${NOW_DEFAULT}
  );
  CREATE INDEX content_kind_name ON content(kind, name);
  CREATE UNIQUE INDEX content_source_url ON content(source_url) WHERE source_url IS NOT NULL AND owner_id IS NULL;
  CREATE TABLE characters (
    id text PRIMARY KEY,
    owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id text REFERENCES campaigns(id) ON DELETE SET NULL,
    data text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    updated_at text NOT NULL ${NOW_DEFAULT}
  );
  CREATE TABLE campaign_members (
    campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    joined_at text NOT NULL ${NOW_DEFAULT},
    PRIMARY KEY (campaign_id, user_id)
  );
  CREATE TABLE npcs (
    id text PRIMARY KEY,
    campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    data text NOT NULL,
    created_at text NOT NULL ${NOW_DEFAULT}
  );
  CREATE TABLE achievements (
    id text PRIMARY KEY,
    campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    icon text NOT NULL DEFAULT 'star',
    created_at text NOT NULL ${NOW_DEFAULT}
  );
  CREATE TABLE achievement_awards (
    id text PRIMARY KEY,
    achievement_id text NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    note text NOT NULL DEFAULT '',
    awarded_at text NOT NULL ${NOW_DEFAULT}
  );
  CREATE TABLE events (
    id integer PRIMARY KEY AUTOINCREMENT,
    campaign_id text REFERENCES campaigns(id) ON DELETE CASCADE,
    actor_id text REFERENCES users(id) ON DELETE SET NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    type text NOT NULL,
    summary text NOT NULL,
    payload text NOT NULL DEFAULT '{}',
    before text,
    undone integer NOT NULL DEFAULT 0,
    hidden integer NOT NULL DEFAULT 0,
    created_at text NOT NULL ${NOW_DEFAULT}
  );
  CREATE INDEX events_campaign ON events(campaign_id, id DESC);
  CREATE INDEX events_target ON events(target_id, id);
  `,
];

let migrated: Promise<void> | null = null;

/** Версия набора обычного снаряжения: поменяйте, когда меняется seed/gear.json, — записи обновятся. */
const GEAR_VERSION = 1;

/**
 * Обычное снаряжение из Книги игрока (оружие, доспехи, снаряжение, инструменты) — только числа и названия,
 * собраны со статей dnd.su. Попадают в общую библиотеку сами, без импорта.
 */
async function seedGear(d1: D1Database) {
  await d1.prepare(`CREATE TABLE IF NOT EXISTS seeds (name text PRIMARY KEY, version integer NOT NULL)`).run();
  const row = await d1.prepare(`SELECT version FROM seeds WHERE name = 'gear'`).first<{ version: number }>();
  if (row && row.version >= GEAR_VERSION) return;
  const { default: gear } = await import('./seed/gear.json');
  const stmt = d1.prepare(
    `INSERT INTO content (id, kind, name, owner_id, visibility, source, source_url, data, name_lc) VALUES (?1, 'item', ?2, NULL, 'public', 'dnd.su', ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, name_lc = excluded.name_lc, source_url = excluded.source_url`,
  );
  const items = gear as { id: string; name: string; sourceUrl: string }[];
  await d1.batch([
    ...items.map((it) =>
      stmt.bind(it.id, it.name, it.sourceUrl, JSON.stringify({ ...it, kind: 'item', source: 'dnd.su' }), it.name.toLowerCase().replace(/ё/g, 'е')),
    ),
    d1.prepare(`INSERT INTO seeds (name, version) VALUES ('gear', ?1) ON CONFLICT(name) DO UPDATE SET version = excluded.version`).bind(GEAR_VERSION),
  ]);
}

/** Схема создаётся сама при первом запросе — отдельный шаг при выкладке не нужен. */
export function ensureSchema(d1: D1Database) {
  migrated ??= (async () => {
    await d1.prepare(`CREATE TABLE IF NOT EXISTS schema_version (version integer NOT NULL)`).run();
    const row = await d1.prepare(`SELECT version FROM schema_version`).first<{ version: number }>();
    let current = row?.version ?? 0;
    if (!row) await d1.prepare(`INSERT INTO schema_version VALUES (0)`).run();
    for (; current < MIGRATIONS.length; current++) {
      const stmts = MIGRATIONS[current]!.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
      await d1.batch([...stmts.map((s) => d1.prepare(s)), d1.prepare(`UPDATE schema_version SET version = ?1`).bind(current + 1)]);
    }
    await seedGear(d1);
  })().catch((e) => {
    migrated = null;
    throw e;
  });
  return migrated;
}
