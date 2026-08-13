import { describe, expect, test } from 'bun:test';
import { agentAvatarVideoUrl } from './avatar-playback-policy';

const state = {
  state: '期待',
  url: '/avatar/01.webm',
  desktopUrl: '/avatar/01.desktop.mov',
  loop: true,
  fadeInMs: 0,
};

describe('agentAvatarVideoUrl', () => {
  test('selects VP9 alpha WebM in the web runtime', () => {
    expect(agentAvatarVideoUrl(state, 'web')).toBe('/avatar/01.webm');
  });

  test('selects HEVC alpha video in the Tauri WKWebView runtime', () => {
    expect(agentAvatarVideoUrl(state, 'tauri')).toBe('/avatar/01.desktop.mov');
  });

  test('returns null for an older agent pack without a desktop variant', () => {
    expect(agentAvatarVideoUrl({ ...state, desktopUrl: undefined }, 'tauri')).toBeNull();
  });
});
