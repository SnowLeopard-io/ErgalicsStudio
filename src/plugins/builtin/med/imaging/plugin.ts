// ==========================================================================
// med-imaging — Medical Image Viewer (2-D slices + Three.js reconstruction)
//
// View 1  Slice browsing — grayscale rendering of the current slice through
//         the active window/level (presets: lung / bone / soft tissue / brain
//         or the values stored in the file), with slice slider, displayed HU
//         window range, slice counter and the ROI rectangle overlay.
// View 2  3-D reconstruction — the slice stack is shaped into a voxel field
//         and passed to the host marching-tets isosurface (see core/mesh3d)
//         at an adjustable HU threshold; OrbitControls come with the host
//         Scene3DHandle.
// View 3  Processing view — histogram equalization (contrast) and/or Sobel
//         edge magnitude of the current slice, ROI overlay kept on.
//
// DICOM parsing, windowing, statistics and image processing are pure
// functions in `imaging.ts`; this class only wires state, params, the host
// canvas and the host Three.js scene. Teaching-level scope: uncompressed
// transfer syntaxes only, simulated phantom data, no clinical use.
// ==========================================================================

import * as THREE from 'three';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginRenderContext,
  Scene3DHandle,
} from '@/types/plugin';
import { emit } from '@/core/events';
import { marchingTets } from '@/core/mesh3d';
import { scalarRampColors } from '@/core/pointcloud-gpu';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  drawEmptyMessage,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { medImagingManifest } from './manifest';
import {
  WINDOW_PRESETS,
  buildVolume,
  equalizeSlice,
  parseDicomStack,
  roiStats,
  sliceToHu,
  sobelMagnitude,
  sortSlicePairs,
  statsOf,
  windowBounds,
  windowLevel,
  type DicomParseReason,
  type DicomSlice,
  type ImagingVolume,
  type RoiStats,
  type StatsSummary,
} from './imaging';

type ViewMode = 'slice' | 'volume3d' | 'process';

const VIEWS: ViewMode[] = ['slice', 'volume3d', 'process'];

const PARSE_REASON_TEXT: Record<DicomParseReason, { en: string; zh: string }> = {
  'no-dicom-marker': {
    en: 'not a DICOM Part-10 file (DICM marker not found)',
    zh: '不是 DICOM Part 10 文件（未找到 DICM 标记）',
  },
  'unsupported-transfer-syntax': {
    en: 'compressed transfer syntax is not supported by this teaching-level parser',
    zh: '压缩传输语法不受本教学级解析器支持',
  },
  'unsupported-pixel-format': {
    en: 'pixel format not supported (only 8/16-bit grayscale)',
    zh: '像素格式不受支持（仅 8/16 位灰度）',
  },
  'invalid-dimensions': {
    en: 'invalid image dimensions or samples per pixel',
    zh: '图像尺寸或采样数不合法',
  },
  'no-pixel-data': {
    en: 'no pixel data element (7FE0,0010) found',
    zh: '未找到像素数据元素（7FE0,0010）',
  },
  'truncated-pixel-data': {
    en: 'pixel data is shorter than rows x columns require',
    zh: '像素数据长度小于行列所需',
  },
};

interface SlicePair {
  meta: DicomSlice;
  hu: Float32Array;
}

interface ImagingModel {
  rows: number;
  columns: number;
  pairs: SlicePair[];
  volume: ImagingVolume;
  stats: StatsSummary;
  /** WindowCenter/Width stored in the first loaded file, when present. */
  fileWindow: { center: number; width: number } | null;
  sliceThickness: number | null;
  pixelSpacing: [number, number] | null;
  fileNames: string[];
}

interface State {
  view: ViewMode;
  sliceIndex: number;
  /** 'file' keeps the file-stored window; otherwise a WINDOW_PRESETS key. */
  windowPreset: string;
  windowCenter: number;
  windowWidth: number;
  thresholdHu: number;
  equalize: boolean;
  sobel: boolean;
  roiX: number;
  roiY: number;
  roiW: number;
  roiH: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export class MedImagingPlugin implements Plugin {
  readonly manifest = medImagingManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private zh = false;
  private offLocale: (() => void) | null = null;

  private model: ImagingModel | null = null;
  private mesh: THREE.Mesh | null = null;
  private meshThreshold = NaN;
  private cameraFitted = false;
  private tile: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } | null = null;

  private state: State = {
    view: 'slice',
    sliceIndex: 0,
    windowPreset: 'soft',
    windowCenter: WINDOW_PRESETS.soft!.center,
    windowWidth: WINDOW_PRESETS.soft!.width,
    thresholdHu: 200,
    equalize: false,
    sobel: false,
    roiX: 34,
    roiY: 34,
    roiW: 28,
    roiH: 28,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    this.offLocale = api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publish();
      this.draw();
    });
  }

  async destroy() {
    if (this.offLocale) {
      this.offLocale();
      this.offLocale = null;
    }
    clearScienceOutputs(this.manifest.id);
    this.clearMesh();
    this.three?.setVisible(false);
    this.three = null;
    this.model = null;
    this.tile = null;
    this.ctx = null;
  }

  async activate(context: PluginRenderContext) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
  }

  async deactivate() {
    this.clearMesh();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    // The host mounts `three` only for plugins declaring renderToScene.
    if (container.three) this.three = container.three;
    this.cameraFitted = false;
    this.draw();
  }

  /** Explicit entry point used by the host's scene API. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.cameraFitted = false;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameters ---------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const n = this.model?.pairs.length ?? 0;
    const cols = this.model?.columns ?? 96;
    const rows = this.model?.rows ?? 96;
    const sliceLike = { key: 'view', in: ['slice', 'process'] as const };
    return [
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'slice', label: 'Slice browsing', labelI18n: { 'zh-CN': '切片浏览', 'en-US': 'Slice browsing' } },
          { value: 'volume3d', label: '3-D reconstruction', labelI18n: { 'zh-CN': '三维重建', 'en-US': '3-D reconstruction' } },
          { value: 'process', label: 'Processing view', labelI18n: { 'zh-CN': '处理视图', 'en-US': 'Processing view' } },
        ],
        value: s.view,
      },
      {
        key: 'sliceIndex',
        label: 'Slice',
        labelI18n: { 'zh-CN': '切片序号', 'en-US': 'Slice' },
        type: 'range',
        min: 0,
        max: Math.max(n - 1, 0),
        step: 1,
        value: s.sliceIndex,
        visibleWhen: sliceLike,
      },
      {
        key: 'windowPreset',
        label: 'Window preset',
        labelI18n: { 'zh-CN': '窗宽窗位预设', 'en-US': 'Window preset' },
        type: 'select',
        options: [
          { value: 'file', label: 'From file', labelI18n: { 'zh-CN': '文件窗值', 'en-US': 'From file' } },
          { value: 'soft', label: 'Soft tissue 40/400', labelI18n: { 'zh-CN': '软组织 40/400', 'en-US': 'Soft tissue 40/400' } },
          { value: 'lung', label: 'Lung -600/1500', labelI18n: { 'zh-CN': '肺 -600/1500', 'en-US': 'Lung -600/1500' } },
          { value: 'bone', label: 'Bone 300/1500', labelI18n: { 'zh-CN': '骨 300/1500', 'en-US': 'Bone 300/1500' } },
          { value: 'brain', label: 'Brain 40/80', labelI18n: { 'zh-CN': '脑 40/80', 'en-US': 'Brain 40/80' } },
        ],
        value: s.windowPreset,
        visibleWhen: sliceLike,
      },
      {
        key: 'windowCenter',
        label: 'Window center (HU)',
        labelI18n: { 'zh-CN': '窗位（HU）', 'en-US': 'Window center (HU)' },
        type: 'range',
        min: -1000,
        max: 2000,
        step: 5,
        value: s.windowCenter,
        visibleWhen: sliceLike,
      },
      {
        key: 'windowWidth',
        label: 'Window width (HU)',
        labelI18n: { 'zh-CN': '窗宽（HU）', 'en-US': 'Window width (HU)' },
        type: 'range',
        min: 1,
        max: 4000,
        step: 5,
        value: s.windowWidth,
        visibleWhen: sliceLike,
      },
      {
        key: 'thresholdHu',
        label: 'Isosurface threshold (HU)',
        labelI18n: { 'zh-CN': '等值面阈值（HU）', 'en-US': 'Isosurface threshold (HU)' },
        type: 'range',
        min: -1000,
        max: 2000,
        step: 10,
        value: s.thresholdHu,
        visibleWhen: { key: 'view', in: ['volume3d'] },
      },
      {
        key: 'equalize',
        label: 'Histogram equalization',
        labelI18n: { 'zh-CN': '直方图均衡增强', 'en-US': 'Histogram equalization' },
        type: 'checkbox',
        value: s.equalize,
        visibleWhen: { key: 'view', in: ['process'] },
      },
      {
        key: 'sobel',
        label: 'Sobel edge detection',
        labelI18n: { 'zh-CN': 'Sobel 边缘检测', 'en-US': 'Sobel edge detection' },
        type: 'checkbox',
        value: s.sobel,
        visibleWhen: { key: 'view', in: ['process'] },
      },
      {
        key: 'roiX',
        label: 'ROI x (px)',
        labelI18n: { 'zh-CN': 'ROI x（像素）', 'en-US': 'ROI x (px)' },
        type: 'number',
        min: 0,
        max: Math.max(cols - 1, 0),
        step: 1,
        value: s.roiX,
        visibleWhen: sliceLike,
      },
      {
        key: 'roiY',
        label: 'ROI y (px)',
        labelI18n: { 'zh-CN': 'ROI y（像素）', 'en-US': 'ROI y (px)' },
        type: 'number',
        min: 0,
        max: Math.max(rows - 1, 0),
        step: 1,
        value: s.roiY,
        visibleWhen: sliceLike,
      },
      {
        key: 'roiW',
        label: 'ROI width (px)',
        labelI18n: { 'zh-CN': 'ROI 宽（像素）', 'en-US': 'ROI width (px)' },
        type: 'number',
        min: 1,
        max: cols,
        step: 1,
        value: s.roiW,
        visibleWhen: sliceLike,
      },
      {
        key: 'roiH',
        label: 'ROI height (px)',
        labelI18n: { 'zh-CN': 'ROI 高（像素）', 'en-US': 'ROI height (px)' },
        type: 'number',
        min: 1,
        max: rows,
        step: 1,
        value: s.roiH,
        visibleWhen: sliceLike,
      },
      actionButton('appendSlice', 'Append Slice File', '追加切片文件'),
      actionButton('exportStats', 'Export Statistics CSV', '导出统计 CSV', 'primary'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let changed = false;

    if (typeof params.view === 'string' && (VIEWS as string[]).includes(params.view) && params.view !== s.view) {
      s.view = params.view as ViewMode;
      changed = true;
    }
    if (params.sliceIndex !== undefined) {
      const v = Number(params.sliceIndex);
      if (Number.isFinite(v)) {
        const max = Math.max((this.model?.pairs.length ?? 1) - 1, 0);
        const next = clamp(Math.round(v), 0, max);
        if (next !== s.sliceIndex) {
          s.sliceIndex = next;
          changed = true;
        }
      }
    }
    if (
      typeof params.windowPreset === 'string' &&
      (params.windowPreset === 'file' || params.windowPreset in WINDOW_PRESETS) &&
      params.windowPreset !== s.windowPreset
    ) {
      s.windowPreset = params.windowPreset;
      const w = this.presetWindow(params.windowPreset);
      if (w) {
        s.windowCenter = w.center;
        s.windowWidth = w.width;
      }
      changed = true;
    }
    if (params.windowCenter !== undefined) {
      const v = Number(params.windowCenter);
      if (Number.isFinite(v) && clamp(v, -1000, 2000) !== s.windowCenter) {
        s.windowCenter = clamp(v, -1000, 2000);
        changed = true;
      }
    }
    if (params.windowWidth !== undefined) {
      const v = Number(params.windowWidth);
      if (Number.isFinite(v) && clamp(v, 1, 4000) !== s.windowWidth) {
        s.windowWidth = clamp(v, 1, 4000);
        changed = true;
      }
    }
    if (params.thresholdHu !== undefined) {
      const v = Number(params.thresholdHu);
      if (Number.isFinite(v) && clamp(v, -1000, 2000) !== s.thresholdHu) {
        s.thresholdHu = clamp(v, -1000, 2000);
        changed = true;
      }
    }
    if (typeof params.equalize === 'boolean' && params.equalize !== s.equalize) {
      s.equalize = params.equalize;
      changed = true;
    }
    if (typeof params.sobel === 'boolean' && params.sobel !== s.sobel) {
      s.sobel = params.sobel;
      changed = true;
    }
    const cols = this.model?.columns ?? 96;
    const rows = this.model?.rows ?? 96;
    if (params.roiX !== undefined) {
      const v = Number(params.roiX);
      if (Number.isFinite(v) && clamp(Math.round(v), 0, cols - 1) !== s.roiX) {
        s.roiX = clamp(Math.round(v), 0, cols - 1);
        changed = true;
      }
    }
    if (params.roiY !== undefined) {
      const v = Number(params.roiY);
      if (Number.isFinite(v) && clamp(Math.round(v), 0, rows - 1) !== s.roiY) {
        s.roiY = clamp(Math.round(v), 0, rows - 1);
        changed = true;
      }
    }
    if (params.roiW !== undefined) {
      const v = Number(params.roiW);
      if (Number.isFinite(v) && clamp(Math.round(v), 1, cols) !== s.roiW) {
        s.roiW = clamp(Math.round(v), 1, cols);
        changed = true;
      }
    }
    if (params.roiH !== undefined) {
      const v = Number(params.roiH);
      if (Number.isFinite(v) && clamp(Math.round(v), 1, rows) !== s.roiH) {
        s.roiH = clamp(Math.round(v), 1, rows);
        changed = true;
      }
    }

    if (actionFired(params, 'appendSlice')) {
      void this.appendSlice();
      return;
    }
    if (actionFired(params, 'exportStats')) this.exportStats();
    if (changed) {
      this.publish();
      this.draw();
    }
  }

  // ---- data intake ----------------------------------------------------------

  async loadData(file: File) {
    if (!/\.(dcm|ima)$/i.test(file.name)) {
      notify(
        this.api,
        'warning',
        'Medical Image Viewer loads .dcm / .ima DICOM files (teaching-level uncompressed parse).',
        '医学影像查看器加载 .dcm / .ima DICOM 文件（教学级无压缩解析）。',
      );
      return;
    }
    const buf = await this.api.readBinary(file);
    const parsed = parseDicomStack(buf);
    if (!parsed.ok) this.reportParseFailure(file.name, parsed.reason, parsed.detail);
    const pairs = this.decodeSlices(parsed.ok ? parsed.slices : []);
    if (!pairs) return; // decode failure already notified
    if (!this.applyStack(pairs, file.name)) return;
    const m = this.model!;
    notify(
      this.api,
      'success',
      `Loaded ${m.pairs.length} slice(s), ${m.columns} x ${m.rows}, from ${file.name}.`,
      `已从 ${file.name} 载入 ${m.pairs.length} 个切片（${m.columns} x ${m.rows}）。`,
    );
    this.publish();
    this.refreshParams();
    this.draw();
  }

  /** Decode parsed datasets into HU slices; null after a bilingual notice. */
  private decodeSlices(slices: DicomSlice[]): SlicePair[] | null {
    const pairs: SlicePair[] = [];
    for (const meta of slices) {
      const hu = sliceToHu(meta);
      if (!hu) {
        notify(
          this.api,
          'error',
          'Pixel format not supported by the teaching parser (8/16-bit grayscale only).',
          '像素格式不受教学级解析器支持（仅 8/16 位灰度）。',
        );
        return null;
      }
      pairs.push({ meta, hu });
    }
    return pairs;
  }

  private reportParseFailure(fileName: string, reason: DicomParseReason, detail?: string): void {
    const t = PARSE_REASON_TEXT[reason];
    const suffix = detail ? ` (${detail})` : '';
    notify(this.api, 'error', `${fileName}: ${t.en}${suffix}.`, `${fileName}：${t.zh}${suffix}。`);
  }

  /**
   * Merge a decoded stack into the model (sorts by InstanceNumber /
   * SliceLocation, rebuilds the voxel field). Returns false when dimensions
   * conflict with the already loaded stack (notice already shown).
   */
  private applyStack(pairs: SlicePair[], fileName: string): boolean {
    const sorted = sortSlicePairs(pairs);
    const first = sorted[0]!.meta;
    if (this.model) {
      const m = this.model;
      if (first.rows !== m.rows || first.columns !== m.columns) {
        notify(
          this.api,
          'warning',
          `Slice dimensions ${first.columns} x ${first.rows} do not match the loaded stack (${m.columns} x ${m.rows}).`,
          `切片尺寸 ${first.columns} x ${first.rows} 与已载入堆栈（${m.columns} x ${m.rows}）不一致。`,
        );
        return false;
      }
      m.pairs = sortSlicePairs([...m.pairs, ...sorted]);
      if (!m.fileNames.includes(fileName)) m.fileNames.push(fileName);
    } else {
      this.model = {
        rows: first.rows,
        columns: first.columns,
        pairs: sorted,
        volume: buildVolume(sorted.map((p) => p.hu), first.columns, first.rows),
        stats: { count: 0, min: 0, max: 0, mean: 0, std: 0 },
        fileWindow:
          first.windowCenter !== null && first.windowWidth !== null
            ? { center: first.windowCenter, width: first.windowWidth }
            : null,
        sliceThickness: first.sliceThickness,
        pixelSpacing: first.pixelSpacing,
        fileNames: [fileName],
      };
      this.state.windowPreset = 'file';
      this.state.windowCenter = first.windowCenter ?? WINDOW_PRESETS.soft!.center;
      this.state.windowWidth = first.windowWidth ?? WINDOW_PRESETS.soft!.width;
      this.state.sliceIndex = 0;
      this.state.roiX = Math.round(first.columns * 0.35);
      this.state.roiY = Math.round(first.rows * 0.35);
      this.state.roiW = Math.round(first.columns * 0.3);
      this.state.roiH = Math.round(first.rows * 0.3);
      this.state.thresholdHu = clamp(Math.round(first.windowCenter ?? 200), -1000, 2000);
    }
    const m = this.model;
    m.volume = buildVolume(m.pairs.map((p) => p.hu), m.columns, m.rows);
    m.stats = statsOf(m.volume.values);
    this.state.sliceIndex = clamp(this.state.sliceIndex, 0, m.pairs.length - 1);
    if (this.state.windowPreset === 'file' && m.fileWindow) {
      this.state.windowCenter = m.fileWindow.center;
      this.state.windowWidth = m.fileWindow.width;
    }
    this.api.reportDataScale(m.rows * m.columns * m.pairs.length);
    this.cameraFitted = false;
    this.clearMesh();
    return true;
  }

  /** Append one more .dcm / .ima file (possibly a multi-slice stack). */
  private async appendSlice() {
    const file = await this.api.openFile('.dcm,.ima,application/dicom');
    if (!file) return;
    const buf = await this.api.readBinary(file);
    const parsed = parseDicomStack(buf);
    if (!parsed.ok) {
      this.reportParseFailure(file.name, parsed.reason, parsed.detail);
      return;
    }
    const pairs = this.decodeSlices(parsed.slices);
    if (!pairs) return;
    const before = this.model?.pairs.length ?? 0;
    if (!this.applyStack(pairs, file.name)) return;
    const m = this.model!;
    const added = m.pairs.length - before;
    notify(
      this.api,
      'success',
      `Appended ${added} slice(s) from ${file.name}; stack now has ${m.pairs.length}.`,
      `已从 ${file.name} 追加 ${added} 个切片，堆栈现有 ${m.pairs.length} 个切片。`,
    );
    this.publish();
    this.refreshParams();
    this.draw();
  }

  private presetWindow(key: string): { center: number; width: number } | null {
    if (key === 'file') return this.model?.fileWindow ?? WINDOW_PRESETS.soft! ?? null;
    return WINDOW_PRESETS[key] ?? null;
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  // ---- scientific outputs ---------------------------------------------------

  private currentRoiStats(): RoiStats | null {
    const m = this.model;
    if (!m) return null;
    const k = clamp(this.state.sliceIndex, 0, m.pairs.length - 1);
    return roiStats(m.pairs[k]!.hu, m.columns, m.rows, this.state.roiX, this.state.roiY, this.state.roiW, this.state.roiH);
  }

  private publish() {
    const id = this.manifest.id;
    const m = this.model;
    if (!m) {
      clearScienceOutputs(id);
      return;
    }
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'vol-min',
        label: 'volume min',
        value: fmtMetric(m.stats.min),
        unit: 'HU',
        hint: zh ? '全体素最小 HU 值' : 'smallest HU value across the volume',
      },
      {
        key: 'vol-max',
        label: 'volume max',
        value: fmtMetric(m.stats.max),
        unit: 'HU',
        hint: zh ? '全体素最大 HU 值' : 'largest HU value across the volume',
      },
      {
        key: 'vol-mean',
        label: 'volume mean',
        value: fmtMetric(m.stats.mean),
        unit: 'HU',
        hint: zh ? '全体素 HU 均值' : 'mean HU across all voxels',
      },
      {
        key: 'slices',
        label: 'slices',
        value: String(m.pairs.length),
        hint: zh ? '已载入的切片数' : 'loaded slice count',
      },
      {
        key: 'grid',
        label: 'rows x cols',
        value: `${m.rows} x ${m.columns}`,
        hint: zh ? '每张切片的行列数' : 'rows and columns of each slice',
      },
    ];
    const roi = this.currentRoiStats();
    if (roi) {
      metrics.push(
        {
          key: 'roi-mean',
          label: 'ROI mean',
          value: fmtMetric(roi.mean),
          unit: 'HU',
          severity: 'ok',
          hint: zh
            ? `当前切片 ROI（${roi.w}x${roi.h} @ ${roi.x},${roi.y}，${roi.count} 像素）的 HU 均值`
            : `mean HU of the ROI (${roi.w}x${roi.h} at ${roi.x},${roi.y}, ${roi.count} px) on the current slice`,
        },
        {
          key: 'roi-std',
          label: 'ROI SD',
          value: fmtMetric(roi.std),
          unit: 'HU',
          hint: zh ? 'ROI 内 HU 的总体标准差' : 'population standard deviation of HU inside the ROI',
        },
        {
          key: 'roi-min',
          label: 'ROI min',
          value: fmtMetric(roi.min),
          unit: 'HU',
          hint: zh ? 'ROI 内最小 HU 值' : 'smallest HU value inside the ROI',
        },
        {
          key: 'roi-max',
          label: 'ROI max',
          value: fmtMetric(roi.max),
          unit: 'HU',
          hint: zh ? 'ROI 内最大 HU 值' : 'largest HU value inside the ROI',
        },
      );
    }
    setScienceOutputs(id, metrics);
  }

  // ---- CSV export -----------------------------------------------------------

  private exportStats() {
    const m = this.model;
    if (!m) {
      notify(this.api, 'warning', 'Load a DICOM stack first.', '请先加载 DICOM 切片数据。');
      return;
    }
    const sliceRows = m.pairs.map((p, i) => {
      const s = statsOf(p.hu);
      return [i + 1, p.meta.instanceNumber ?? i + 1, s.min, s.max, s.mean];
    });
    exportRowsCsv(this.api, 'med-imaging-slice-stats', ['slice', 'instance', 'minHU', 'maxHU', 'meanHU'], sliceRows);
    const roi = this.currentRoiStats();
    const k = clamp(this.state.sliceIndex, 0, m.pairs.length - 1);
    if (roi) {
      exportRowsCsv(
        this.api,
        'med-imaging-roi-stats',
        ['slice', 'roiX', 'roiY', 'roiW', 'roiH', 'count', 'meanHU', 'sdHU', 'minHU', 'maxHU'],
        [[k + 1, roi.x, roi.y, roi.w, roi.h, roi.count, roi.mean, roi.std, roi.min, roi.max]],
      );
    } else {
      notify(
        this.api,
        'warning',
        'The ROI is empty; only per-slice statistics were exported.',
        'ROI 为空，仅导出了逐切片统计。',
      );
    }
  }

  // ---- drawing --------------------------------------------------------------

  private uiFont(px: number, bold = false): string {
    return `${bold ? 'bold ' : ''}${px}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

  private draw() {
    const view = this.state.view;
    if (view === 'volume3d' && this.three && this.model) {
      this.three.setVisible(true);
      this.publish();
      this.rebuild3d();
      return;
    }
    this.three?.setVisible(false);
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.model) {
      this.publish();
      drawEmptyCanvas(this.api, canvas, {
        title: 'No DICOM data',
        titleZh: '尚未加载 DICOM 数据',
        hint: 'Load a .dcm / .ima stack via the sample-data bar or Open File.',
        hintZh: '请通过顶部「示例数据」或「打开文件」载入 .dcm / .ima 切片堆栈。',
      });
      return;
    }
    this.publish();
    if (view === 'volume3d') {
      drawEmptyMessage(
        g,
        canvas,
        this.zh ? '三维重建需要 Three.js 场景' : '3-D reconstruction needs the Three.js scene',
        this.zh ? '请切回插件市场重新激活本插件以挂载 3D 场景' : 'Re-activate the plugin to mount the 3-D scene',
      );
      return;
    }
    this.drawSliceView(g, canvas, view === 'process');
  }

  /** Normalized (windowed or processed) 0..1 image for the current slice. */
  private normalizedSlice(process: boolean): Float32Array {
    const m = this.model!;
    const k = clamp(this.state.sliceIndex, 0, m.pairs.length - 1);
    const hu = m.pairs[k]!.hu;
    if (!process) {
      const out = new Float32Array(hu.length);
      for (let i = 0; i < hu.length; i += 1) out[i] = windowLevel(hu[i]!, this.state.windowCenter, this.state.windowWidth);
      return out;
    }
    let base: Float32Array;
    if (this.state.equalize) {
      base = equalizeSlice(hu);
    } else {
      base = new Float32Array(hu.length);
      for (let i = 0; i < hu.length; i += 1) base[i] = windowLevel(hu[i]!, this.state.windowCenter, this.state.windowWidth);
    }
    if (this.state.sobel) {
      const mag = sobelMagnitude(base, m.columns, m.rows);
      let max = 0;
      for (let i = 0; i < mag.length; i += 1) if (mag[i]! > max) max = mag[i]!;
      const out = new Float32Array(mag.length);
      if (max > 0) for (let i = 0; i < mag.length; i += 1) out[i] = mag[i]! / max;
      return out;
    }
    return base;
  }

  private ensureTile(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    if (this.tile && this.tile.w === w && this.tile.h === h) return this.tile;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    this.tile = { canvas, ctx, w, h };
    return this.tile;
  }

  private drawSliceView(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, process: boolean): void {
    const zh = this.zh;
    const m = this.model!;
    const { columns, rows } = m;
    const k = clamp(this.state.sliceIndex, 0, m.pairs.length - 1);
    const norm = this.normalizedSlice(process);

    const padX = 16;
    const padT = 32;
    const padB = 30;
    const scale = Math.max(Math.min((canvas.width - 2 * padX) / columns, (canvas.height - padT - padB) / rows), 0.05);
    const imgW = columns * scale;
    const imgH = rows * scale;
    const ox = (canvas.width - imgW) / 2;
    const oy = padT + (canvas.height - padT - padB - imgH) / 2;

    const tile = this.ensureTile(columns, rows);
    if (tile) {
      const img = tile.ctx.createImageData(columns, rows);
      const px = img.data;
      for (let i = 0; i < norm.length; i += 1) {
        const v = Math.round(clamp(norm[i]!, 0, 1) * 255);
        px[i * 4] = v;
        px[i * 4 + 1] = v;
        px[i * 4 + 2] = v;
        px[i * 4 + 3] = 255;
      }
      tile.ctx.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = scale < 1;
      g.drawImage(tile.canvas, ox, oy, imgW, imgH);
      g.imageSmoothingEnabled = true;
    }

    // ROI rectangle overlay (image-pixel coordinates mapped onto the canvas)
    if (this.state.roiW > 0 && this.state.roiH > 0) {
      const rx = ox + this.state.roiX * scale;
      const ry = oy + this.state.roiY * scale;
      const rw = this.state.roiW * scale;
      const rh = this.state.roiH * scale;
      g.setLineDash([6, 4]);
      g.lineWidth = 1.4;
      g.strokeStyle = 'rgba(120,230,230,0.95)';
      g.strokeRect(rx, ry, rw, rh);
      g.setLineDash([]);
      g.font = this.uiFont(10);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(120,230,230,0.95)';
      const labelY = ry - 5 < padT ? ry + 12 : ry - 5;
      g.fillText(`ROI ${this.state.roiW}x${this.state.roiH}`, rx + 4, labelY);
    }

    // header: slice counter + window readout
    const bounds = windowBounds(this.state.windowCenter, this.state.windowWidth);
    g.font = this.uiFont(12, true);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.fillText(
      process
        ? `${zh ? '处理视图' : 'Processing'} - ${this.state.equalize ? (zh ? '均衡' : 'EQ') : ''}${this.state.equalize && this.state.sobel ? ' + ' : ''}${this.state.sobel ? (zh ? 'Sobel' : 'Sobel') : ''}`
        : `${zh ? '切片' : 'Slice'} ${k + 1} / ${m.pairs.length}`,
      padX,
      20,
    );
    g.font = this.uiFont(11);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(
      `WC ${Math.round(this.state.windowCenter)} / WW ${Math.round(this.state.windowWidth)} · HU [${Math.round(bounds.lo)}, ${Math.round(bounds.hi)}]`,
      canvas.width - padX,
      20,
    );

    // footer: file + geometry metadata
    const spacing = m.pixelSpacing ? `${m.pixelSpacing[0]}x${m.pixelSpacing[1]} mm` : null;
    const thickness = m.sliceThickness ? `${m.sliceThickness} mm` : null;
    const meta = [spacing ? `${zh ? '像素间距' : 'pixel'} ${spacing}` : null, thickness ? `${zh ? '层厚' : 'slice'} ${thickness}` : null]
      .filter(Boolean)
      .join(' · ');
    g.font = this.uiFont(10);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(175,190,210,0.92)';
    g.fillText(
      `${m.fileNames.join(', ')}${meta ? ` · ${meta}` : ''}${process ? ` · ${zh ? '切片' : 'slice'} ${k + 1}/${m.pairs.length}` : ''}`,
      padX,
      canvas.height - 8,
    );
  }

  // ---- 3-D reconstruction -----------------------------------------------------

  private clearMesh() {
    if (!this.mesh) return;
    this.three?.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
    this.meshThreshold = NaN;
  }

  /** Physical z scale: slice thickness over in-plane pixel spacing (mm). */
  private zScale(m: ImagingModel): number {
    if (m.sliceThickness && m.pixelSpacing && m.pixelSpacing[0] > 0) {
      return clamp(m.sliceThickness / m.pixelSpacing[0], 0.2, 10);
    }
    return 1;
  }

  /**
   * Threshold isosurface via the host marching-tets kernel (core/mesh3d) —
   * a simplified face-based marching-cubes variant with crack-free tetrahedra.
   * Vertices are coloured by HU between the threshold and the volume maximum.
   */
  private rebuild3d() {
    const three = this.three;
    const m = this.model;
    if (!three || !m) return;
    if (this.mesh && this.meshThreshold === this.state.thresholdHu) {
      three.render();
      return;
    }
    const hadMesh = this.mesh !== null;
    this.clearMesh();
    const surface = marchingTets(m.volume, this.state.thresholdHu);
    if (surface.positions.length === 0) {
      three.render();
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
    const cMax = Math.max(m.stats.max, this.state.thresholdHu + 1);
    geometry.setAttribute('color', new THREE.BufferAttribute(scalarRampColors(surface.vertexValues, this.state.thresholdHu, cMax), 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const zs = this.zScale(m);
    mesh.scale.set(1, 1, zs);
    mesh.position.set(-(m.columns - 1) / 2, -(m.rows - 1) / 2, -((m.pairs.length - 1) / 2) * zs);
    this.mesh = mesh;
    this.meshThreshold = this.state.thresholdHu;
    three.scene.add(mesh);
    if (!hadMesh || !this.cameraFitted) this.fitCamera(m, zs);
    three.render();
  }

  private fitCamera(m: ImagingModel, zScale: number): void {
    const three = this.three;
    if (!three) return;
    const size = Math.max(m.columns, m.rows, m.pairs.length * zScale);
    const d = size * 1.7;
    three.camera.position.set(d * 0.55, -d * 0.8, d * 0.6);
    three.camera.near = d / 100;
    three.camera.far = d * 20;
    three.camera.updateProjectionMatrix();
    three.controls.target.set(0, 0, 0);
    three.controls.update();
    this.cameraFitted = true;
  }
}

export default function createMedImagingPlugin(): Plugin {
  return new MedImagingPlugin();
}
