export interface FileEntry {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  format: string;
  content: string; // base64 or text content
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up?: [number, number, number];
}

export interface SceneState {
  objects?: unknown;
  background?: string;
}

export interface ProjectState {
  activePlugin: string | null;
  parameters: Record<string, Record<string, unknown>>;
  camera: CameraState | null;
  scene: SceneState | null;
}

export interface ProjectMetadata {
  version: string;
  description: string | null;
  tags: string[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: {
    files: FileEntry[];
    processed?: unknown;
  };
  state: ProjectState;
  metadata: ProjectMetadata;
}

export const PROJECT_FORMAT_VERSION = '1.0';

export function createEmptyProject(name: string): Project {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    data: { files: [], processed: undefined },
    state: {
      activePlugin: null,
      parameters: {},
      camera: null,
      scene: null,
    },
    metadata: {
      version: PROJECT_FORMAT_VERSION,
      description: null,
      tags: [],
    },
  };
}

export function touchProject(project: Project): Project {
  return { ...project, updatedAt: Date.now() };
}

export function cloneProject(project: Project): Project {
  return structuredClone(project) as Project;
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(raw: string): Project {
  const parsed = JSON.parse(raw) as Project;
  if (!parsed.id || !parsed.name || !parsed.state) {
    throw new Error('Invalid project format');
  }
  return parsed;
}
