import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetRateLimit, checkRateLimit, clientKey } from '../rate-limit.js';

describe('checkRateLimit', () => {
  beforeEach(() => {
    _resetRateLimit();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('permite hasta `limit` requests por ventana', () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit('user1', { limit: 5, windowMs: 60_000 });
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(4 - i);
    }
  });

  it('bloquea la request #limit+1', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('user2', { limit: 3, windowMs: 60_000 });
    const blocked = checkRateLimit('user2', { limit: 3, windowMs: 60_000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resetea cuando pasa la ventana', () => {
    checkRateLimit('user3', { limit: 2, windowMs: 1_000 });
    checkRateLimit('user3', { limit: 2, windowMs: 1_000 });
    expect(checkRateLimit('user3', { limit: 2, windowMs: 1_000 }).ok).toBe(false);

    vi.advanceTimersByTime(1_500);
    expect(checkRateLimit('user3', { limit: 2, windowMs: 1_000 }).ok).toBe(true);
  });

  it('aisla buckets por key', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('a', { limit: 5, windowMs: 60_000 });
    expect(checkRateLimit('a', { limit: 5, windowMs: 60_000 }).ok).toBe(false);
    expect(checkRateLimit('b', { limit: 5, windowMs: 60_000 }).ok).toBe(true);
  });

  it('usa defaults razonables si no se pasan opts', () => {
    const r = checkRateLimit('default');
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(9); // limit default 10
  });
});

describe('clientKey', () => {
  it('extrae el primer IP de x-forwarded-for', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    });
    expect(clientKey(req)).toBe('1.2.3.4');
  });

  it('cae a x-real-ip si no hay XFF', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '5.6.7.8' } });
    expect(clientKey(req)).toBe('5.6.7.8');
  });

  it('devuelve "unknown" si no hay headers', () => {
    const req = new Request('http://x');
    expect(clientKey(req)).toBe('unknown');
  });
});
