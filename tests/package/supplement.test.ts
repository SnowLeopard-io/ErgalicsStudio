// ==========================================================================
// Ergalics Studio — supplement packaging tests (core)
//
// Zip round-trip (fflate unzipSync) + manifest completeness: metadata form,
// run records, lineage graph, data/code inclusion and name de-duplication.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildSupplement } from '@/core/package/supplement';
import type { SupplementManifest } from '@/core/package/supplement';
import { createEmptyProject } from '@/types/project';
import type { FileEntry, Project } from '@/types/project';

function makeProject(): Project {
  const project = createEmptyProject('Lineage Study');
  project.metadata.description = 'A study';
  project.metadata.tags = ['biology'];
  return project;
}

function withFile(project: Project, id: string, name: string, content: string): Project {
  const entry: FileEntry = {
    id,
    name,
    size: content.length,
    mimeType: 'text/plain',
    format: 'txt',
    content,
  };
  return { ...project, data: { ...project.data, files: [...project.data.files, entry] } };
}

async function unzip(bytes: Uint8Array): Promise<Record<string, string>> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    out[name] = strFromU8(data);
  }
  return out;
}

describe('buildSupplement — manifest', () => {
  it('produces a parseable manifest with project + meta + lineage', async () => {
    const project = makeProject();
    const zip = await unzip(await buildSupplement(project, {
      meta: { author: 'J. Doe', license: 'CC-BY-4.0', description: 'Replication pack' },
    }));

    const manifest = JSON.parse(zip['manifest.json']!) as SupplementManifest;
    expect(manifest.generator).toBe('Ergalics Studio');
    expect(manifest.project.name).toBe('Lineage Study');
    expect(manifest.project.description).toBe('A study');
    expect(manifest.project.tags).toEqual(['biology']);
    expect(manifest.meta).toEqual({ author: 'J. Doe', license: 'CC-BY-4.0', description: 'Replication pack' });
    // No runs without IndexedDB, but the graph shape is always present.
    expect(Array.isArray(manifest.runs)).toBe(true);
    expect(manifest.lineage).toBeDefined();
    expect(Array.isArray(manifest.lineage.nodes)).toBe(true);
    expect(manifest.contents).toEqual({ data: [], code: [], reproLock: null });
  });

  it('embeds a repro.lock when requested', async () => {
    const project = makeProject();
    const zip = await unzip(await buildSupplement(project, { reproLock: true }));
    expect(zip['repro.lock']).toBeDefined();
    const lock = JSON.parse(zip['repro.lock']!) as { lockVersion: number; projectId: string; runs: unknown[] };
    expect(lock.lockVersion).toBe(2);
    expect(lock.projectId).toBe(project.id);
    expect(Array.isArray(lock.runs)).toBe(true);
    const manifest = JSON.parse(zip['manifest.json']!) as SupplementManifest;
    expect(manifest.contents.reproLock).toBe('repro.lock');
  });

  it('records the project file as a lineage source node', async () => {
    const project = withFile(makeProject(), 'f1', 'measurements.csv', 'x,y\n1,2\n');
    const zip = await unzip(await buildSupplement(project));
    const manifest = JSON.parse(zip['manifest.json']!) as SupplementManifest;
    const fileNodes = manifest.lineage.nodes.filter((n) => n.kind === 'file');
    expect(fileNodes.map((n) => n.label)).toContain('measurements.csv');
  });
});

describe('buildSupplement — payload inclusion', () => {
  it('includes data files only when requested', async () => {
    const project = withFile(makeProject(), 'f1', 'a.csv', '1,2');
    const without = await unzip(await buildSupplement(project, {}));
    expect(Object.keys(without)).toEqual(['manifest.json']);

    const withData = await unzip(await buildSupplement(project, { includeData: true }));
    expect(withData['data/a.csv']).toBe('1,2');
    const manifest = JSON.parse(withData['manifest.json']!) as SupplementManifest;
    expect(manifest.contents.data).toEqual(['a.csv']);
  });

  it('de-duplicates colliding data file names instead of merging them', async () => {
    let project = withFile(makeProject(), 'f1', 'run.csv', 'old');
    project = withFile(project, 'f2', 'run.csv', 'new');
    const zip = await unzip(await buildSupplement(project, { includeData: true }));
    const names = Object.keys(zip).filter((n) => n.startsWith('data/'));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('packs authored code sessions with language extensions', async () => {
    const project = makeProject();
    project.state.editorSessions = [
      {
        id: 's1',
        mode: 'code',
        language: 'python',
        ir: {} as never,
        lastCode: 'print("hello")',
        syncState: 'clean',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const zip = await unzip(await buildSupplement(project, { code: true }));
    expect(zip['code/Lineage_Study-1.py']).toBe('print("hello")');
  });

  it('skips empty code sessions and omits code/ entirely when not requested', async () => {
    const project = makeProject();
    project.state.editorSessions = [
      {
        id: 's1',
        mode: 'code',
        language: 'python',
        ir: {} as never,
        lastCode: '   ',
        syncState: 'clean',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const withoutCode = await unzip(await buildSupplement(project, {}));
    expect(Object.keys(withoutCode).some((n) => n.startsWith('code/'))).toBe(false);

    const withEmptyCode = await unzip(await buildSupplement(project, { code: true }));
    expect(Object.keys(withEmptyCode).some((n) => n.startsWith('code/'))).toBe(false);
  });
});
