import { ShortCodeRegex } from '@quickdrop/protocol';
import { fromBase64Url, toBase64Url } from './secureChannel';

export function buildPairingUrl(baseUrl: string, code: string, psk: Uint8Array): string {
  const base = baseUrl.split('#', 1)[0];
  return `${base}#s=${toBase64Url(psk)}&c=${encodeURIComponent(code)}`;
}

export function parsePairingFragment(hash: string): { code: string; psk: Uint8Array } | null {
  try {
    if (!hash.startsWith('#')) return null;

    const params = new URLSearchParams(hash.slice(1));
    const entries = [...params.entries()];
    if (
      entries.length !== 2 ||
      entries.filter(([key]) => key === 's').length !== 1 ||
      entries.filter(([key]) => key === 'c').length !== 1
    ) {
      return null;
    }

    const encodedPsk = params.get('s');
    const code = params.get('c');
    if (!encodedPsk || !code || code.length > 64 || !ShortCodeRegex.test(code)) {
      return null;
    }

    const psk = fromBase64Url(encodedPsk);
    if (psk.byteLength !== 16) return null;

    return { code, psk };
  } catch {
    return null;
  }
}

export function scrubPairingFragment(): void {
  history.replaceState(null, '', location.pathname + location.search);
}
