// ==========================================================================
// Ergalics Studio — block mode public surface
// ==========================================================================

export { BLOCK_DEFS } from './blocks';
export type { BlockDef } from './blocks';
export {
  blockJSONToIR,
  workspaceJSONToIR,
  irToBlockJSON,
  irToWorkspaceJSON,
} from './convert';
export type { BlockJSON, WorkspaceJSON } from './convert';
export { createKidsTheme } from './theme';
export { TOOLBOX } from './toolbox';
export {
  initBlocklyEngine,
  createWorkspace,
  workspaceToIR,
  loadIRIntoWorkspace,
  disposeWorkspace,
} from './engine';
