import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations prefer the direct (unpooled) endpoint; accept the DASH_-prefixed
    // variables created by the Vercel ⇄ Neon integration as well.
    url:
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DASH_DATABASE_URL_UNPOOLED ||
      process.env.DASH_POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.DASH_DATABASE_URL ||
      process.env.DASH_POSTGRES_URL ||
      '',
  },
} satisfies Config;
