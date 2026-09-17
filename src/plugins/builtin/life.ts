// ==========================================================================
// Fun plugin: Conway's Game of Life (生命游戏)
//
// Classic cellular automaton on a canvas grid. Pure Canvas 2D, no data.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';
import { actionButton, exportCanvasPng } from './shared/enhance';

/** Host button presses arrive as `{ [action]: true }`; accept the legacy
 *  `{ action }` payload shape too. */
function buttonPressed(params: Record<string, unknown>, key: string): boolean {
  const v = params[key];
  return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
}

type Pattern = 'random' | 'glider' | 'blinker' | 'beacon';

const PATTERNS: Pattern[] = ['random', 'glider', 'blinker', 'beacon'];

function isPattern(v: unknown): v is Pattern {
  return typeof v === 'string' && (PATTERNS as string[]).includes(v);
}

// Fixed patterns as [x, y] cells, placed a small inset from the top-left
// corner. The grid wraps toroidally, so they evolve normally.
const GLIDER_CELLS: Array<[number, number]> = [
  [2, 1], [3, 2], [1, 3], [2, 3], [3, 3],
];
const BLINKER_CELLS: Array<[number, number]> = [
  [1, 1], [2, 1], [3, 1],
];
const BEACON_CELLS: Array<[number, number]> = [
  [1, 1], [2, 1], [1, 2], [2, 2],
  [3, 3], [4, 3], [3, 4], [4, 4],
];

export const lifeManifest: PluginManifest = {
  id: 'fun.life',
  name: "Conway's Game of Life",
  nameI18n: { 'zh-CN': '生命游戏', 'en-US': "Conway's Game of Life" },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Cellular automaton playground with play / pause / reseed.',
  descriptionI18n: {
    'zh-CN': '经典细胞自动机，支持播放/暂停/重新播种。',
    'en-US': 'Classic cellular automaton with play / pause / reseed.',
  },
  license: 'MIT',
  entry: 'fun.life',
  category: 'fun',
  icon: '▩',
};

interface State {
  speed: number;
  cellSize: number;
  color: string;
  playing: boolean;
  pattern: Pattern;
  cols: number;
  rows: number;
}

export class LifePlugin implements Plugin {
  readonly manifest = lifeManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private grid: Uint8Array = new Uint8Array(0);
  private state: State = {
    speed: 120,
    cellSize: 8,
    color: '#22d3ee',
    playing: true,
    pattern: 'random',
    cols: 0,
    rows: 0,
  };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stopTimer();
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.seed();
    this.draw();
    if (this.state.playing) this.startTimer();
  }

  async deactivate() {
    this.stopTimer();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (this.grid.length === 0) this.seed();
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (buttonPressed(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d, 'life');
      return;
    }
    // Pattern select: clear the grid and sow the chosen pattern. A running
    // play interval is deliberately left untouched.
    if (isPattern(params.pattern)) {
      this.state.pattern = params.pattern;
      this.seed();
      this.draw();
      return;
    }
    let needReseed = false;
    if (typeof params.speed === 'number') {
      const next = Math.max(20, Math.min(500, params.speed));
      if (next !== this.state.speed) {
        this.state.speed = next;
        // The running interval keeps its old delay; restart it so the new
        // speed takes effect immediately (startTimer stops the old one).
        if (this.state.playing) this.startTimer();
      }
    }
    if (typeof params.cellSize === 'number') { this.state.cellSize = Math.max(3, Math.min(20, Math.round(params.cellSize))); needReseed = true; }
    if (typeof params.color === 'string') { this.state.color = params.color; }
    if (typeof params.playing === 'boolean' && params.playing !== this.state.playing) {
      this.state.playing = params.playing;
      if (params.playing) this.startTimer();
      else this.stopTimer();
    }
    // The "Randomize" button is equivalent to selecting the random pattern.
    if (buttonPressed(params, 'reseed')) {
      this.state.pattern = 'random';
      this.seed();
      this.draw();
      return;
    }
    if (needReseed) {
      this.seed();
      this.draw();
    } else {
      this.draw();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'speed', label: 'Speed (ms)', labelI18n: { 'zh-CN': '速度 (ms)', 'en-US': 'Speed (ms)' }, type: 'range', min: 20, max: 500, step: 10, value: this.state.speed },
      { key: 'cellSize', label: 'Cell size', labelI18n: { 'zh-CN': '细胞大小', 'en-US': 'Cell size' }, type: 'range', min: 3, max: 20, step: 1, value: this.state.cellSize },
      { key: 'color', label: 'Color', labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' }, type: 'select', options: [
        { value: '#22d3ee', label: 'Cyan' },
        { value: '#34d399', label: 'Emerald' },
        { value: '#a78bfa', label: 'Violet' },
        { value: '#f472b6', label: 'Pink' },
        { value: '#fbbf24', label: 'Amber' },
      ], value: this.state.color },
      { key: 'playing', label: 'Play', labelI18n: { 'zh-CN': '播放', 'en-US': 'Play' }, type: 'toggle', offLabel: 'Play', onLabel: 'Playing', offLabelI18n: { 'zh-CN': '播放', 'en-US': 'Play' }, onLabelI18n: { 'zh-CN': '播放中', 'en-US': 'Playing' }, value: this.state.playing },
      {
        key: 'pattern',
        label: 'Pattern',
        labelI18n: { 'zh-CN': '图案', 'en-US': 'Pattern' },
        type: 'select',
        options: [
          { value: 'random', label: 'Random', labelI18n: { 'zh-CN': '随机', 'en-US': 'Random' } },
          { value: 'glider', label: 'Glider', labelI18n: { 'zh-CN': '滑翔机', 'en-US': 'Glider' } },
          { value: 'blinker', label: 'Blinker', labelI18n: { 'zh-CN': '闪烁者', 'en-US': 'Blinker' } },
          { value: 'beacon', label: 'Beacon', labelI18n: { 'zh-CN': '信号灯', 'en-US': 'Beacon' } },
        ],
        value: this.state.pattern,
      },
      { key: 'reseed', label: 'Randomize', labelI18n: { 'zh-CN': '重新播种', 'en-US': 'Randomize' }, type: 'button', variant: 'primary', action: 'reseed' },
      actionButton('exportPng', 'Export PNG', '导出 PNG'),
    ];
  }

  /** (Re)build the grid and sow the currently selected pattern. */
  private seed() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.clientWidth || 480;
    const h = canvas.clientHeight || 360;
    const cs = this.state.cellSize;
    const cols = Math.max(8, Math.floor(w / cs));
    const rows = Math.max(8, Math.floor(h / cs));
    this.state.cols = cols;
    this.state.rows = rows;
    const grid = new Uint8Array(cols * rows);
    const put = (cells: Array<[number, number]>) => {
      for (const [x, y] of cells) {
        if (x >= 0 && x < cols && y >= 0 && y < rows) grid[y * cols + x] = 1;
      }
    };
    switch (this.state.pattern) {
      case 'glider':
        // Classic 5-cell glider in the top-left.
        put(GLIDER_CELLS);
        break;
      case 'blinker':
        // Horizontal 3-cell row.
        put(BLINKER_CELLS);
        break;
      case 'beacon':
        // Two 2x2 blocks on a diagonal.
        put(BEACON_CELLS);
        break;
      case 'random':
      default:
        for (let i = 0; i < grid.length; i += 1) grid[i] = Math.random() < 0.28 ? 1 : 0;
        break;
    }
    this.grid = grid;
  }

  private step() {
    const { cols, rows } = this.state;
    const next = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x + dx + cols) % cols;
            const ny = (y + dy + rows) % rows;
            n += this.grid[ny * cols + nx]!;
          }
        }
        const alive = this.grid[y * cols + x]!;
        next[y * cols + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
      }
    }
    this.grid = next;
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, w, h);

    const cs = this.state.cellSize;
    const cols = this.state.cols || Math.floor(w / cs);
    const rows = this.state.rows || Math.floor(h / cs);
    g.fillStyle = this.state.color;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (this.grid[y * cols + x]) {
          g.fillRect(x * cs + 1, y * cs + 1, cs - 1, cs - 1);
        }
      }
    }
  }

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      this.step();
      this.draw();
    }, this.state.speed);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export default function createLifePlugin(): Plugin {
  return new LifePlugin();
}
