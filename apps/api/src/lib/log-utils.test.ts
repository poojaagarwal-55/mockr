import { maskUserId, sanitizeForLog } from './log-utils.js';

describe('log-utils', () => {
  test('redacts emails in strings', () => {
    const input = 'User email is alice@example.com';
    expect(sanitizeForLog(input)).toBe('User email is [REDACTED_EMAIL]');
  });

  test('redacts sensitive JSON fields in objects', () => {
    const payload = {
      fullName: 'Alice Doe',
      password: 'super-secret',
      nested: { currentPassword: 'old-pass' },
      safe: 'value',
    };

    expect(sanitizeForLog(payload)).toEqual({
      fullName: '[REDACTED]',
      password: '[REDACTED]',
      nested: { currentPassword: '[REDACTED]' },
      safe: 'value',
    });
  });

  test('sanitizes Error objects', () => {
    const error = new Error('Failed for bob@example.com');
    error.stack = 'trace with bob@example.com and {"newPassword":"abc"}';

    const sanitized = sanitizeForLog(error) as Error;

    expect(sanitized.message).toContain('[REDACTED_EMAIL]');
    expect(sanitized.stack).toContain('[REDACTED_EMAIL]');
    expect(sanitized.stack).toContain('"newPassword":"[REDACTED]"');
  });

  test('returns marker for unserializable objects', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(sanitizeForLog(circular)).toBe('[unserializable object]');
  });

  test('masks user id to short form', () => {
    expect(maskUserId('abcdef1234567890')).toBe('user-abcdef12...');
  });
});
