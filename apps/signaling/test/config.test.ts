import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('loads defaults and trims exact allowed origins', () => {
    expect(
      loadConfig({
        NODE_ENV: 'development',
        ALLOWED_ORIGINS: ' https://one.example,https://two.example ',
      }),
    ).toMatchObject({
      port: 3001,
      allowedOrigins: ['https://one.example', 'https://two.example'],
      sessionTtlMs: 300000,
      trustProxyHops: 0,
    });
  });

  it('rejects empty allowed origins in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: ' , ' }),
    ).toThrow(/ALLOWED_ORIGINS.*production/);
  });

  it('rejects wildcard origins in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.example,*' }),
    ).toThrow(/ALLOWED_ORIGINS.*production/);
  });

  it('validates numeric port, session TTL and proxy hops', () => {
    expect(() => loadConfig({ PORT: 'invalid' })).toThrow(/PORT must be an integer/);
    expect(() => loadConfig({ PORT: '65536' })).toThrow(/PORT must be between/);
    expect(() => loadConfig({ SESSION_TTL_MS: '0' })).toThrow(/SESSION_TTL_MS/);
    expect(() => loadConfig({ TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it.each(['', 'abc', '-1', '0', '1.5'])(
    'rejects invalid rate-limit capacity %j',
    (value) => {
      expect(() => loadConfig({ RATE_LIMIT_CAPACITY: value })).toThrow(
        /RATE_LIMIT_CAPACITY must be an integer greater than or equal to 1/,
      );
    },
  );

  it.each(['', 'abc', '-1', '0', 'Infinity', 'NaN'])(
    'rejects invalid rate-limit refill rate %j',
    (value) => {
      expect(() => loadConfig({ RATE_LIMIT_REFILL_RATE: value })).toThrow(
        /RATE_LIMIT_REFILL_RATE must be a finite number greater than 0/,
      );
    },
  );
});
