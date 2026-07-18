// @forgeax/ai-workbench — public entry for the workbench L2 app.
//
// The workbench main-area surface: the agents browser (AgentsMainArea), the
// file workbench + plugin gallery + file preview (WorkbenchMode /
// WorkbenchModeDefault). File preview state is owned here. Some workbench
// navigation/plugin policy still lives in @forgeax/interface as an interim
// wrapper over the generic ExtensionIframeHost and should continue moving here
// or to studio composition in the interface-architecture refactor.
//
// studio (L3) injects these through the interface `renderWorkbench` slot;
// interface (L1) never imports this package.
export { WorkbenchMode, WorkbenchModeDefault, AgentsMainArea } from './components/MainArea/WorkbenchMode';
// ③ 文件预览（R5）—— owner 在 workbench，走 bus 'workbench:files'。boot 时由聚合方调 initFilePreview()。
export {
  initFilePreview,
  useFilePreview,
  openFile,
  activateFile,
  closeFile,
  updatePreviewContent,
  savePreviewFile,
  requestOpenFile,
  WORKBENCH_FILES_TOPIC,
  type PreviewFile,
  type PreviewKind,
  type FilePreviewSnapshot,
} from './file-preview';

// Bump 3 追加(改名 + Agents 集群 copy + RestWorkbenchClient):
// 这些出口在 Bump 4 才会被 studio(L3)/interface(L1)真正消费。目前只是把
// Agents 集群从 interface copy 过来,并在这里显式导出,让 ai-workbench
// 自身可 self-consistent 编译通过。
export { AgentsPanel } from './components/AgentsPanel/AgentsPanel';
export { WorkbenchAgentPicker } from './components/WorkbenchAgentPicker/WorkbenchAgentPicker';
export { createRestWorkbenchClient } from './client/RestWorkbenchClient';
// helpers 也 re-export —— 其他 L2 包(尤其 @forgeax/settings 引 agent-groups)
// 从 ai-workbench 拿这几个而不是继续从 interface 拿。
export * from './lib/agent-role';
export * from './lib/agent-name';
export * from './lib/open-agent-detail';
export * from './data/agent-groups';
