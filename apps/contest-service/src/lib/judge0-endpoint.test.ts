import {
  buildJudge0Headers,
  isSharedJudge0Endpoint,
  resolveJudge0Endpoint,
  resolveJudge0Provider,
} from './judge0-endpoint.js';

describe('judge0 endpoint helpers', () => {
  it('uses RapidAPI headers for RapidAPI endpoints', () => {
    expect(resolveJudge0Provider('https://judge0-ce.p.rapidapi.com', 'auto')).toBe('rapidapi');

    expect(buildJudge0Headers({
      apiUrl: 'https://judge0-ce.p.rapidapi.com',
      apiKey: 'test-key',
      provider: 'auto',
      rapidApiHost: 'judge0-ce.p.rapidapi.com',
    })).toEqual({
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': 'test-key',
      'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
    });
  });

  it('uses token auth for self-hosted endpoints when a key is configured', () => {
    expect(resolveJudge0Provider('https://judge0.internal.example.com', 'auto')).toBe('self-hosted');

    expect(buildJudge0Headers({
      apiUrl: 'https://judge0.internal.example.com',
      apiKey: 'self-hosted-token',
      provider: 'self-hosted',
      authHeader: 'X-Judge0-Token',
    })).toEqual({
      'Content-Type': 'application/json',
      'X-Judge0-Token': 'self-hosted-token',
    });
  });

  it('does not send auth headers for an unauthenticated self-hosted endpoint', () => {
    expect(buildJudge0Headers({
      apiUrl: 'http://judge0.local:2358',
      provider: 'self-hosted',
    })).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('detects shared Judge0 endpoints', () => {
    expect(isSharedJudge0Endpoint('https://judge0-ce.p.rapidapi.com')).toBe(true);
    expect(isSharedJudge0Endpoint('https://ce.judge0.com')).toBe(true);
    expect(isSharedJudge0Endpoint('https://judge0.internal.example.com')).toBe(false);
  });

  it('routes standard contest languages to CE when the legacy API URL points at Extra CE', () => {
    expect(resolveJudge0Endpoint({
      runtime: 'standard',
      apiUrl: 'https://judge0-extra-ce.p.rapidapi.com',
      host: 'judge0-extra-ce.p.rapidapi.com',
    })).toEqual({
      apiUrl: 'https://judge0-ce.p.rapidapi.com',
      host: 'judge0-ce.p.rapidapi.com',
      provider: 'rapidapi',
    });
  });

  it('honors explicit standard and extra CE endpoint overrides', () => {
    expect(resolveJudge0Endpoint({
      runtime: 'standard',
      apiUrl: 'https://judge0-extra-ce.p.rapidapi.com',
      ceUrl: 'https://judge0-ce.example.com',
      ceHost: 'judge0-ce.example.com',
    })).toEqual({
      apiUrl: 'https://judge0-ce.example.com',
      host: 'judge0-ce.example.com',
      provider: 'self-hosted',
    });

    expect(resolveJudge0Endpoint({
      runtime: 'extra',
      apiUrl: 'https://judge0-ce.p.rapidapi.com',
      extraCeUrl: 'https://judge0-extra.example.com',
      extraCeHost: 'judge0-extra.example.com',
    })).toEqual({
      apiUrl: 'https://judge0-extra.example.com',
      host: 'judge0-extra.example.com',
      provider: 'self-hosted',
    });
  });
});
