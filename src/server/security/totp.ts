import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { hashPassword, verifyPassword } from './password.js';

const TOTP_ISSUER = 'AirNote';
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 time step (±30s clock tolerance)

const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface TotpSetupData {
  secret: string;
  secretFormatted: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

export function formatBase32Secret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function createTotpInstance(username: string, secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: username,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export async function generateTotpSetup(username: string): Promise<TotpSetupData> {
  const secretObj = new OTPAuth.Secret({ size: 20 });
  const secret = secretObj.base32;
  const totp = createTotpInstance(username, secret);
  const otpauthUri = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
    width: 220,
    margin: 2,
    color: {
      dark: '#141B34',
      light: '#FFFFFF',
    },
  });

  return {
    secret,
    secretFormatted: formatBase32Secret(secret),
    otpauthUri,
    qrCodeDataUrl,
  };
}

export interface TotpVerifyResult {
  valid: boolean;
  step?: number;
  replayed?: boolean;
}

export function verifyTotpCode(
  username: string,
  secretBase32: string,
  rawCode: string,
  lastUsedStep: number | null,
  timestampMs = Date.now(),
): TotpVerifyResult {
  const code = rawCode.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) {
    return { valid: false };
  }

  const totp = createTotpInstance(username, secretBase32);
  const delta = totp.validate({
    token: code,
    window: TOTP_WINDOW,
    timestamp: timestampMs,
  });

  if (delta === null) {
    return { valid: false };
  }

  const currentStep = Math.floor(timestampMs / 1000 / TOTP_PERIOD);
  const matchedStep = currentStep + delta;

  if (lastUsedStep !== null && matchedStep <= lastUsedStep) {
    return { valid: false, replayed: true };
  }

  return { valid: true, step: matchedStep };
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

function generateSingleRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += RECOVERY_ALPHABET[crypto.randomInt(0, RECOVERY_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export async function generateRecoveryCodes(
  count = 8,
): Promise<{ rawCodes: string[]; hashedCodes: string[] }> {
  const rawSet = new Set<string>();
  while (rawSet.size < count) {
    rawSet.add(generateSingleRecoveryCode());
  }
  const rawCodes = Array.from(rawSet);
  const hashedCodes = await Promise.all(
    rawCodes.map((code) => hashPassword(normalizeRecoveryCode(code))),
  );
  return { rawCodes, hashedCodes };
}

export async function matchRecoveryCode(
  inputCode: string,
  candidates: Array<{ id: string; code_hash: string }>,
): Promise<string | null> {
  const normalized = normalizeRecoveryCode(inputCode);
  if (normalized.length < 8) return null;

  for (const candidate of candidates) {
    const ok = await verifyPassword(candidate.code_hash, normalized);
    if (ok) {
      return candidate.id;
    }
  }
  return null;
}
