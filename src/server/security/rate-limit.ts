interface RateBucket {
  failures: number;
  windowStart: number;
  lockedUntil: number | null;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  maxFailures?: number;
  lockoutMs?: number;
  windowMs?: number;
}

/**
 * IP + 账号双维度防爆破限流器：
 * 默认连续失败 5 次后锁定 15 分钟，登录成功时自动清零对应账号计数。
 */
export class DualDimensionRateLimiter {
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, RateBucket>();

  constructor(options: RateLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.lockoutMs = options.lockoutMs ?? 15 * 60 * 1000;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
  }

  private keys(scope: string, ip: string, account: string): [string, string] {
    const normAccount = account.trim().toLowerCase();
    return [`${scope}:ip:${ip}`, `${scope}:acct:${normAccount}`];
  }

  private checkKey(key: string, now: number): RateLimitCheckResult {
    const bucket = this.buckets.get(key);
    if (!bucket) return { allowed: true, retryAfterSeconds: 0 };

    if (bucket.lockedUntil !== null) {
      if (now < bucket.lockedUntil) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000)),
        };
      }
      this.buckets.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (now - bucket.windowStart > this.windowMs) {
      this.buckets.delete(key);
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  private failKey(key: string, now: number): void {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.windowStart > this.windowMs) {
      const failures = 1;
      this.buckets.set(key, {
        failures,
        windowStart: now,
        lockedUntil: failures >= this.maxFailures ? now + this.lockoutMs : null,
      });
      return;
    }

    existing.failures += 1;
    if (existing.failures >= this.maxFailures) {
      existing.lockedUntil = now + this.lockoutMs;
    }
  }

  check(scope: string, ip: string, account: string, now = Date.now()): RateLimitCheckResult {
    const [ipKey, acctKey] = this.keys(scope, ip, account);
    const ipRes = this.checkKey(ipKey, now);
    if (!ipRes.allowed) return ipRes;
    const acctRes = this.checkKey(acctKey, now);
    if (!acctRes.allowed) return acctRes;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(scope: string, ip: string, account: string, now = Date.now()): void {
    const [ipKey, acctKey] = this.keys(scope, ip, account);
    this.failKey(ipKey, now);
    this.failKey(acctKey, now);
  }

  recordSuccess(scope: string, ip: string, account: string): void {
    const [ipKey, acctKey] = this.keys(scope, ip, account);
    this.buckets.delete(acctKey);
    const ipBucket = this.buckets.get(ipKey);
    if (ipBucket && ipBucket.lockedUntil === null) {
      this.buckets.delete(ipKey);
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}
