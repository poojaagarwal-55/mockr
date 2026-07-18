import crypto from 'node:crypto';
import { env } from './env.js';

interface LoadTestTokenPayload {
  sub: string;
  email?: string;
  exp?: number;
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signPayload(payloadSegment: string, secret: string): string {
  return base64UrlEncode(
    crypto.createHmac('sha256', secret).update(payloadSegment).digest()
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createLoadTestToken(payload: LoadTestTokenPayload, secret: string): string {
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadSegment, secret);
  return `loadtest.${payloadSegment}.${signature}`;
}

export function verifyLoadTestToken(token: string): LoadTestTokenPayload | null {
  if (!env.LOAD_TEST_AUTH_ENABLED || env.NODE_ENV === 'production' || !env.LOAD_TEST_JWT_SECRET) {
    return null;
  }

  const [prefix, payloadSegment, signature] = token.split('.');
  if (prefix !== 'loadtest' || !payloadSegment || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payloadSegment, env.LOAD_TEST_JWT_SECRET);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadSegment).toString('utf-8')) as LoadTestTokenPayload;
    if (!payload.sub || typeof payload.sub !== 'string') {
      return null;
    }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
