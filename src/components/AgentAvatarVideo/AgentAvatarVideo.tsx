/**
 * AgentAvatarVideo — agent 头像的 WEBM 状态机版.
 *
 * 见 ADR-0019.
 *
 * - mode='idle'           : 永远播 default (期待) 循环, 不订阅 chat 事件. 列表 / register 用.
 * - mode='conversational' : 用 useAgentAvatarState 取 top emotion, 切 state 时
 *                            做 fadeInMs crossfade. 对话区用.
 *
 * 没找到 avatarRules 时 (老 agent / 资源缺) 渲染 fallback prop. 调用方继续显示
 * 它原本的 SVG/initial/img 头像, 这一层完全透明.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { platformRuntime } from '@forgeax/interface/lib/platform';
import { APP_EVENTS } from '@forgeax/interface/lib/storageKeys';
import { agentAvatarVideoUrl } from './avatar-playback-policy';
import { useAgentAvatarRules } from './useAgentAvatarRules';
import { useAgentAvatarState } from './useAgentAvatarState';
import type { AgentAvatarRules, AgentAvatarState } from './types';
import './agent-avatar-video.css';

type Mode = 'conversational' | 'idle';

interface Props {
  agentId: string | null | undefined;
  mode?: Mode;
  size?: number;
  shape?: 'circle' | 'square';
  className?: string;
  /** rules 还没拿到 / agent 没 avatarSet 时降级渲染什么 (老 SVG / initials / emoji). */
  fallback: React.ReactNode;
  /** 是否始终在视频下保留 fallback (调试用). 默认 false. */
  showFallbackUnder?: boolean;
}

function pickState(
  rules: AgentAvatarRules,
  name: string | null,
): AgentAvatarState {
  if (name && rules.states[name]) return rules.states[name];
  const fb = rules.states[rules.fallback];
  if (fb) return fb;
  return rules.states[rules.default];
}

export const AgentAvatarVideo = memo(function AgentAvatarVideo({
  agentId,
  mode = 'conversational',
  size = 32,
  shape = 'circle',
  className,
  fallback,
  showFallbackUnder = false,
}: Props) {
  const rules = useAgentAvatarRules(agentId);
  const conversationalState = useAgentAvatarState(
    mode === 'conversational' ? agentId : null,
    rules,
  );
  const [hasRenderableFrame, setHasRenderableFrame] = useState(false);

  useEffect(() => {
    setHasRenderableFrame(false);
  }, [agentId]);

  if (!rules) {
    // 资源没准备好时, 老头像继续顶上.
    return <>{fallback}</>;
  }

  const stateName = mode === 'idle' ? rules.default : (conversationalState ?? rules.default);
  const state = pickState(rules, stateName);
  const runtime = platformRuntime();
  const videoUrl = agentAvatarVideoUrl(state, runtime);
  if (!videoUrl) return <>{fallback}</>;
  const playbackState = videoUrl === state.url ? state : { ...state, url: videoUrl };
  // 取 agent id 末段做 data-agent-id (跟 server 端 def.id 对齐); CSS 里可以按
  // [data-agent-id="suzu"] 做单 agent 微调 (e.g. suzu 美术资源头顶留白多, 需要小幅
  // 放大 + 上推). 见 agent-avatar-video.css.
  const dataAgentId = agentId ? (agentId.split('/').pop() ?? agentId) : undefined;

  return (
    <span
      className={['agent-avatar-video', `is-${shape}`, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      data-state={state.state}
      data-mode={mode}
      data-agent-id={dataAgentId}
      data-runtime={runtime}
      aria-hidden
    >
      {(showFallbackUnder || !hasRenderableFrame) && (
        <span className="aav-fallback-under">{fallback}</span>
      )}
      <VideoStack
        state={playbackState}
        onFrameReady={() => setHasRenderableFrame(true)}
        onFrontError={() => setHasRenderableFrame(false)}
      />
    </span>
  );
});

/**
 * 双缓冲 <video> — 解决"切 state 时头像空白几秒"的问题.
 *
 * 失败方案 (debug 留底, 别再走回头路):
 *   - 单 <video> + key={state.url}: React unmount 旧 video → mount 新 video 之间
 *     有一段空白 (浏览器没有 poster 时这段空白可达数秒).
 *   - 单 <video> + ref.src 命令式切: spec 上 src 变更会触发 resource selection,
 *     ready_state 回到 HAVE_NOTHING, 显示帧也会被清掉, 跟 unmount 表现一致.
 *
 * 当前方案: 维护两个 video 槽位 A 和 B, 一个前景一个备用.
 *   - 切 state 时, 把 newUrl 设给"备用槽"的 src, 备用槽在后台开始解码;
 *     **前景槽保持原 webm 继续循环播放**, 用户视觉不间断.
 *   - 备用槽 onLoadedData (= 首帧可绘制) 触发, 把它升为前景, 旧前景下沉变备用.
 *   - 同 state 重复触发 (decay 反复打) 直接 noop.
 *
 * 强制 loop=true (忽略 AVATAR.md 里的 loop=false); 见用户反馈.
 */
function VideoStack({
  state,
  onFrameReady,
  onFrontError,
}: {
  state: AgentAvatarState;
  onFrameReady: () => void;
  onFrontError: () => void;
}) {
  // 哪个槽是当前可见的前景.
  const [frontSlot, setFrontSlot] = useState<'a' | 'b'>('a');
  // 两个槽分别的 src. 初次都用 state.url, 立即播.
  const [srcA, setSrcA] = useState(state.url);
  const [srcB, setSrcB] = useState<string | null>(null);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  // 备用槽当前在尝试加载的目标 url — 用于幂等检查 + 防御 stale onLoadedData.
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    const front = frontSlot === 'a' ? srcA : srcB;
    if (state.url === front) {
      // 已经在播这个 state, 不动.
      pendingRef.current = null;
      return;
    }
    if (pendingRef.current === state.url) return; // already loading this one
    pendingRef.current = state.url;
    // 把 newUrl 灌到备用槽; 前景槽不动 → 用户继续看到旧画面循环.
    if (frontSlot === 'a') {
      setSrcB(state.url);
    } else {
      setSrcA(state.url);
    }
  }, [state.url, frontSlot, srcA, srcB]);

  // The viewport and the workbench share one compositor surface. Four looping
  // avatar videos are harmless while editing, but Chrome can use their video
  // sinks to choose a 30 Hz page BeginFrame interval while Play is active.
  // Pause only videos that were actually playing so Stop restores the user's
  // normal avatar animation without restarting a deliberately paused video.
  useEffect(() => {
    const syncPlayback = (running: boolean): void => {
      const videos = [videoARef.current, videoBRef.current].filter(
        (video): video is HTMLVideoElement => video !== null,
      );
      for (const video of videos) {
        if (running) {
          if (!video.paused) video.dataset.forgeaxResumeAfterViewport = 'true';
          video.pause();
        } else if (video.dataset.forgeaxResumeAfterViewport === 'true') {
          delete video.dataset.forgeaxResumeAfterViewport;
          void video.play().catch(() => {
            // Autoplay may be denied after a browser/user gesture boundary;
            // the avatar remains paused rather than producing an unhandled
            // rejection or retry loop.
          });
        }
      }
    };

    const onViewportRunChanged = (event: Event): void => {
      const running = (event as CustomEvent<{ running?: unknown }>).detail?.running;
      if (typeof running === 'boolean') syncPlayback(running);
    };

    window.addEventListener(APP_EVENTS.viewportRunChanged, onViewportRunChanged);
    const running = document.documentElement.dataset.forgeaxViewportRunning === 'true';
    syncPlayback(running);
    return () => window.removeEventListener(APP_EVENTS.viewportRunChanged, onViewportRunChanged);
  }, [srcA, srcB]);

  const handleLoaded = (slot: 'a' | 'b', mySrc: string) => {
    const front = frontSlot === 'a' ? srcA : srcB;
    if (slot === frontSlot) {
      if (mySrc === front) onFrameReady();
      return;
    }
    // 防 stale: 备用槽载入完成时 state 可能又变了 → 检查这个 onLoadedData 对应的
    // 是不是当前 pending 目标; 不是的话 ignore (后续 effect 会再灌一次新 src).
    if (mySrc !== pendingRef.current) return;
    setFrontSlot(slot);
    pendingRef.current = null;
    onFrameReady();
  };

  const handleError = (slot: 'a' | 'b', mySrc: string) => {
    const front = frontSlot === 'a' ? srcA : srcB;
    if (slot === frontSlot && mySrc === front) {
      onFrontError();
      return;
    }
    if (mySrc === pendingRef.current) pendingRef.current = null;
  };

  return (
    <>
      <video
        ref={videoARef}
        className="aav-layer"
        src={srcA}
        autoPlay
        muted
        playsInline
        loop
        preload="auto"
        style={{ visibility: frontSlot === 'a' ? 'visible' : 'hidden' }}
        onLoadedData={() => handleLoaded('a', srcA)}
        onError={() => handleError('a', srcA)}
      />
      {srcB !== null && (
        <video
          ref={videoBRef}
          className="aav-layer"
          src={srcB}
          autoPlay
          muted
          playsInline
          loop
          preload="auto"
          style={{ visibility: frontSlot === 'b' ? 'visible' : 'hidden' }}
          onLoadedData={() => handleLoaded('b', srcB)}
          onError={() => handleError('b', srcB)}
        />
      )}
    </>
  );
}

// 给 fallback 用 - 调用方不传 fallback 时也至少别炸.
export const NullFallback = <span />;

// 引用 rules 类型避免被 tsc 抢救式删掉.
export type { AgentAvatarRules };
