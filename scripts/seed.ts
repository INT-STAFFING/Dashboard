/**
 * Seed the database with the baseline portfolio (24 interventi).
 * Requires POSTGRES_URL and the schema already pushed (`npm run db:push`).
 *
 *   POSTGRES_URL=... npm run db:seed
 *
 * Without POSTGRES_URL the app uses the in-memory seed automatically, so this
 * script is only needed for a persistent Vercel Postgres deployment.
 */
import { hasDB } from '../lib/db';
import { upsertInterventiFromUpload } from '../lib/store';
import { SEED_INTERVENTI } from '../lib/seed';

async function main() {
  if (!hasDB) {
    console.error('POSTGRES_URL non configurato: nessun DB da popolare (l’app usa il seed in memoria).');
    process.exit(1);
  }
  const res = await upsertInterventiFromUpload(SEED_INTERVENTI, true);
  console.log(`Seed completato: ${res.inserted} inseriti, ${res.updated} aggiornati.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
