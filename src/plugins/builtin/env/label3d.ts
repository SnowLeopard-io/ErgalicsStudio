// ==========================================================================
// Shared 3-D text labels for the environmental 3-D plugins.
//
// A tiny canvas-texture sprite helper so scenes can annotate what the user
// is actually looking at (烟囱 / 抽水井 / 污染羽 …). Labels are cheap Canvas
// textures on THREE.Sprite (always face the camera), and `setText` re-renders
// the texture in place so locale switches don't need a scene rebuild.
// ==========================================================================

import * as THREE from 'three';

export interface Label3D {
  readonly sprite: THREE.Sprite;
  /** Re-render the label texture (e.g. after a locale switch). */
  setText(text: string): void;
  dispose(): void;
}

export interface LabelOpts {
  /** Font size in px on the backing canvas (default 42). */
  font?: number;
  /** Text colour (default near-white). */
  color?: string;
  /** Draw a rounded translucent backing plate (default true). */
  plate?: boolean;
}

const PAD = 18;

function draw(text: string, canvas: HTMLCanvasElement, font: number, color: string, plate: boolean): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const fontSpec = `600 ${font}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  g.font = fontSpec;
  const w = Math.ceil(g.measureText(text).width) + PAD * 2;
  const h = font + PAD * 2;
  canvas.width = w;
  canvas.height = h;
  g.font = fontSpec; // canvas resize resets state
  if (plate) {
    g.fillStyle = 'rgba(10, 14, 19, 0.72)';
    const r = 10;
    g.beginPath();
    g.moveTo(r, 0);
    g.arcTo(w, 0, w, h, r);
    g.arcTo(w, h, 0, h, r);
    g.arcTo(0, h, 0, 0, r);
    g.arcTo(0, 0, w, 0, r);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(150, 168, 190, 0.4)';
    g.lineWidth = 2;
    g.stroke();
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
}

/** Create a camera-facing text label sprite. `scale` is the world height of
 * the label plate; width follows the text aspect. Pure — no scene attached. */
export function makeLabel(text: string, opts: LabelOpts = {}): Label3D {
  const font = opts.font ?? 42;
  const color = opts.color ?? '#e8eef5';
  const plate = opts.plate ?? true;
  const canvas = document.createElement('canvas');
  draw(text, canvas, font, color, plate);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  const height = opts.font ? 0.09 * (font / 42) : 0.09;
  sprite.scale.set(height * aspect, height, 1);
  sprite.renderOrder = 20;

  return {
    sprite,
    setText(next: string) {
      draw(next, canvas, font, color, plate);
      tex.needsUpdate = true;
      sprite.scale.set((canvas.width / canvas.height) * height, height, 1);
    },
    dispose() {
      tex.dispose();
      mat.dispose();
    },
  };
}

/** Bilingual label bookkeeping: keeps (sprite, zh, en) so `refreshLabels()`
 * can re-render every label after a locale switch. */
export class LabelSet {
  private items: Array<{ label: Label3D; zh: string; en: string }> = [];
  readonly group: THREE.Group = new THREE.Group();

  /** Add a label at a world position. Returns the sprite for fine-tuning. */
  add(zh: string, en: string, locale: 'zh-CN' | 'en-US', pos: [number, number, number], opts?: LabelOpts): THREE.Sprite {
    const label = makeLabel(locale === 'zh-CN' ? zh : en, opts);
    label.sprite.position.set(...pos);
    this.items.push({ label, zh, en });
    this.group.add(label.sprite);
    return label.sprite;
  }

  /** Re-render all labels for the given locale (no scene rebuild needed). */
  refresh(locale: 'zh-CN' | 'en-US'): void {
    for (const it of this.items) it.label.setText(locale === 'zh-CN' ? it.zh : it.en);
  }

  dispose(): void {
    for (const it of this.items) it.label.dispose();
    this.items = [];
    this.group.clear();
  }
}
