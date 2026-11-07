import crypto from 'node:crypto';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, checkPassword, checkRateLimit, clearRateLimit, isAutoLogin, isRequestVerified, sessionFromCookieHeader, signSession, verifySession } from './auth';

/**
 * 会话鉴权单测：HMAC 签名/校验、过期、防篡改、密码恒定时间比较、登录限流。
 * 纯函数 + 内存状态，不需要网络与 IndexedDB。
 */

const TEST_PASSWORD = 'test-password-123';

beforeAll(() => {
  process.env.PASSWORD = TEST_PASSWORD;
});

afterAll(() => {
  delete process.env.PASSWORD;
});

describe('signSession / verifySession', () => {
  it(' freshly 签发的会话 token 校验通过', () => {
    const { token, expiresAt } = signSession();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(verifySession(token)).toBe(true);
  });

  it('过期会话被拒绝', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { token } = signSession();
    // 快进 91 天（TTL 90 天）
    vi.setSystemTime(new Date('2026-04-02T00:00:00Z'));
    expect(verifySession(token)).toBe(false);
    vi.useRealTimers();
  });

  it('篡改 payload（替换过期时间但沿用旧签名）被拒绝', () => {
    const { token } = signSession();
    const sig = token.slice(token.lastIndexOf('.') + 1);
    // 用与真实 TTL（90 天）不同的偏移构造新 payload，保证签名与 payload 不匹配
    const forged = `${String(Date.now() + 95 * 24 * 3600 * 1000)}.${sig}`;
    expect(verifySession(forged)).toBe(false);
  });

  it('用自算 HMAC 伪造签名也无法通过（密钥派生含盐）', () => {
    // 攻击者知道 PASSWORD 时最常见的伪造路径：按可猜想的派生方式构造签名
    const payload = String(Date.now() + 60_000);
    const naiveSecret = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');
    const naive = crypto.createHmac('sha256', naiveSecret).update(payload).digest('hex');
    expect(verifySession(`${payload}.${naive}`)).toBe(false);
  });

  it('格式非法的 token 一律拒绝', () => {
    expect(verifySession(undefined)).toBe(false);
    expect(verifySession('')).toBe(false);
    expect(verifySession('no-dot-token')).toBe(false);
    expect(verifySession('.sig')).toBe(false);
    expect(verifySession('abc.not-hex-sig')).toBe(false);
  });
});

describe('checkPassword', () => {
  it('正确密码通过', () => {
    expect(checkPassword(TEST_PASSWORD)).toBe(true);
  });

  it('错误密码拒绝', () => {
    expect(checkPassword('wrong')).toBe(false);
    expect(checkPassword('')).toBe(false);
  });

  it('未配置 PASSWORD 时一律拒绝', () => {
    const saved = process.env.PASSWORD;
    delete process.env.PASSWORD;
    try {
      expect(checkPassword(TEST_PASSWORD)).toBe(false);
    } finally {
      process.env.PASSWORD = saved;
    }
  });
});

describe('sessionFromCookieHeader', () => {
  it('含有效会话的 Cookie 头通过', () => {
    const { token } = signSession();
    expect(sessionFromCookieHeader(`${SESSION_COOKIE}=${token}`)).toBe(true);
    expect(sessionFromCookieHeader(`other=1; ${SESSION_COOKIE}=${token}; x=2`)).toBe(true);
  });

  it('缺失 / 篡改 / 无关 Cookie 头拒绝', () => {
    const { token } = signSession();
    expect(sessionFromCookieHeader(null)).toBe(false);
    expect(sessionFromCookieHeader('')).toBe(false);
    expect(sessionFromCookieHeader(`other=1`)).toBe(false);
    expect(sessionFromCookieHeader(`${SESSION_COOKIE}=${token}x`)).toBe(false);
  });
});

describe('checkRateLimit', () => {
  afterEach(() => {
    clearRateLimit('1.2.3.4');
    clearRateLimit('5.6.7.8');
  });

  it('窗口内允许 MAX_ATTEMPTS 次后拒绝', () => {
    clearRateLimit('1.2.3.4');
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit('1.2.3.4')).toBe(true);
    }
    expect(checkRateLimit('1.2.3.4')).toBe(false);
  });

  it('不同 IP 互不影响', () => {
    expect(checkRateLimit('5.6.7.8')).toBe(true);
    // 耗尽 1.2.3.4 不影响 5.6.7.8
    for (let i = 0; i < 11; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('5.6.7.8')).toBe(true);
  });

  it('clearRateLimit 解除限制', () => {
    clearRateLimit('1.2.3.4');
    for (let i = 0; i < 11; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('1.2.3.4')).toBe(false);
    clearRateLimit('1.2.3.4');
    expect(checkRateLimit('1.2.3.4')).toBe(true);
  });
});

/**
 * 免登录模式（AUTO_LOGIN）：电视端不好输密码、还可能丢 cookie，
 * 打开后服务端必须无条件认「已验证」，且不能因为没配 PASSWORD 就 503。
 */
describe('isAutoLogin / isRequestVerified', () => {
  afterEach(() => {
    delete process.env.AUTO_LOGIN;
  });

  it('未设置 AUTO_LOGIN 时为关闭', () => {
    expect(isAutoLogin()).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on', ' on '])('「%s」视为开启', (value) => {
    process.env.AUTO_LOGIN = value;
    expect(isAutoLogin()).toBe(true);
  });

  it.each(['0', 'false', 'off', '', 'no'])('「%s」视为关闭', (value) => {
    process.env.AUTO_LOGIN = value;
    expect(isAutoLogin()).toBe(false);
  });

  it('免登录模式下无 cookie 的请求也算已验证', () => {
    process.env.AUTO_LOGIN = '1';
    expect(isRequestVerified(new Request('http://localhost/api/status'))).toBe(true);
  });

  it('免登录模式不依赖 PASSWORD 是否存在', () => {
    process.env.AUTO_LOGIN = '1';
    delete process.env.PASSWORD;
    try {
      expect(isRequestVerified(new Request('http://localhost/api/status'))).toBe(true);
    } finally {
      process.env.PASSWORD = TEST_PASSWORD;
    }
  });

  it('非免登录模式下无 cookie 仍然拒绝', () => {
    expect(isRequestVerified(new Request('http://localhost/api/status'))).toBe(false);
  });

  it('非免登录模式下带合法会话 cookie 才放行', () => {
    const { token } = signSession();
    const req = new Request('http://localhost/api/status', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(isRequestVerified(req)).toBe(true);
  });
});
