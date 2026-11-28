// ==========================================================================
// Ergalics Studio — 湿实验装置模型（液体转移与守恒）
//
// 装置只保存「装了哪些溶液、各多少体积」，不保存显示状态；渲染由插件负责，
// 数据层与画布互不依赖。
//
// 三条约束在 transfer() 内强制，而不是靠调用方自觉：
//   ▸ 倒出体积不超过源内体积；
//   ▸ 目标不得超容量（超了拒绝并返回警告，不静默溢出）；
//   ▸ 转移前后两边溶质的物质的量之和必须相等。
// ==========================================================================

export type ApparatusKind = 'beaker' | 'flask' | 'cylinder' | 'burette' | 'pipette';

export interface Portion {
  solutionId: string;
  /** 体积，mL。 */
  volumeMl: number;
  /** 溶质浓度，mol/L。 */
  concentration: number;
}

export interface Apparatus {
  id: string;
  kind: ApparatusKind;
  capacityMl: number;
  portions: Portion[];
}

export interface LabWarning {
  code: 'acid-into-water' | 'over-capacity' | 'empty-source';
  message: string;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function volumeOf(a: Apparatus): number {
  return round(a.portions.reduce((s, p) => s + p.volumeMl, 0));
}

/** 某溶液在装置中的物质的量（mmol），守恒校验用。 */
export function molesOf(a: Apparatus, solutionId: string): number {
  return round(
    a.portions
      .filter((p) => p.solutionId === solutionId)
      .reduce((s, p) => s + p.volumeMl * p.concentration, 0),
  );
}

export function totalMoles(a: Apparatus): number {
  return round(a.portions.reduce((s, p) => s + p.volumeMl * p.concentration, 0));
}

export function createApparatus(id: string, kind: ApparatusKind, capacityMl: number): Apparatus {
  if (!(capacityMl > 0)) throw new Error(`容量必须为正: ${capacityMl}`);
  return { id, kind, capacityMl, portions: [] };
}

/** 遇水剧烈放热、需要缓慢加入的强酸。 */
const STRONG_ACIDS = new Set(['H2SO4', 'HNO3', 'HClO4']);

export interface TransferResult {
  next: { from: Apparatus; to: Apparatus };
  warnings: LabWarning[];
}

/**
 * 把 volumeMl 从 from 倒入 to。
 */
export function transfer(
  from: Apparatus,
  to: Apparatus,
  volumeMl: number,
  solutionId?: string,
): TransferResult {
  const warnings: LabWarning[] = [];
  if (!(volumeMl > 0)) throw new Error(`转移体积必须为正: ${volumeMl}`);
  if (volumeOf(from) <= 0) {
    return { next: { from, to }, warnings: [{ code: 'empty-source', message: `${from.id} 是空的` }] };
  }

  const moved: Portion[] = [];
  const newFrom: Portion[] = [];
  let remaining = volumeMl;
  for (const p of from.portions) {
    if (remaining <= 0 || (solutionId && p.solutionId !== solutionId)) {
      newFrom.push(p);
      continue;
    }
    const v = round(Math.min(p.volumeMl, remaining));
    remaining = round(remaining - v);
    if (v < p.volumeMl) newFrom.push({ ...p, volumeMl: round(p.volumeMl - v) });
    moved.push({ ...p, volumeMl: v });
  }

  const movedVolume = round(moved.reduce((s, p) => s + p.volumeMl, 0));
  if (movedVolume <= 0) {
    return {
      next: { from, to },
      warnings: [{ code: 'empty-source', message: `没有可转移的 ${solutionId ?? '溶液'}` }],
    };
  }

  const targetVolume = round(volumeOf(to) + movedVolume);
  if (targetVolume > to.capacityMl) {
    return {
      next: { from, to },
      warnings: [{
        code: 'over-capacity',
        message: `${to.id} 容量 ${to.capacityMl} mL，装不下 ${targetVolume} mL`,
      }],
    };
  }

  // 浓酸入水需缓慢搅拌；反向（水入浓酸）会局部沸腾飞溅。
  const addingAcid = moved.some((p) => STRONG_ACIDS.has(p.solutionId));
  const targetIsWater = to.portions.length > 0 && to.portions.every((p) => p.solutionId === 'H2O');
  if (addingAcid && targetIsWater) {
    warnings.push({
      code: 'acid-into-water',
      message: '把浓酸加入水中需缓慢搅拌；反向（水入浓酸）会局部沸腾飞溅',
    });
  }

  // 守恒自检：破了说明合并逻辑写错，宁可抛错也不静默。
  const before = round(totalMoles(from) + totalMoles(to));
  const nextFrom = { ...from, portions: newFrom.filter((p) => p.volumeMl > 0) };
  const nextTo = { ...to, portions: [...to.portions, ...moved] };
  const after = round(totalMoles(nextFrom) + totalMoles(nextTo));
  if (before !== after) {
    throw new Error(`转移破坏了溶质守恒: ${before} -> ${after}`);
  }

  return { next: { from: nextFrom, to: nextTo }, warnings };
}

/**
 * 混匀：同一种溶液按体积合并，浓度按体积加权平均。
 * 不同溶质必须各自保留——并成一个 mixture 会丢掉离子身份，反应判定随之失效。
 */
export function mix(a: Apparatus): Apparatus {
  if (a.portions.length <= 1) return a;
  const byId = new Map<string, Portion>();
  for (const p of a.portions) {
    const prev = byId.get(p.solutionId);
    if (!prev) {
      byId.set(p.solutionId, { ...p });
      continue;
    }
    const v = round(prev.volumeMl + p.volumeMl);
    const moles = prev.volumeMl * prev.concentration + p.volumeMl * p.concentration;
    byId.set(p.solutionId, {
      solutionId: p.solutionId,
      volumeMl: v,
      concentration: v > 0 ? round(moles / v) : 0,
    });
  }
  return { ...a, portions: [...byId.values()] };
}
