/**
 * 模块级 avatar rules 注册表 - 缓存 server `/api/workbench/agents` 返回的
 * avatarRules. 首次任意组件调用 useAgentAvatarRules 时触发一次 fetch, 之后所有
 * 组件共享同一份字典 (24 agents × ~9 states × URL ≈ 22KB, 无压力).
 *
 * 见 ADR-0019 §Decision §3.
 */
import { getWorkbenchClient } from '@forgeax/interface/store';
import type { AgentAvatarRules } from './types';

let _rules: Record<string, AgentAvatarRules> | null = null;
let _inflight: Promise<Record<string, AgentAvatarRules>> | null = null;
const _listeners = new Set<() => void>();

function notify(): void {
  for (const l of _listeners) {
    try {
      l();
    } catch (err) {
      console.warn('[avatar-registry] listener threw', err);
    }
  }
}

export function subscribeAvatarRules(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

export function getAvatarRulesSnapshot(): Record<string, AgentAvatarRules> | null {
  return _rules;
}

export function ensureAvatarRulesLoaded(): Promise<Record<string, AgentAvatarRules>> {
  if (_rules) return Promise.resolve(_rules);
  if (_inflight) return _inflight;
  _inflight = getWorkbenchClient()
    .listAgents({ lang: 'zh' })
    .then((j) => {
      const dict: Record<string, AgentAvatarRules> = {};
      for (const a of j.agents ?? []) {
        const rules = (a as { avatarRules?: AgentAvatarRules }).avatarRules;
        if (rules) dict[a.id] = rules;
      }
      _rules = dict;
      _inflight = null;
      notify();
      return dict;
    })
    .catch((err) => {
      console.warn('[avatar-registry] fetch failed', err);
      _rules = {};
      _inflight = null;
      notify();
      return {};
    });
  return _inflight;
}
