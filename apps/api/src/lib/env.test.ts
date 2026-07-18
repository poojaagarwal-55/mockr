const requiredEnv = {
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

describe('env helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    Object.assign(process.env, requiredEnv);
  });

  test('getEnv returns required values and is frozen', async () => {
    const { getEnv } = require('./env.js');

    const env = getEnv();

    expect(env.SUPABASE_URL).toBe(requiredEnv.NEXT_PUBLIC_SUPABASE_URL);
    expect(Object.isFrozen(env)).toBe(true);
  });

  test('proxy env lazily exposes values', async () => {
    const { env } = require('./env.js');
    expect(env.XAI_API_KEY).toBe(requiredEnv.XAI_API_KEY);
  });

  test('requireRazorpayEnv throws when missing', async () => {
    const { requireRazorpayEnv } = require('./env.js');

    delete process.env.RAZORPAY_KEY_ID;

    expect(() => requireRazorpayEnv('RAZORPAY_KEY_ID')).toThrow(
      'RAZORPAY_KEY_ID is not configured. Payment features are unavailable.'
    );
  });

  test('validateEnv exits process when required vars are missing', async () => {
    delete process.env.XAI_API_KEY;

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      }) as never);

    const { validateEnv } = require('./env.js');

    expect(() => validateEnv()).toThrow('exit:1');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
