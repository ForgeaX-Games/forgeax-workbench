// @forgeax/workbench — public entry for the workbench L2 app.
//
// The workbench main-area surface: the agents browser (AgentsMainArea), the
// file workbench + plugin gallery + file preview (WorkbenchMode /
// WorkbenchModeDefault). Its DATA (mode / workbenchTab / open files / docked
// plugins) and the plugin-HOSTING runtime (WorkbenchPluginHost, keep-alive
// iframes, CenterPluginLayer, StandalonePluginIframe, host-sdk RPC, wb:* dock
// panels) all stay in @forgeax/interface as L1 shell infrastructure — this
// package is the navigation/gallery presentation over it.
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
