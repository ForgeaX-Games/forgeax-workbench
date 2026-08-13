import type { PlatformRuntime } from '@forgeax/interface/lib/platform';
import type { AgentAvatarState } from './types';

/**
 * Chromium uses the source VP9-with-alpha WebM. macOS WKWebView uses the
 * loader-derived HEVC-with-alpha variant because WebKit cannot reliably
 * composite the VP9 alpha plane. Returning null keeps the existing caller
 * fallback explicit when an older agent pack has not generated that variant.
 */
export function agentAvatarVideoUrl(
  state: AgentAvatarState,
  runtime: PlatformRuntime,
): string | null {
  return runtime === 'tauri' ? (state.desktopUrl ?? null) : state.url;
}
