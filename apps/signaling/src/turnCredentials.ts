import { createHmac } from 'node:crypto';

export const TURN_CREDENTIAL_TTL_SECONDS = 10 * 60;

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
}

export function createTurnCredentials(
  urls: string[],
  sharedSecret: string,
  nowMs = Date.now(),
): TurnCredentials {
  const expiresAt = Math.floor(nowMs / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
  const username = `${expiresAt}:quickdrop`;
  const credential = createHmac('sha1', sharedSecret)
    .update(username)
    .digest('base64');
  return { urls: [...urls], username, credential, expiresAt };
}
