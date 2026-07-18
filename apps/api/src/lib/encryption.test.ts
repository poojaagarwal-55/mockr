describe('encryption utilities', () => {
  const baseEnv = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    XAI_API_KEY: 'xai-key',
    GOOGLE_GENERATIVE_AI_API_KEY: 'gemini-key',
    DEEPGRAM_API_KEY: 'deepgram-key',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    RAZORPAY_KEY_ID: 'rzp_id',
    RAZORPAY_KEY_SECRET: 'rzp_secret',
    RAZORPAY_WEBHOOK_SECRET: 'rzp_webhook',
  };

  beforeEach(() => {
    jest.resetModules();
    Object.assign(process.env, baseEnv);
  });

  test('encrypt and decrypt roundtrip', async () => {
    const { encrypt, decrypt } = require('./encryption.js');

    const plaintext = 'sensitive resume summary';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  test('isEncrypted identifies valid format', async () => {
    const { encrypt, isEncrypted } = require('./encryption.js');

    const encrypted = encrypt('hello');

    expect(isEncrypted(encrypted)).toBe(true);
    expect(isEncrypted('plain-text')).toBe(false);
    expect(isEncrypted('a:b')).toBe(false);
    expect(isEncrypted('a::c')).toBe(false);
  });

  test('decrypt throws for invalid format', async () => {
    const { decrypt } = require('./encryption.js');
    expect(() => decrypt('invalid')).toThrow('Invalid encrypted data format');
  });

  test('encrypt throws when key is not 32 bytes hex', async () => {
    process.env.ENCRYPTION_KEY = 'short-key';
    const { encrypt } = require('./encryption.js');

    expect(() => encrypt('hello')).toThrow('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  });
});
