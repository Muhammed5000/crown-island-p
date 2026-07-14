import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const AAD = Buffer.from('crown-island-sync-envelope-v1', 'utf8');

export interface SyncEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

function keyFromSecret(secret: string): Buffer {
  if (secret.trim().length < 32) {
    throw new Error('SYNC_DATA_SECRET must contain at least 32 characters');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSyncPayload(value: unknown, secret: string): SyncEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSyncPayload<T>(envelope: SyncEnvelope, secret: string): T {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('unsupported sync envelope');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFromSecret(secret),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
