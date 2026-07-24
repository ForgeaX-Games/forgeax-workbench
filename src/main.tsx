// Standalone workbench app entry — OWNS its own boot, mirroring
// packages/editor/standalone/main.tsx. interface is consumed purely as a parts
// library; the IDE product shell (<App>) is studio's (L3) concern and is NOT
// rendered here. We mount just <WorkbenchMode/> full-viewport over the booted
// L1 store.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@forgeax/interface/styles/global.css';
import { applyTheme } from '@forgeax/design/theme';
import { initI18n } from '@forgeax/interface/i18n';
import { initAegis } from '@forgeax/interface/lib/aegis';
import { BrandProvider } from '@forgeax/interface/brand';
import { ErrorBoundary } from '@forgeax/interface/components/ErrorBoundary';
import { bootStageEntry } from '@forgeax/interface/boot/driver';
import { bootBroadcast } from '@forgeax/interface/boot/broadcast';
import { subscribeNarrativeCopilot } from '@forgeax/interface/lib/narrative-copilot';
import { subscribeFileActivityStream } from '@forgeax/interface/lib/file-activity-stream';
import { subscribePermissionStream } from '@forgeax/interface/lib/permission-stream';
import { subscribePerceptionStream } from '@forgeax/interface/lib/perception-stream';
import { syncBrowserPrefsFromServer, startBrowserPrefsSync } from '@forgeax/interface/lib/browser-prefs-sync';
import { useShellStore } from '@forgeax/interface/store';
import { setActiveWorkbench } from '@forgeax/interface/lib/workbenches';
import { installHealthBridge } from '@forgeax/interface/components/StatusBar/healthBridge';
import { WorkbenchMode } from './components/MainArea/WorkbenchMode';
import { initFilePreview } from './file-preview';

const SHELL_CSS = `
.forgeax-standalone-shell { position: fixed; inset: 0; display: flex; overflow: hidden; background: var(--color-background, #0e1216); }
.forgeax-standalone-shell > * { flex: 1 1 auto; min-width: 0; min-height: 0; }
`;

function boot(): void {
  applyTheme('dark');
  initI18n();
  initAegis();

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root missing');

  void syncBrowserPrefsFromServer().finally(() => {
    initI18n();
    startBrowserPrefsSync();
  });
  bootStageEntry();

  installHealthBridge();
  initFilePreview(); // ③ 文件预览 owner —— 发首帧快照 + 挂 open-file 命令监听
  bootBroadcast(); // R5/P1 唯一公共广播 socket（telemetry / workspace-changed）
  subscribeNarrativeCopilot();
  subscribeFileActivityStream();
  subscribePermissionStream();
  subscribePerceptionStream();
  // Seed the active workspace before initSessions so first paint lands on the AI workbench.
  setActiveWorkbench('ai');
  void useShellStore.getState().initSessions();

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__dev'] = useShellStore;
  }
  (window as unknown as { __forgeaxBoot?: { done?: () => void } }).__forgeaxBoot?.done?.();

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary scope="workbench-standalone">
        <BrandProvider>
          <style>{SHELL_CSS}</style>
          <div className="forgeax-standalone-shell studio-shell studio-shell--preview-skin">
            <WorkbenchMode />
          </div>
        </BrandProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

boot();
