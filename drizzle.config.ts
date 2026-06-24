import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DASH_DATABASE_URL ||
      process.env.DASH_POSTGRES_URL ||
      process.env.DASH_DATABASE_URL_UNPOOLED ||
      '',
  },
} satisfies Config;
