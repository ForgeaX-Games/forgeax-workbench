import { afterEach, describe, it, expect, beforeEach, mock } from 'bun:test';
import { createRestWorkbenchClient } from './RestWorkbenchClient';

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
const notOk = (status: number) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response);

describe('RestWorkbenchClient', () => {
  let fetchSpy: ReturnType<typeof mock>;
  const originalEventSource = globalThis.EventSource;
  beforeEach(() => {
    fetchSpy = mock(() => okJson({}));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  const client = () => createRestWorkbenchClient();

  it('listAgents() → GET /api/workbench/agents', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ agents: [{ id: 'a1' }] }));
    const j = await client().listAgents();
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/agents');
    expect(j.agents[0].id).toBe('a1');
  });

  it('listAgents({lang:"zh"}) → GET /api/workbench/agents?lang=zh', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ agents: [] }));
    await client().listAgents({ lang: 'zh' });
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/agents?lang=zh');
  });

  it('getActiveGame() → GET /api/workbench/active-game', async () => {
    fetchSpy.mockReturnValueOnce(okJson({
      activeSlug: 'demo',
      runtime: {
        status: 'ready',
        binding: { scopeId: 'studio-demo', generation: 7 },
      },
    }));
    const j = await client().getActiveGame();
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/active-game');
    expect(j.activeSlug).toBe('demo');
    expect(j.runtime?.binding?.scopeId).toBe('studio-demo');
    expect(j.runtime?.binding?.generation).toBe(7);
  });

  it('getActiveGame() 非 2xx 时返回 { activeSlug: null }', async () => {
    fetchSpy.mockReturnValueOnce(notOk(500));
    const j = await client().getActiveGame();
    expect(j.activeSlug).toBeNull();
  });

  it('setActiveGame(slug) → PUT one canonical active-game resource', async () => {
    fetchSpy.mockReturnValueOnce(okJson({
      ok: true,
      activeSlug: 'demo',
      runtime: {
        status: 'ready',
        binding: { scopeId: 'studio-demo', generation: 8 },
      },
    }));
    const j = await client().setActiveGame('demo');
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/active-game', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'demo' }),
    });
    expect(j.activeSlug).toBe('demo');
    expect(j.runtime?.binding?.generation).toBe(8);
  });

  it('setActiveGame(slug) retries transient runtime-unavailable responses', async () => {
    fetchSpy
      .mockReturnValueOnce(notOk(503))
      .mockReturnValueOnce(okJson({
        ok: true,
        activeSlug: 'demo',
        runtime: {
          status: 'ready',
          binding: { scopeId: 'studio-demo', generation: 9 },
        },
      }));

    const j = await client().setActiveGame('demo');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(j.activeSlug).toBe('demo');
    expect(j.runtime?.binding?.generation).toBe(9);
  });

  it('subscribeActiveGame() follows events and re-reads authority on reconnect', async () => {
    class FakeEventSource {
      static latest: FakeEventSource;
      readonly listeners = new Map<string, Set<EventListener>>();
      closed = false;
      constructor(readonly url: string) { FakeEventSource.latest = this; }
      addEventListener(type: string, listener: EventListener) {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }
      removeEventListener(type: string, listener: EventListener) {
        this.listeners.get(type)?.delete(listener);
      }
      close() { this.closed = true; }
      emit(type: string, event: Event) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const seen: Array<string | null> = [];
    const unsubscribe = client().subscribeActiveGame?.((selection) => seen.push(selection.activeSlug));
    const source = FakeEventSource.latest!;
    expect(source.url).toBe('/api/events/stream?topic=workbench.active-game.changed');

    source.emit('event', new MessageEvent('event', {
      data: JSON.stringify({ payload: { activeSlug: 'event-game' } }),
    }));
    expect(seen).toEqual(['event-game']);

    fetchSpy.mockReturnValueOnce(okJson({ activeSlug: 'authoritative-game' }));
    source.emit('open', new Event('open'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/active-game');
    expect(seen).toEqual(['event-game', 'authoritative-game']);

    unsubscribe?.();
    expect(source.closed).toBe(true);
  });

  it('subscribeActiveGame() falls back to fetch streaming when EventSource is unavailable', async () => {
    globalThis.EventSource = undefined as unknown as typeof EventSource;
    const encoder = new TextEncoder();
    let pushFrame: ((frame: string) => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        pushFrame = (frame) => controller.enqueue(encoder.encode(frame));
      },
    });
    fetchSpy
      .mockReturnValueOnce(Promise.resolve({ ok: true, body: stream } as Response))
      .mockReturnValueOnce(okJson({ activeSlug: 'authoritative-game' }));

    const seen: Array<string | null> = [];
    const unsubscribe = client().subscribeActiveGame((selection) => seen.push(selection.activeSlug));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/events/stream?topic=workbench.active-game.changed');
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/active-game');
    expect(seen).toEqual(['authoritative-game']);

    pushFrame?.('event: event\ndata: {"payload":{"activeSlug":"stream-game"}}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['authoritative-game', 'stream-game']);

    unsubscribe();
  });

  it('listGames() → GET /api/workbench/games', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ games: [], activeSlug: null }));
    await client().listGames();
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/games');
  });

  it('createGame() → POST /api/workbench/games with JSON body', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ ok: true }));
    const j = await client().createGame({ slug: 'foo', name: 'Foo', brief: '' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/workbench/games');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ slug: 'foo', name: 'Foo', brief: '' });
    expect(j.ok).toBe(true);
  });

  it('deleteGame(slug) → DELETE /api/workbench/games/{slug} URL-encoded', async () => {
    fetchSpy.mockReturnValueOnce(okJson({}));
    await client().deleteGame('a/b');
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/games/a%2Fb', { method: 'DELETE' });
  });

  it('setActiveGame(slug) 服务 500 时抛出', async () => {
    fetchSpy.mockReturnValueOnce(notOk(500));
    await expect(client().setActiveGame('demo')).rejects.toThrow(/HTTP 500/);
  });

  it('packageGame(slug) 不带 options → POST 无 body', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ jobId: 'j1' }));
    const j = await client().packageGame('demo');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/workbench/games/demo/package');
    expect((init as RequestInit).body).toBeUndefined();
    expect(j.jobId).toBe('j1');
  });

  it('packageGame(slug, options) → POST with JSON body', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ jobId: 'j2' }));
    await client().packageGame('demo', { targetPlatform: 'android', applicationId: 'com.x' });
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((JSON.parse((init as RequestInit).body as string) as { applicationId: string }).applicationId).toBe('com.x');
  });

  it('pollPackageJob(id) → GET /api/workbench/package/jobs/{id}', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ jobId: 'x', status: 'running' }));
    await client().pollPackageJob('x');
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/package/jobs/x');
  });

  it('getEngineRoots() → GET; 非 2xx 时返回 { roots: [] }', async () => {
    fetchSpy.mockReturnValueOnce(notOk(404));
    const j = await client().getEngineRoots();
    expect(j.roots).toEqual([]);
  });

  it('cleanPackage() → POST /api/workbench/package/clean', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ totalBytes: 0, targets: [] }));
    await client().cleanPackage();
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/package/clean', { method: 'POST' });
  });

  it('listPackageHistory() → GET; 非 2xx 返回 { records: [] }', async () => {
    fetchSpy.mockReturnValueOnce(notOk(404));
    const j = await client().listPackageHistory();
    expect(j.records).toEqual([]);
  });

  it('deletePackageHistory(id, {clean:true}) → DELETE …?clean=1', async () => {
    fetchSpy.mockReturnValueOnce(okJson({}));
    await client().deletePackageHistory('h1', { clean: true });
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/package/history/h1?clean=1', { method: 'DELETE' });
  });
});
