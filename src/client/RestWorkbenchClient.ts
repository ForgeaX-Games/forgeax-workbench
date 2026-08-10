// packages/workbench-builtins/src/client/RestWorkbenchClient.ts
//
// REST 实现的 WorkbenchClient factory,由 studio(L3)在 boot 时调
// configureWorkbenchClient(createRestWorkbenchClient()) 注入 interface。
//
// Bump 3 期间,interface 里的 createDefaultRestWorkbenchClient() 仍作为兜底
// 存在,单元语义完全一致(URL 拼接/HTTP 语义/异常语义)——本文件是它的
// 逐字复刻,只把 import 从 workbench-client.ts 内部换成 @forgeax/interface/store。
// Bump 4 会删除 interface 侧的兜底,由本 factory 单点接管。

import type { ActiveGameSelection, RuntimeScopeState, WorkbenchClient } from '@forgeax/interface/store';

const ACTIVE_GAME_STREAM_URL = '/api/events/stream?topic=workbench.active-game.changed';
const ACTIVE_GAME_TRANSIENT_RETRIES = 8;
const ACTIVE_GAME_TRANSIENT_RETRY_DELAY_MS = 250;

function waitForActiveGameRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ACTIVE_GAME_TRANSIENT_RETRY_DELAY_MS));
}

function normalizeActiveGame(raw: unknown): ActiveGameSelection | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as { activeSlug?: unknown; runtime?: unknown };
  const activeSlug = candidate.activeSlug;
  if (!(activeSlug === null || typeof activeSlug === 'string')) return null;
  const runtime = candidate.runtime;
  return runtime !== undefined && runtime !== null && typeof runtime === 'object'
    ? { activeSlug, runtime: runtime as RuntimeScopeState }
    : { activeSlug };
}

function activeGameFromEnvelope(raw: string): ActiveGameSelection | null {
  try {
    const envelope = JSON.parse(raw) as { payload?: unknown };
    return normalizeActiveGame(envelope.payload);
  } catch {
    return null;
  }
}

async function followActiveGameStream(
  response: Response,
  listener: (selection: ActiveGameSelection) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!response.ok || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data = '';
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (event === 'event' && data) {
            const selection = activeGameFromEnvelope(data);
            if (selection) listener(selection);
          }
          event = '';
          data = '';
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data += `${data ? '\n' : ''}${line.slice(5).trim()}`;
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
    reader.releaseLock();
  }
}

export function createRestWorkbenchClient(): WorkbenchClient {
  return {
    async listAgents(opts) {
      const r = opts?.lang === 'zh'
        ? await fetch('/api/workbench/agents?lang=zh')
        : await fetch('/api/workbench/agents');
      if (!r.ok) throw new Error(`listAgents → HTTP ${r.status}`);
      return r.json();
    },
    async getActiveGame() {
      const r = await fetch('/api/workbench/active-game');
      if (!r.ok) return { activeSlug: null };
      return normalizeActiveGame(await r.json()) ?? { activeSlug: null };
    },
    async setActiveGame(slug) {
      let r: Response;
      for (let attempt = 0; ; attempt += 1) {
        r = await fetch('/api/workbench/active-game', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
        // The server returns 503 only after it has persisted the requested
        // selection but the Play sidecar could not bind yet. Keep the one
        // canonical write in flight through the normal startup race; all
        // other status codes remain immediate product errors.
        if (r.status !== 503 || attempt >= ACTIVE_GAME_TRANSIENT_RETRIES) break;
        await waitForActiveGameRetry();
      }
      if (!r.ok) throw new Error(`setActiveGame → HTTP ${r.status}`);
      const selection = normalizeActiveGame(await r.json());
      if (selection === null) throw new Error('setActiveGame → invalid active-game response');
      return selection;
    },
    subscribeActiveGame(listener) {
      const readAuthority = () => fetch('/api/workbench/active-game')
        .then((response) => response.ok ? response.json() : null)
        .then((raw: unknown) => {
          const selection = normalizeActiveGame(raw);
          if (selection !== null) listener(selection);
        })
        .catch(() => { /* the next event or reconnect will retry */ });

      if (typeof EventSource === 'undefined') {
        let closed = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let controller: AbortController | undefined;
        const connect = async (): Promise<void> => {
          controller = new AbortController();
          try {
            const response = await fetch(ACTIVE_GAME_STREAM_URL, { signal: controller.signal });
            if (closed) return;
            // The stream is established before this read, so a change racing
            // with the snapshot is observed either by the snapshot or by the
            // subsequently consumed stream.
            await readAuthority();
            await followActiveGameStream(response, listener, controller.signal);
          } catch {
            /* reconnect below */
          }
          if (!closed) retryTimer = setTimeout(() => void connect(), 1_000);
        };
        void connect();
        return () => {
          closed = true;
          if (retryTimer !== undefined) clearTimeout(retryTimer);
          controller?.abort();
        };
      }

      const source = new EventSource(ACTIVE_GAME_STREAM_URL);
      const onOpen = () => {
        // The generic event stream has no replay cursor. Re-read the authority
        // whenever it connects so a page cannot miss a transition while
        // disconnected.
        void readAuthority();
      };
      const onEvent = (event: Event) => {
        const selection = activeGameFromEnvelope((event as MessageEvent<string>).data);
        if (selection) listener(selection);
      };
      source.addEventListener('open', onOpen);
      source.addEventListener('event', onEvent);
      return () => {
        source.removeEventListener('open', onOpen);
        source.removeEventListener('event', onEvent);
        source.close();
      };
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
