// packages/workbench-builtins/src/client/RestWorkbenchClient.ts
//
// REST 实现的 WorkbenchClient factory,由 studio(L3)在 boot 时调
// configureWorkbenchClient(createRestWorkbenchClient()) 注入 interface。
//
// Bump 3 期间,interface 里的 createDefaultRestWorkbenchClient() 仍作为兜底
// 存在,单元语义完全一致(URL 拼接/HTTP 语义/异常语义)——本文件是它的
// 逐字复刻,只把 import 从 workbench-client.ts 内部换成 @forgeax/interface/store。
// Bump 4 会删除 interface 侧的兜底,由本 factory 单点接管。

import type { WorkbenchClient } from '@forgeax/interface/store';

export function createRestWorkbenchClient(): WorkbenchClient {
  return {
    async listAgents(opts) {
      const r = opts?.lang === 'zh'
        ? await fetch('/api/workbench/agents?lang=zh')
        : await fetch('/api/workbench/agents');
      if (!r.ok) throw new Error(`listAgents → HTTP ${r.status}`);
      return r.json();
    },
    async getActiveSlug() {
      const r = await fetch('/api/workbench/active-slug');
      if (!r.ok) return { activeSlug: null };
      return r.json();
    },
    async listGames() {
      const r = await fetch('/api/workbench/games');
      if (!r.ok) throw new Error(`listGames → HTTP ${r.status}`);
      return r.json();
    },
    async createGame(input) {
      const r = await fetch('/api/workbench/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      return { ok: !!(r.ok && j.ok), error: j.error };
    },
    async deleteGame(slug) {
      const r = await fetch(`/api/workbench/games/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`deleteGame → HTTP ${r.status}`);
    },
    async activateGame(slug) {
      const r = await fetch(`/api/workbench/games/${encodeURIComponent(slug)}/activate`, { method: 'POST' });
      if (!r.ok) throw new Error(`activateGame → HTTP ${r.status}`);
    },
    async packageGame(slug, options) {
      const hasBody = options != null;
      const r = await fetch(`/api/workbench/games/${encodeURIComponent(slug)}/package`, {
        method: 'POST',
        headers: hasBody ? { 'content-type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(options) : undefined,
      });
      if (!r.ok) throw new Error(`packageGame → HTTP ${r.status}`);
      return r.json();
    },
    async pollPackageJob(jobId) {
      const r = await fetch(`/api/workbench/package/jobs/${encodeURIComponent(jobId)}`);
      if (!r.ok) throw new Error(`pollPackageJob → HTTP ${r.status}`);
      return r.json();
    },
    async getEngineRoots() {
      const r = await fetch('/api/workbench/package/engine-roots');
      if (!r.ok) return { roots: [] };
      return r.json();
    },
    async cleanPackage() {
      const r = await fetch('/api/workbench/package/clean', { method: 'POST' });
      if (!r.ok) throw new Error(`cleanPackage → HTTP ${r.status}`);
      return r.json();
    },
    async listPackageHistory() {
      const r = await fetch('/api/workbench/package/history');
      if (!r.ok) return { records: [] };
      return r.json();
    },
    async deletePackageHistory(id, opts) {
      // 保持与旧调用方等价的两个具体字符串,让 interface 边界白名单可以静态匹配。
      const r = opts?.clean
        ? await fetch(`/api/workbench/package/history/${encodeURIComponent(id)}?clean=1`, { method: 'DELETE' })
        : await fetch(`/api/workbench/package/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`deletePackageHistory → HTTP ${r.status}`);
    },
  };
}
