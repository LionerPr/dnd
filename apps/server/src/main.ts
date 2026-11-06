import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { openDb } from './db.js';

const port = Number(process.env.PORT ?? 3000);
const db = await openDb({ url: process.env.DATABASE_URL, dataDir: process.env.DATA_DIR ?? resolve(import.meta.dirname, '../../../data/pglite') });
const { app } = await buildApp(db, { secureCookies: process.env.SECURE_COOKIES === 'true' });
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
