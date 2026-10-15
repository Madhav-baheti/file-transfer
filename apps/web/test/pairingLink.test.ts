import { describe, expect, it } from 'vitest';
import { toBase64Url } from '../src/lib/secureChannel';
import { buildPairingUrl, parsePairingFragment } from '../src/lib/pairingLink';

const code = '7-kiwi-lamp';
const psk = Uint8Array.from({ length: 16 }, (_, index) => index * 13);
const validFragment = `#s=${toBase64Url(psk)}&c=${encodeURIComponent(code)}`;

describe('pairing links', () => {
  it('builds and parses a pairing URL with the exact PSK bytes', () => {
    const url = buildPairingUrl('https://quickdrop.example/join', code, psk);
    const parsed = parsePairingFragment(new URL(url).hash);

    expect(parsed?.code).toBe(code);
    expect(parsed?.psk).toEqual(psk);
  });

  it('strips an existing hash before adding pairing parameters', () => {
    expect(buildPairingUrl('https://quickdrop.example/join#old=value', code, psk)).toBe(
      `https://quickdrop.example/join${validFragment}`,
    );
  });

  it.each([
    ['empty hash', ''],
    ['missing code', `#s=${toBase64Url(psk)}`],
    ['missing psk', `#c=${code}`],
    ['short psk', `#s=${toBase64Url(psk.subarray(0, 15))}&c=${code}`],
    ['long psk', `#s=${toBase64Url(new Uint8Array(17))}&c=${code}`],
    ['invalid base64url', `#s=invalid*&c=${code}`],
    ['duplicate parameter', `${validFragment}&c=${code}`],
    ['unknown parameter', `${validFragment}&extra=value`],
    ['over-long code', `#s=${toBase64Url(psk)}&c=${'1'.repeat(65)}`],
    ['invalid code', `#s=${toBase64Url(psk)}&c=not_a_code`],
    ['garbage input', '#not-a-pairing-fragment'],
    ['malformed encoding', `#s=%ZZ&c=${code}`],
  ])('returns null for %s', (_name, fragment) => {
    expect(parsePairingFragment(fragment)).toBeNull();
  });

  it('accepts the code parameter before the secret parameter', () => {
    expect(parsePairingFragment(`#c=${code}&s=${toBase64Url(psk)}`)?.psk).toEqual(psk);
  });
});
