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
  cols: number;
  rows: number;
}

export class LifePlugin implements Plugin {
  readonly manifest = lifeManifest;
  private ctx: ContainerCapabilities | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private grid: Uint8Array = new Uint8Array(0);
  private state: State = {
    speed: 120,
    cellSize: 8,
    color: '#22d3ee',
    playing: true,
    cols: 0,
    rows: 0,
  };

  async init(_api: PluginApi) {
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
    let needReseed = false;
    if (typeof params.speed === 'number') { this.state.speed = Math.max(20, Math.min(500, params.speed)); }
    if (typeof params.cellSize === 'number') { this.state.cellSize = Math.max(3, Math.min(20, Math.round(params.cellSize))); needReseed = true; }
    if (typeof params.color === 'string') { this.state.color = params.color; }
    if (typeof params.playing === 'boolean' && params.playing !== this.state.playing) {
      this.state.playing = params.playing;
      if (params.playing) this.startTimer();
      else this.stopTimer();
    }
    // The "Randomize" button emits `{ action: 'reseed' }` under its key.
    const reseed = params.reseed as { action?: string } | undefined;
    if (reseed?.action === 'reseed') {
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
      { key: 'reseed', label: 'Randomize', labelI18n: { 'zh-CN': '重新播种', 'en-US': 'Randomize' }, type: 'button', variant: 'primary', action: 'reseed' },
    ];
  }

  /** Handle the "Randomize" button action broadcast from the host. */
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
    for (let i = 0; i < grid.length; i += 1) grid[i] = Math.random() < 0.28 ? 1 : 0;
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
