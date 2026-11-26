import crypto from 'node:crypto';
import argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP recommended minimum for Argon2id)
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_+=?';
const ALL_CHARS = UPPER + LOWER + DIGITS + SYMBOLS;

function randomChar(alphabet: string): string {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

/**
 * 生成高强度一次性初始密码（至少包含大小写、数字与符号，剔除易混淆字符 0/O/1/l/I）。
 */
export function generateTemporaryPassword(length = 16): string {
  const chars: string[] = [
    randomChar(UPPER),
    randomChar(UPPER),
    randomChar(LOWER),
    randomChar(LOWER),
    randomChar(DIGITS),
    randomChar(DIGITS),
    randomChar(SYMBOLS),
    randomChar(SYMBOLS),
  ];

  while (chars.length < length) {
    chars.push(randomChar(ALL_CHARS));
  }

  // Fisher-Yates shuffle with cryptographic randomness
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
