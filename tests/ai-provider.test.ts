// FR-07 assistant provider policy tests (offline / online).
//
// Regression coverage for the mode-persistence bug (setAssistantMode wrote a
// boolean flag while getAssistantMode read the 'online' string, so online
// never stuck) and for the provider-config gating: online answers only when
// authorized AND configured; unconfigured online degrades to the offline
// engine without ever hitting the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  askAssistant,
  getAssistantMode,
  getProviderConfig,
  isOnlineAuthorized,
  isOnlineConfigured,
  setAssistantMode,
  setOnlineAuthorized,
  setProviderConfig,
} from '@/core/ai/provider';

// ---------------------------------------------------------------------------
// localStorage stub (node has none)
// ---------------------------------------------------------------------------

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mode persistence (regression)', () => {
  it('online mode sticks once authorized', () => {
    setOnlineAuthorized(true);
    setAssistantMode('online');
    expect(getAssistantMode()).toBe('online');
  });

  it('online without authorization degrades to offline', () => {
    setAssistantMode('online');
    expect(getAssistantMode()).toBe('offline');
  });

  it('revoking authorization forces offline', () => {
    setOnlineAuthorized(true);
    setAssistantMode('online');
    expect(getAssistantMode()).toBe('online');
    setOnlineAuthorized(false);
    expect(getAssistantMode()).toBe('offline');
    expect(isOnlineAuthorized()).toBe(false);
  });
});

describe('provider config', () => {
  it('empty by default; endpoint trims and round-trips', () => {
    expect(getProviderConfig()).toEqual({ endpoint: '', model: '', apiKey: '' });
    expect(isOnlineConfigured()).toBe(false);
    setProviderConfig({ endpoint: '  https://api.example.com/v1/chat/completions  ', model: ' m1 ', apiKey: 'k' });
    const cfg = getProviderConfig();
    expect(cfg.endpoint).toBe('https://api.example.com/v1/chat/completions');
    expect(cfg.model).toBe('m1');
    expect(isOnlineConfigured()).toBe(true);
  });

  it('garbage in storage falls back to empty config', () => {
    localStorage.setItem('ergalics:ai-provider', '{not json');
    expect(getProviderConfig()).toEqual({ endpoint: '', model: '', apiKey: '' });
    expect(isOnlineConfigured()).toBe(false);
  });
});

describe('askAssistant', () => {
  const req = { prompt: '分析 height 和 weight 的相关性', locale: 'zh-CN' as const };

  it('offline engine answers a matching intent', async () => {
    const reply = await askAssistant(req);
    expect(reply.mode).toBe('offline');
    expect(reply.intent?.kind).toBe('correlation');
    expect(reply.code).toContain('studio.');
    expect(reply.text).toBeNull();
  });

  it('online but unconfigured: degrades offline, never touches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setOnlineAuthorized(true);
    setAssistantMode('online');
    const reply = await askAssistant(req);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reply.note).toContain('服务设置');
    expect(reply.needsOnline).toBe(true);
    expect(reply.code).toContain('studio.');
  });

  it('online + configured: sends an OpenAI-compatible request and returns text', async () => {
    setOnlineAuthorized(true);
    setAssistantMode('online');
    setProviderConfig({ endpoint: 'https://api.example.com/v1/chat/completions', model: 'test-model', apiKey: 'sk-1' });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '好的，已完成分析。' } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const reply = await askAssistant(req);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-1');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('test-model');
    expect(body.messages.at(-1).content).toBe(req.prompt);
    expect(reply.text).toBe('好的，已完成分析。');
    expect(reply.note).toBeNull();
  });

  it('online request failure falls back to the offline engine with a note', async () => {
    setOnlineAuthorized(true);
    setAssistantMode('online');
    setProviderConfig({ endpoint: 'https://api.example.com/v1/chat/completions', model: '', apiKey: '' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const reply = await askAssistant(req);
    expect(reply.text).toBeNull();
    expect(reply.note).toContain('503');
    expect(reply.code).toContain('studio.');
  });
});
