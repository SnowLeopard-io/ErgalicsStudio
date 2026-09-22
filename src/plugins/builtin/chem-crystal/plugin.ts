// ==========================================================================
// chem-crystal — 3-D crystal unit-cell preview plugin
//
// Loads real crystal cells from CIF / VASP POSCAR / XYZ (or one of the built-in
// samples) and renders them as an interactive 3-D unit cell with true lattice
// vectors, CPK atoms, min-image inferred bonds, empirical formula / Z /
// density estimate. Pure parsing lives in `parse.ts` + the chem core; the
// three/dom rendering lives in `crystal3d.ts` (loaded lazily).
// ==========================================================================

import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
} from '@/types/plugin';
import { emit } from '@/core/events';
import type { Group as ThreeGroup } from 'three';
import type { CrystalCell } from '@/chem/structure';
import { actionButton, actionFired, exportSnapshotPng, exportCanvasPng } from '../shared/enhance';
import { CRYSTAL_SAMPLES, findSample } from './samples';
import { parseStructure, type StructuralFormat } from './parse';
import {
  buildCrystalGroup,
  fitCrystalCamera,
  type Representation,
} from './crystal3d';

export { chemCrystalManifest } from './manifest';
import { chemCrystalManifest } from './manifest';

interface State {
  /** Where the current cell came from. */
  source: 'sample' | 'file';
  sampleId: string;
  representation: Representation;
  showBonds: boolean;
  showCell: boolean;
  /** Loaded file cell + provenance (undefined while showing a sample). */
  file?: { cell: CrystalCell; name: string; format: StructuralFormat };
}

export class ChemCrystalPlugin implements Plugin {
  readonly manifest = chemCrystalManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private crystalGroup: ThreeGroup | null = null;
  private threeKey = '';
  private sceneHandle: Scene3DHandle | null = null;
  private state: State = {
    source: 'sample',
    sampleId: 'nacl',
    representation: 'ball-stick',
    showBonds: true,
    showCell: true,
  };
  private zh = false;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.clear3d();
    this.three?.setVisible(false);
    this.ctx = null;
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.draw();
  }

  async deactivate() {
    this.clear3d();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.draw();
  }

  /** Host entry for 3-D-capable plugins. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Current crystal cell (sample or loaded file). */
  private currentCell(): CrystalCell | null {
    if (this.state.source === 'file' && this.state.file) return this.state.file.cell;
    const s = findSample(this.state.sampleId);
    return s ? s.cell : null;
  }

  private currentCellLabel(): string | null {
    if (this.state.source === 'file' && this.state.file) {
      return this.zh ? `已加载：${this.state.file.name}` : `Loaded: ${this.state.file.name}`;
    }
    const s = findSample(this.state.sampleId);
    return s ? (this.zh ? `${s.nameZh}（示例）` : `${s.nameEn} (sample)`) : null;
  }

  async loadData(file: File) {
    const lower = file.name.toLowerCase();
    if (!/\.(cif|poscar|vasp|xyz)$/.test(lower)) {
      this.api.notify('warning', this.zh ? '仅支持 CIF / POSCAR / XYZ 结构文件。' : 'Only CIF / POSCAR / XYZ structure files are supported.');
      return;
    }
    try {
      const text = await this.api.readText(file);
      const loaded = parseStructure(text, file.name);
      this.state.source = 'file';
      this.state.file = { cell: loaded.cell, name: file.name, format: loaded.format };
      this.api.notify('info', `[${loaded.format.toUpperCase()}] ${file.name}: ${loaded.cell.sites.length} atoms`);
    } catch (err) {
      this.api.notify('error', this.zh ? '无法解析结构文件。' : 'Failed to parse structure file.');
      this.api.log('error', `[chem-crystal] loadData: ${String(err)}`);
    }
    this.draw();
    this.refreshParams();
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    return [
      {
        key: 'sample',
        label: 'Crystal',
        labelI18n: { 'zh-CN': '选择晶胞', 'en-US': 'Crystal' },
        type: 'select',
        options: CRYSTAL_SAMPLES.map((s) => ({
          value: s.id,
          label: zh ? `${s.nameZh}（示例）` : `${s.nameEn} (sample)`,
        })),
        value: this.state.source === 'sample' ? this.state.sampleId : this.state.sampleId,
      },
      {
        key: 'representation',
        label: 'Representation',
        labelI18n: { 'zh-CN': '显示方式', 'en-US': 'Representation' },
        type: 'select',
        options: [
          { value: 'ball-stick', label: zh ? '球棍模型' : 'Ball & stick' },
          { value: 'spacefill', label: zh ? '空间填充' : 'Space-filling' },
        ],
        value: this.state.representation,
      },
      {
        key: 'showBonds',
        label: 'Chemical bonds',
        labelI18n: { 'zh-CN': '显示化学键', 'en-US': 'Chemical bonds' },
        type: 'checkbox',
        value: this.state.showBonds,
      },
      {
        key: 'showCell',
        label: 'Unit-cell box',
        labelI18n: { 'zh-CN': '显示晶胞边框', 'en-US': 'Unit-cell box' },
        type: 'checkbox',
        value: this.state.showCell,
      },
      actionButton('reset', 'Fit view', '复位视角'),
      actionButton('exportPng', 'Snapshot PNG', '导出 PNG'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let redraw = false;
    if (typeof params.sample === 'string') {
      const s = findSample(params.sample);
      if (s) {
        this.state.source = 'sample';
        this.state.sampleId = s.id;
        redraw = true;
      }
    }
    if (params.representation === 'ball-stick' || params.representation === 'spacefill') {
      if (params.representation !== this.state.representation) {
        this.state.representation = params.representation;
        redraw = true;
      }
    }
    if (params.showBonds === true || params.showBonds === false) {
      if (params.showBonds !== this.state.showBonds) {
        this.state.showBonds = params.showBonds;
        redraw = true;
      }
    }
    if (params.showCell === true || params.showCell === false) {
      if (params.showCell !== this.state.showCell) {
        this.state.showCell = params.showCell;
        redraw = true;
      }
    }
    if (actionFired(params, 'reset')) this.resetView();
    if (actionFired(params, 'exportPng')) this.exportPng();
    if (redraw) this.draw();
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  private resetView() {
    const three = this.three;
    const cell = this.currentCell();
    if (three && cell) fitCrystalCamera(three.camera, three.controls, cell);
    three?.render();
  }

  private exportPng() {
    if (this.three) exportSnapshotPng(this.api, this.three.snapshot(), 'chem-crystal');
    else exportCanvasPng(this.api, this.ctx?.canvas2d, 'chem-crystal');
  }

  // ---- rendering ----------------------------------------------------------

  private draw() {
    if (this.three) {
      this.draw3d();
      return;
    }
    this.draw2dLabel();
  }

  private draw3d() {
    const three = this.three;
    if (!three) return;
    const cell = this.currentCell();
    if (!cell) {
      three.setVisible(false);
      return;
    }
    const key = [cell.name, this.state.representation, this.state.showBonds, this.state.showCell].join('|');
    if (this.threeKey !== key || this.sceneHandle !== three) {
      this.clear3d();
      this.crystalGroup = buildCrystalGroup(cell, {
        representation: this.state.representation,
        showBonds: this.state.showBonds,
        showCell: this.state.showCell,
      });
      three.scene.add(this.crystalGroup);
      fitCrystalCamera(three.camera, three.controls, cell);
      this.threeKey = key;
      this.sceneHandle = three;
    }
    three.setVisible(true);
    three.render();
  }

  /** No WebGL container — paint a plain informational card on canvas2d. */
  private draw2dLabel() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    canvas.width = Math.min(canvas.width || 480, 480);
    canvas.height = canvas.height || 300;
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.textAlign = 'center';
    g.font = `14px ${this.zh ? '"Microsoft YaHei"' : 'Consolas'}, monospace`;
    const label = this.currentCellLabel();
    g.fillText(
      this.zh ? `3D 容器不可用。${label ?? '请加载 CIF / POSCAR / XYZ 文件'}` : `3D unavailable.${label ?? ' Load a CIF / POSCAR / XYZ file'}`,
      canvas.width / 2,
      canvas.height / 2,
    );
  }

  private clear3d() {
    const three = this.sceneHandle ?? this.three;
    const disposeGroup = (g: ThreeGroup | null) => {
      if (!g) return;
      three?.scene.remove(g);
      for (const geo of (g.userData.sharedGeometries ?? []) as ThreeGeometryLike[]) geo.dispose?.();
      g.traverse((obj) => {
        const mesh = obj as { geometry?: ThreeGeometryLike; material?: unknown };
        if (mesh.geometry) mesh.geometry.dispose?.();
        if (mesh.material) (mesh.material as { dispose?: () => void }).dispose?.();
      });
    };
    disposeGroup(this.crystalGroup);
    this.crystalGroup = null;
    this.threeKey = '';
    this.sceneHandle = null;
  }
}

interface ThreeGeometryLike {
  dispose?: () => void;
}

export default function createChemCrystalPlugin(): Plugin {
  return new ChemCrystalPlugin();
}