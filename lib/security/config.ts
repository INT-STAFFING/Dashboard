// Production-readiness checks for the secrets and storage the app depends on.
// Pure and edge-safe (reads only the env object it is given), so the same rules
// are shared by the Edge middleware, Node route handlers and instrumentation.

type Env = Record<string, string | undefined>;

export const DEV_AUTH_SECRET = 'aria-siss-dev-insecure-secret-change-me';

// Values that ship in the repo (code defaults, .env.example) and must never
// protect a real deployment.
const INSECURE_SECRETS = new Set([DEV_AUTH_SECRET, 'cambia_questo_in_produzione']);
const INSECURE_ADMIN_PASSWORDS = new Set(['admin', 'cambia_questo_in_produzione']);

// Every env var the Vercel ⇄ Neon integration may expose the connection string
// under, in priority order (see lib/db.ts).
export const DB_URL_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'DASH_DATABASE_URL',
  'DASH_POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'DASH_DATABASE_URL_UNPOOLED',
  'DASH_POSTGRES_URL_NON_POOLING',
] as const;

export function resolveConnectionString(env: Env = process.env): string {
  for (const k of DB_URL_ENV_KEYS) if (env[k]) return env[k]!;
  return '';
}

// A real production runtime: Vercel's production environment, or a self-hosted
// `next start`. Preview/development deployments (VERCEL_ENV=preview|development)
// and `next dev` are not, so they keep the zero-config developer experience.
export function isProductionRuntime(env: Env = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  return env.NODE_ENV === 'production';
}

// Explicit, loud escape hatch for running a production build locally (demo,
// smoke test) without real secrets. Never set it on a real deployment.
export function allowsInsecureConfig(env: Env = process.env): boolean {
  return env.ALLOW_INSECURE_CONFIG === 'true' || env.ALLOW_INSECURE_CONFIG === '1';
}

// Session-signing key. In production only AUTH_SECRET counts: falling back to
// UPLOAD_SECRET would let everyone who can upload files (and therefore knows
// that secret) forge an ADMIN session cookie.
export function resolveAuthSecret(env: Env = process.env): string {
  if (isProductionRuntime(env) && !allowsInsecureConfig(env)) return env.AUTH_SECRET || '';
  return env.AUTH_SECRET || env.UPLOAD_SECRET || DEV_AUTH_SECRET;
}

export function isInsecureAuthSecret(secret: string): boolean {
  return !secret || INSECURE_SECRETS.has(secret);
}

export function isInsecureAdminPassword(password: string | undefined): boolean {
  return !password || INSECURE_ADMIN_PASSWORDS.has(password);
}

// Human-readable list of what is wrong with the configuration (empty = fine).
// Applies the production rules regardless of the current environment; callers
// decide whether the problems are fatal (see assertProductionConfig).
export function configProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const authSecret = env.AUTH_SECRET || '';
  if (isInsecureAuthSecret(authSecret)) {
    problems.push('AUTH_SECRET mancante o uguale a un valore di default: impostane uno casuale e lungo');
  } else if (env.UPLOAD_SECRET && env.UPLOAD_SECRET === authSecret) {
    problems.push('AUTH_SECRET non deve coincidere con UPLOAD_SECRET (chi carica file potrebbe falsificare le sessioni)');
  }
  if (!resolveConnectionString(env)) {
    problems.push(
      `nessun database configurato (${DB_URL_ENV_KEYS.slice(0, 2).join(' / ')}): in produzione i dati finirebbero in memoria, per istanza e senza persistenza`,
    );
  }
  return problems;
}

// Throws in a real production runtime when the configuration is unsafe; in any
// other environment it only warns, so previews and local development keep working.
export function assertProductionConfig(env: Env = process.env, warn: (m: string) => void = console.warn): void {
  const problems = configProblems(env);
  if (!problems.length) return;
  const message = `Configurazione non sicura:\n - ${problems.join('\n - ')}`;
  if (isProductionRuntime(env) && !allowsInsecureConfig(env)) {
    throw new Error(message);
  }
  warn(`[security] ${message}`);
}

// The seeded ADMIN account is created from ADMIN_PASSWORD, falling back to
// "admin". Refuse to create it that way in production.
export function assertAdminPasswordSecure(env: Env = process.env): void {
  if (!isProductionRuntime(env) || allowsInsecureConfig(env)) return;
  if (isInsecureAdminPassword(env.ADMIN_PASSWORD)) {
    throw new Error(
      "ADMIN_PASSWORD mancante o di default: impostala prima che l'account amministratore venga creato in produzione",
    );
  }
}
