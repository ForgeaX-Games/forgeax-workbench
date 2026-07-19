/** ③ 文件预览 / 多标签编辑 —— 从 interface L1 store 抽出（R5）。owner = workbench。
 *
 *  机制：状态放 L1 bus 的 retained 快照（'workbench:files'），workbench 读写，L1 壳侧
 *  （FilesPanel / AgentsPanel）零 import workbench：
 *   - 打开文件：壳发 bus 命令 'workbench:open-file' {path} → workbench 执行 openFile；
 *   - 高亮当前：壳 `useBusSnapshot('workbench:files')` 读 activeFilePath。
 *
 *  视图切换（mode='workbench' / workbenchTab='files' = ④ 仍属 L1 壳布局）由 workbench
 *  直接调 L1 `openWorkbench()`（L2→L1 合法依赖），文件内容态本身归 workbench。
 */

import { publish, peek, subscribe } from '@forgeax/interface/lib/bus';
import { useBusSnapshot } from '@forgeax/interface/lib/use-bus-snapshot';
import { useShellStore } from '@forgeax/interface/store';
import { t } from '@forgeax/interface/i18n';

export type PreviewKind = 'text' | 'image' | 'audio' | 'video' | 'model' | 'binary';
export interface PreviewFile {
  path: string;
  kind: PreviewKind;
  mime: string;
  bytes: number;
  content?: string;
  dirty?: boolean;
  error?: string;
}
export interface FilePreviewSnapshot {
  openFiles: PreviewFile[];
  activeFilePath: string | null;
}

export const WORKBENCH_FILES_TOPIC = 'workbench:files';
export const WORKBENCH_OPEN_FILE_TOPIC = 'workbench:open-file';

const EMPTY: FilePreviewSnapshot = { openFiles: [], activeFilePath: null };

function snap(): FilePreviewSnapshot {
  return (peek(WORKBENCH_FILES_TOPIC) as FilePreviewSnapshot | undefined) ?? EMPTY;
}
function commit(next: FilePreviewSnapshot): void {
  publish(WORKBENCH_FILES_TOPIC, next, { retain: true });
}
/** 进入 workbench「文件」视图 —— ④ 壳布局仍在 L1，workbench 直接驱动。 */
function enterFilesView(): void {
  useShellStore.getState().openWorkbench({ tab: 'files', expandedExtensionId: null });
}

export async function openFile(path: string): Promise<void> {
  const cur = snap();
  // 已打开 → 仅激活 + 切到文件视图。
  if (cur.openFiles.find((f) => f.path === path)) {
    commit({ ...cur, activeFilePath: path });
    enterFilesView();
    return;
  }
  const addFile = (file: PreviewFile) => {
    const s = snap();
    commit({
      openFiles: [...s.openFiles.filter((f) => f.path !== path), file],
      activeFilePath: path,
    });
    enterFilesView();
  };
  try {
    const r = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    if (!r.ok) {
      // 友好报错（AGENTS 台账里 agent 只读过的引擎/库源码在可编辑工作区外 → 400；
      // 404 = 路径已不存在）。
      let serverMsg = '';
      try { serverMsg = ((await r.json()) as { error?: string }).error ?? ''; } catch { /* non-JSON */ }
      const friendly = r.status === 400
        ? t('store.openFile.notInWorkspace', { path }) + (serverMsg ? t('store.openFile.serverDetail', { serverMsg }) : '')
        : r.status === 404
          ? t('store.openFile.notFound', { path })
          : t('store.openFile.failed', { path, status: r.status, statusText: r.statusText }) + (serverMsg ? ` — ${serverMsg}` : '');
      addFile({ path, kind: 'text', mime: 'text/plain', bytes: 0, content: friendly, error: serverMsg || `${r.status} ${r.statusText}` });
      return;
    }
    const j = (await r.json()) as { kind?: PreviewKind; mime?: string; size?: number; content?: string };
    addFile({
      path,
      kind: j.kind ?? 'text',
      mime: j.mime ?? 'application/octet-stream',
      bytes: j.size ?? 0,
      content: j.kind === 'text' || !j.kind ? (j.content ?? '') : undefined,
    });
  } catch (e) {
    addFile({ path, kind: 'text', mime: 'text/plain', bytes: 0, content: `[error] ${(e as Error).message}`, error: (e as Error).message });
  }
}

export function activateFile(path: string): void {
  const cur = snap();
  if (!cur.openFiles.find((f) => f.path === path)) return;
  commit({ ...cur, activeFilePath: path });
}

export function closeFile(path?: string): void {
  const cur = snap();
  const target = path ?? cur.activeFilePath;
  if (!target) return;
  const remaining = cur.openFiles.filter((f) => f.path !== target);
  let nextActive = cur.activeFilePath;
  if (cur.activeFilePath === target) {
    const idx = cur.openFiles.findIndex((f) => f.path === target);
    nextActive = remaining[Math.max(0, idx - 1)]?.path ?? remaining[0]?.path ?? null;
  }
  commit({ openFiles: remaining, activeFilePath: nextActive });
}

export function updatePreviewContent(content: string): void {
  const cur = snap();
  if (!cur.activeFilePath) return;
  const file = cur.openFiles.find((f) => f.path === cur.activeFilePath);
  if (!file || file.kind !== 'text') return;
  commit({
    ...cur,
    openFiles: cur.openFiles.map((f) => (f.path === cur.activeFilePath ? { ...f, content, dirty: true } : f)),
  });
}

export async function savePreviewFile(): Promise<{ ok: boolean; error?: string }> {
  const { openFiles, activeFilePath } = snap();
  const file = openFiles.find((f) => f.path === activeFilePath);
  if (!file) return { ok: false, error: 'no file open' };
  if (file.kind !== 'text') return { ok: false, error: 'binary files are read-only' };
  try {
    const r = await fetch('/api/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: file.path, content: file.content ?? '' }),
    });
    const j = (await r.json()) as { bytes?: number; error?: string };
    if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
    const s = snap();
    commit({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === file.path ? { ...f, dirty: false, bytes: j.bytes ?? f.bytes } : f)),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 壳侧（L1 FilesPanel/AgentsPanel）触发打开文件 —— 发 bus 命令，owner 执行。 */
export function requestOpenFile(path: string): void {
  publish(WORKBENCH_OPEN_FILE_TOPIC, { path } as never);
}

const _INIT_FLAG = '__FORGEAX_FILE_PREVIEW_INIT__';
type WithFlag = { [_INIT_FLAG]?: boolean };
/** boot 时由 owner（studio 聚合 / 独立 workbench）调一次：发首帧空快照 + 挂 open-file 命令监听。 */
export function initFilePreview(): void {
  const g = globalThis as unknown as WithFlag;
  if (g[_INIT_FLAG]) { if (!peek(WORKBENCH_FILES_TOPIC)) commit(EMPTY); return; }
  g[_INIT_FLAG] = true;
  if (!peek(WORKBENCH_FILES_TOPIC)) commit(EMPTY);
  subscribe(WORKBENCH_OPEN_FILE_TOPIC, (p) => {
    const path = (p as { path?: string } | undefined)?.path;
    if (typeof path === 'string' && path) void openFile(path);
  });
}

/** React 读侧 —— workbench 组件读文件预览态。 */
export function useFilePreview(): FilePreviewSnapshot {
  return (useBusSnapshot(WORKBENCH_FILES_TOPIC) as FilePreviewSnapshot | undefined) ?? EMPTY;
}
