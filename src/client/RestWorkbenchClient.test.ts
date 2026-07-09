import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { createRestWorkbenchClient } from './RestWorkbenchClient';

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
const notOk = (status: number) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response);

describe('RestWorkbenchClient', () => {
  let fetchSpy: ReturnType<typeof mock>;
  beforeEach(() => {
    fetchSpy = mock(() => okJson({}));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
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

  it('getActiveSlug() → GET /api/workbench/active-slug', async () => {
    fetchSpy.mockReturnValueOnce(okJson({ activeSlug: 'demo' }));
    const j = await client().getActiveSlug();
    expect(fetchSpy).toHaveBeenCalledWith('/api/workbench/active-slug');
    expect(j.activeSlug).toBe('demo');
  });

  it('getActiveSlug() 非 2xx 时返回 { activeSlug: null }', async () => {
    fetchSpy.mockReturnValueOnce(notOk(500));
    const j = await client().getActiveSlug();
    expect(j.activeSlug).toBeNull();
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

  it('activateGame(slug) 服务 500 时抛出', async () => {
    fetchSpy.mockReturnValueOnce(notOk(500));
    await expect(client().activateGame('demo')).rejects.toThrow(/HTTP 500/);
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
