import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  isProduction: boolean;
  dbPath: string;
  uploadsDir: string;
  masterKey: Buffer;
  sessionTtlDays: number;
  cookieSecure: 'auto' | boolean;
  trustProxy: boolean;
}

function loadDotEnvIfPresent(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function parseMasterKey(hex: string): Buffer {
  const cleaned = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error('MASTER_KEY must be a 64-character hex string (32 bytes).');
  }
  return Buffer.from(cleaned, 'hex');
}

function resolveMasterKey(dbPath: string, isProduction: boolean): Buffer {
  const envKey = process.env.MASTER_KEY?.trim();
  if (envKey) {
    return parseMasterKey(envKey);
  }

  if (dbPath === ':memory:') {
    return crypto.randomBytes(32);
  }

  const keyFilePath = path.join(path.dirname(path.resolve(dbPath)), '.master.key');
  if (fs.existsSync(keyFilePath)) {
    const stored = fs.readFileSync(keyFilePath, 'utf8').trim();
    return parseMasterKey(stored);
  }

  if (isProduction) {
    throw new Error(
      'MASTER_KEY environment variable is required in production (64 hex chars). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(keyFilePath, `${generated.toString('hex')}\n`, { mode: 0o600 });
  return generated;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotEnvIfPresent();

  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const dbPath = overrides.dbPath ?? process.env.DB_PATH ?? './data/airnote.db';
  const uploadsDir = overrides.uploadsDir ?? process.env.UPLOADS_DIR ?? './data/uploads';
  const port = overrides.port ?? Number(process.env.PORT ?? 3100);
  const host = overrides.host ?? process.env.HOST ?? '127.0.0.1';
  const sessionTtlDays = overrides.sessionTtlDays ?? Number(process.env.SESSION_TTL_DAYS ?? 14);

  const rawCookieSecure = process.env.COOKIE_SECURE ?? 'auto';
  const cookieSecure: 'auto' | boolean =
    overrides.cookieSecure ??
    (rawCookieSecure === 'true' ? true : rawCookieSecure === 'false' ? false : 'auto');

  const trustProxy = overrides.trustProxy ?? process.env.TRUST_PROXY === 'true';
  const masterKey = overrides.masterKey ?? resolveMasterKey(dbPath, isProduction);

  return {
    port,
    host,
    nodeEnv,
    isProduction,
    dbPath,
    uploadsDir,
    masterKey,
    sessionTtlDays,
    cookieSecure,
    trustProxy,
  };
}
