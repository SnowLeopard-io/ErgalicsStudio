// ==========================================================================
// geo-minerals — mineral-identification kernel (pure TS, DOM-free)
//
// A curated rock-forming / common mineral database, a property-scoring
// identification key, Mohs scratch logic, crystal-system classification from
// unit-cell parameters, and a Michel-Lévy-style interference-colour model for
// thin-section simulation.
// ==========================================================================

export type CrystalSystem =
  | 'cubic'
  | 'hexagonal'
  | 'tetragonal'
  | 'orthorhombic'
  | 'monoclinic'
  | 'triclinic';

export type Luster = 'metallic' | 'vitreous' | 'pearly' | 'silky' | 'earthy' | 'greasy' | 'adamantine' | 'resinous';
export type Relief = 'low' | 'moderate' | 'high' | 'very-high';
export type MineralClass = 'silicate' | 'carbonate' | 'oxide' | 'sulfide' | 'sulfate' | 'halide' | 'native' | 'phosphate';

export interface Mineral {
  id: string;
  name: string;
  nameZh: string;
  formula: string;
  class: MineralClass;
  group: string;
  groupZh: string;
  /** Mohs hardness; a single representative value. */
  hardness: number;
  /** Cleavage description in English / Chinese. */
  cleavage: string;
  cleavageZh: string;
  luster: Luster;
  streak: string;
  streakZh: string;
  /** Specific gravity (g/cm³). */
  sg: number;
  crystalSystem: CrystalSystem;
  /** Maximum birefringence Δn (dimensionless). */
  birefringence: number;
  relief: Relief;
  color: string;
  colorZh: string;
  opticalSign: '+' | '-' | 'none';
  notes: string;
  notesZh: string;
}

export const CRYSTAL_SYSTEMS: readonly CrystalSystem[] = [
  'cubic',
  'hexagonal',
  'tetragonal',
  'orthorhombic',
  'monoclinic',
  'triclinic',
];

export const CRYSTAL_SYSTEM_LABELS: Record<CrystalSystem, { en: string; zh: string }> = {
  cubic: { en: 'Cubic', zh: '等轴（立方）晶系' },
  hexagonal: { en: 'Hexagonal', zh: '六方晶系' },
  tetragonal: { en: 'Tetragonal', zh: '四方晶系' },
  orthorhombic: { en: 'Orthorhombic', zh: '斜方晶系' },
  monoclinic: { en: 'Monoclinic', zh: '单斜晶系' },
  triclinic: { en: 'Triclinic', zh: '三斜晶系' },
};

export const MINERALS: readonly Mineral[] = [
  {
    id: 'quartz', name: 'Quartz', nameZh: '石英', formula: 'SiO₂', class: 'silicate', group: 'framework silicate', groupZh: '架状硅酸盐',
    hardness: 7, cleavage: 'none, conchoidal fracture', cleavageZh: '无解理，贝壳状断口', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 2.65, crystalSystem: 'hexagonal', birefringence: 0.009, relief: 'low', color: 'colourless / white / grey', colorZh: '无色 / 白 / 灰',
    opticalSign: '+', notes: 'Most common crustal mineral; low relief, first-order grey interference.', notesZh: '地壳中最常见的矿物；低突起，一级灰干涉色。',
  },
  {
    id: 'orthoclase', name: 'Orthoclase feldspar', nameZh: '正长石', formula: 'KAlSi₃O₈', class: 'silicate', group: 'framework silicate', groupZh: '架状硅酸盐',
    hardness: 6, cleavage: 'two good at 90°', cleavageZh: '两组完全解理，约 90°', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 2.56, crystalSystem: 'monoclinic', birefringence: 0.007, relief: 'low', color: 'pink / white / cream', colorZh: '粉 / 白 / 米色',
    opticalSign: '-', notes: 'Alkali feldspar; Carlsbad twinning common in thin section.', notesZh: '碱性长石；薄片中常见卡尔斯巴德双晶。',
  },
  {
    id: 'plagioclase', name: 'Plagioclase feldspar', nameZh: '斜长石', formula: '(Na,Ca)Al(Al,Si)Si₂O₈', class: 'silicate', group: 'framework silicate', groupZh: '架状硅酸盐',
    hardness: 6, cleavage: 'two good at ~86°', cleavageZh: '两组完全解理，约 86°', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 2.68, crystalSystem: 'triclinic', birefringence: 0.009, relief: 'low', color: 'white / grey', colorZh: '白 / 灰',
    opticalSign: '+', notes: 'Albite–anorthite series; polysynthetic twinning is diagnostic.', notesZh: '钠长石–钙长石系列；聚片双晶为鉴定特征。',
  },
  {
    id: 'muscovite', name: 'Muscovite mica', nameZh: '白云母', formula: 'KAl₂(AlSi₃O₁₀)(OH)₂', class: 'silicate', group: 'sheet silicate', groupZh: '层状硅酸盐',
    hardness: 2.5, cleavage: 'perfect basal', cleavageZh: '底面完全解理', luster: 'pearly', streak: 'white', streakZh: '白色',
    sg: 2.82, crystalSystem: 'monoclinic', birefringence: 0.036, relief: 'moderate', color: 'colourless / silvery', colorZh: '无色 / 银白',
    opticalSign: '-', notes: 'Colourless mica with high birefringence and bird’s-eye extinction.', notesZh: '无色云母，高双折射率，具鸟眼式消光。',
  },
  {
    id: 'biotite', name: 'Biotite mica', nameZh: '黑云母', formula: 'K(Mg,Fe)₃(AlSi₃O₁₀)(OH)₂', class: 'silicate', group: 'sheet silicate', groupZh: '层状硅酸盐',
    hardness: 2.5, cleavage: 'perfect basal', cleavageZh: '底面完全解理', luster: 'pearly', streak: 'white', streakZh: '白色',
    sg: 3.0, crystalSystem: 'monoclinic', birefringence: 0.045, relief: 'moderate', color: 'black / dark brown', colorZh: '黑 / 深褐',
    opticalSign: '-', notes: 'Dark mica; strongly pleochroic and often altered to chlorite.', notesZh: '暗色云母；多色性强，常蚀变为绿泥石。',
  },
  {
    id: 'hornblende', name: 'Hornblende', nameZh: '普通角闪石', formula: 'Ca₂(Mg,Fe)₅Si₈O₂₂(OH)₂', class: 'silicate', group: 'double-chain silicate', groupZh: '双链硅酸盐',
    hardness: 5.5, cleavage: 'two good at ~56°', cleavageZh: '两组完全解理，约 56°', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 3.2, crystalSystem: 'monoclinic', birefringence: 0.020, relief: 'moderate', color: 'black / dark green', colorZh: '黑 / 暗绿',
    opticalSign: '-', notes: 'Diagnostic 56° cleavage in section; green–brown pleochroism.', notesZh: '薄片中 56° 解理为鉴定特征；绿–褐多色性。',
  },
  {
    id: 'augite', name: 'Augite', nameZh: '普通辉石', formula: '(Ca,Na)(Mg,Fe,Al)(Si,Al)₂O₆', class: 'silicate', group: 'single-chain silicate', groupZh: '单链硅酸盐',
    hardness: 6, cleavage: 'two good at ~87°', cleavageZh: '两组完全解理，约 87°', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 3.3, crystalSystem: 'monoclinic', birefringence: 0.024, relief: 'moderate', color: 'black / dark green', colorZh: '黑 / 暗绿',
    opticalSign: '+', notes: 'Pyroxene with ~87° cleavage; common in basalt and gabbro.', notesZh: '约 87° 解理的辉石；常见于玄武岩与辉长岩。',
  },
  {
    id: 'olivine', name: 'Olivine', nameZh: '橄榄石', formula: '(Mg,Fe)₂SiO₄', class: 'silicate', group: 'isolated tetrahedra', groupZh: '岛状硅酸盐',
    hardness: 6.5, cleavage: 'poor, conchoidal', cleavageZh: '解理差，贝壳状', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 3.35, crystalSystem: 'orthorhombic', birefringence: 0.035, relief: 'high', color: 'olive green / yellow-green', colorZh: '橄榄绿 / 黄绿',
    opticalSign: '+', notes: 'High relief and second-order interference colours; mantle mineral.', notesZh: '高突起、二级干涉色；地幔主要矿物。',
  },
  {
    id: 'calcite', name: 'Calcite', nameZh: '方解石', formula: 'CaCO₃', class: 'carbonate', group: 'carbonate', groupZh: '碳酸盐',
    hardness: 3, cleavage: 'perfect rhombohedral', cleavageZh: '菱面体完全解理', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 2.71, crystalSystem: 'hexagonal', birefringence: 0.172, relief: 'high', color: 'colourless / white', colorZh: '无色 / 白',
    opticalSign: '-', notes: 'Extreme birefringence produces high-order white interference; fizzes in acid.', notesZh: '极高双折射率导致高级白干涉色；遇酸起泡。',
  },
  {
    id: 'dolomite', name: 'Dolomite', nameZh: '白云石', formula: 'CaMg(CO₃)₂', class: 'carbonate', group: 'carbonate', groupZh: '碳酸盐',
    hardness: 3.5, cleavage: 'perfect rhombohedral', cleavageZh: '菱面体完全解理', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 2.86, crystalSystem: 'hexagonal', birefringence: 0.179, relief: 'high', color: 'white / grey / pink', colorZh: '白 / 灰 / 粉',
    opticalSign: '-', notes: 'Similar to calcite but with curved crystal faces and weaker acid reaction.', notesZh: '与方解石相似，但晶面弯曲，酸反应较弱。',
  },
  {
    id: 'halite', name: 'Halite', nameZh: '石盐', formula: 'NaCl', class: 'halide', group: 'halide', groupZh: '卤化物',
    hardness: 2.5, cleavage: 'perfect cubic', cleavageZh: '立方体完全解理', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 2.16, crystalSystem: 'cubic', birefringence: 0, relief: 'low', color: 'colourless / white', colorZh: '无色 / 白',
    opticalSign: 'none', notes: 'Isotropic (cubic), salty taste, cubic cleavage.', notesZh: '等轴晶系均质体，咸味，立方体解理。',
  },
  {
    id: 'gypsum', name: 'Gypsum', nameZh: '石膏', formula: 'CaSO₄·2H₂O', class: 'sulfate', group: 'sulfate', groupZh: '硫酸盐',
    hardness: 2, cleavage: 'perfect basal', cleavageZh: '底面完全解理', luster: 'silky', streak: 'white', streakZh: '白色',
    sg: 2.32, crystalSystem: 'monoclinic', birefringence: 0.009, relief: 'low', color: 'colourless / white', colorZh: '无色 / 白',
    opticalSign: '+', notes: 'Scratched by a fingernail; satin-spar variety is fibrous.', notesZh: '指甲可刻划；纤维状变种称纤维石膏。',
  },
  {
    id: 'fluorite', name: 'Fluorite', nameZh: '萤石', formula: 'CaF₂', class: 'halide', group: 'halide', groupZh: '卤化物',
    hardness: 4, cleavage: 'perfect octahedral', cleavageZh: '八面体完全解理', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 3.18, crystalSystem: 'cubic', birefringence: 0, relief: 'high', color: 'purple / green / blue', colorZh: '紫 / 绿 / 蓝',
    opticalSign: 'none', notes: 'Isotropic; strong fluorescence under UV (the name source).', notesZh: '均质体；紫外光下强荧光（名称来源）。',
  },
  {
    id: 'apatite', name: 'Apatite', nameZh: '磷灰石', formula: 'Ca₅(PO₄)₃(F,OH)', class: 'phosphate', group: 'phosphate', groupZh: '磷酸盐',
    hardness: 5, cleavage: 'poor basal', cleavageZh: '底面解理差', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 3.2, crystalSystem: 'hexagonal', birefringence: 0.004, relief: 'moderate', color: 'green / yellow / blue', colorZh: '绿 / 黄 / 蓝',
    opticalSign: '-', notes: 'Low birefringence, high relief; common accessory in igneous rocks.', notesZh: '低双折射率、高突起；火成岩常见副矿物。',
  },
  {
    id: 'pyrite', name: 'Pyrite', nameZh: '黄铁矿', formula: 'FeS₂', class: 'sulfide', group: 'sulfide', groupZh: '硫化物',
    hardness: 6.5, cleavage: 'none, conchoidal', cleavageZh: '无解理，贝壳状', luster: 'metallic', streak: 'greenish black', streakZh: '绿黑色',
    sg: 5.0, crystalSystem: 'cubic', birefringence: 0, relief: 'high', color: 'brass yellow', colorZh: '黄铜色',
    opticalSign: 'none', notes: '“Fool’s gold”; striated cubic crystals, greenish-black streak.', notesZh: '“愚人金”；立方体晶面条纹，绿黑色条痕。',
  },
  {
    id: 'galena', name: 'Galena', nameZh: '方铅矿', formula: 'PbS', class: 'sulfide', group: 'sulfide', groupZh: '硫化物',
    hardness: 2.5, cleavage: 'perfect cubic', cleavageZh: '立方体完全解理', luster: 'metallic', streak: 'lead grey', streakZh: '铅灰色',
    sg: 7.6, crystalSystem: 'cubic', birefringence: 0, relief: 'high', color: 'lead grey', colorZh: '铅灰',
    opticalSign: 'none', notes: 'Very high specific gravity and cubic cleavage; main lead ore.', notesZh: '极高比重与立方体解理；主要铅矿石。',
  },
  {
    id: 'magnetite', name: 'Magnetite', nameZh: '磁铁矿', formula: 'Fe₃O₄', class: 'oxide', group: 'spinel oxide', groupZh: '尖晶石型氧化物',
    hardness: 6, cleavage: 'none', cleavageZh: '无解理', luster: 'metallic', streak: 'black', streakZh: '黑色',
    sg: 5.17, crystalSystem: 'cubic', birefringence: 0, relief: 'high', color: 'black', colorZh: '黑色',
    opticalSign: 'none', notes: 'Strongly magnetic; opaque in thin section.', notesZh: '强磁性；薄片中不透明。',
  },
  {
    id: 'hematite', name: 'Hematite', nameZh: '赤铁矿', formula: 'Fe₂O₃', class: 'oxide', group: 'oxide', groupZh: '氧化物',
    hardness: 5.5, cleavage: 'none', cleavageZh: '无解理', luster: 'metallic', streak: 'reddish brown', streakZh: '樱红色',
    sg: 5.26, crystalSystem: 'hexagonal', birefringence: 0, relief: 'high', color: 'steel grey / red', colorZh: '钢灰 / 红',
    opticalSign: 'none', notes: 'Diagnostic reddish-brown streak; earthy or specular habit.', notesZh: '特征樱红色条痕；土状或镜面状。',
  },
  {
    id: 'corundum', name: 'Corundum', nameZh: '刚玉', formula: 'Al₂O₃', class: 'oxide', group: 'oxide', groupZh: '氧化物',
    hardness: 9, cleavage: 'none, parting', cleavageZh: '无解理，有裂理', luster: 'adamantine', streak: 'white', streakZh: '白色',
    sg: 4.0, crystalSystem: 'hexagonal', birefringence: 0.008, relief: 'high', color: 'blue / red / brown', colorZh: '蓝 / 红 / 褐',
    opticalSign: '-', notes: 'Second hardest common mineral; ruby and sapphire varieties.', notesZh: '常见矿物中第二硬；红宝石与蓝宝石变种。',
  },
  {
    id: 'garnet', name: 'Almandine garnet', nameZh: '铁铝榴石', formula: 'Fe₃Al₂(SiO₄)₃', class: 'silicate', group: 'nesosilicate', groupZh: '岛状硅酸盐',
    hardness: 7.5, cleavage: 'none', cleavageZh: '无解理', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 4.3, crystalSystem: 'cubic', birefringence: 0, relief: 'high', color: 'deep red / brown', colorZh: '深红 / 褐',
    opticalSign: 'none', notes: 'Isotropic, high relief, commonly in metamorphic rocks.', notesZh: '均质体、高突起，常见于变质岩。',
  },
  {
    id: 'tourmaline', name: 'Tourmaline', nameZh: '电气石', formula: 'XY₃Al₆(BO₃)₃Si₆O₁₈(OH)₄', class: 'silicate', group: 'cyclosilicate', groupZh: '环状硅酸盐',
    hardness: 7.5, cleavage: 'poor', cleavageZh: '解理差', luster: 'vitreous', streak: 'white', streakZh: '白色',
    sg: 3.1, crystalSystem: 'hexagonal', birefringence: 0.020, relief: 'high', color: 'black / pink / green', colorZh: '黑 / 粉 / 绿',
    opticalSign: '-', notes: 'Strongly pleochroic, prismatic crystals with triangular cross-section.', notesZh: '多色性极强，柱状晶体具三角形横截面。',
  },
  {
    id: 'talc', name: 'Talc', nameZh: '滑石', formula: 'Mg₃Si₄O₁₀(OH)₂', class: 'silicate', group: 'sheet silicate', groupZh: '层状硅酸盐',
    hardness: 1, cleavage: 'perfect basal', cleavageZh: '底面完全解理', luster: 'pearly', streak: 'white', streakZh: '白色',
    sg: 2.75, crystalSystem: 'monoclinic', birefringence: 0.051, relief: 'moderate', color: 'white / pale green', colorZh: '白 / 淡绿',
    opticalSign: '-', notes: 'Reference mineral 1 on the Mohs scale; greasy feel.', notesZh: '莫氏硬度 1 的标准矿物；具滑腻感。',
  },
  {
    id: 'kaolinite', name: 'Kaolinite', nameZh: '高岭石', formula: 'Al₂Si₂O₅(OH)₄', class: 'silicate', group: 'sheet silicate', groupZh: '层状硅酸盐',
    hardness: 2, cleavage: 'perfect basal', cleavageZh: '底面完全解理', luster: 'earthy', streak: 'white', streakZh: '白色',
    sg: 2.6, crystalSystem: 'triclinic', birefringence: 0.007, relief: 'low', color: 'white', colorZh: '白色',
    opticalSign: '-', notes: 'Clay mineral; earthy luster, low relief, fine-grained aggregates.', notesZh: '黏土矿物；土状光泽、低突起、细粒集合体。',
  },
  {
    id: 'rutile', name: 'Rutile', nameZh: '金红石', formula: 'TiO₂', class: 'oxide', group: 'oxide', groupZh: '氧化物',
    hardness: 6.5, cleavage: 'good prismatic', cleavageZh: '柱面解理良好', luster: 'adamantine', streak: 'pale brown', streakZh: '浅褐色',
    sg: 4.23, crystalSystem: 'tetragonal', birefringence: 0.287, relief: 'very-high', color: 'red / brown / black', colorZh: '红 / 褐 / 黑',
    opticalSign: '+', notes: 'Extremely high relief and birefringence; needle-like inclusions.', notesZh: '极高突起与双折射率；针状包裹体。',
  },
];

export function mineralById(id: string): Mineral | undefined {
  return MINERALS.find((m) => m.id === id);
}

// --------------------------------------------------------------------------
// Mohs hardness
// --------------------------------------------------------------------------

export const MOHS_TOOLS: ReadonlyArray<{ id: string; en: string; zh: string; hardness: number }> = [
  { id: 'fingernail', en: 'Fingernail', zh: '指甲', hardness: 2.5 },
  { id: 'copper-coin', en: 'Copper coin', zh: '铜币', hardness: 3.5 },
  { id: 'steel-nail', en: 'Steel nail', zh: '钢钉', hardness: 5.5 },
  { id: 'glass', en: 'Glass plate', zh: '玻璃板', hardness: 5.5 },
  { id: 'steel-file', en: 'Steel file', zh: '钢锉', hardness: 6.5 },
  { id: 'quartz-point', en: 'Quartz point', zh: '石英尖', hardness: 7 },
  { id: 'corundum', en: 'Corundum', zh: '刚玉', hardness: 9 },
];

export type ScratchResult = 'mineral-scratches-tool' | 'tool-scratches-mineral' | 'mutual';

/** Result of a Mohs scratch test. */
export function scratchTest(mineralHardness: number, toolHardness: number): ScratchResult {
  const d = mineralHardness - toolHardness;
  if (Math.abs(d) < 0.25) return 'mutual';
  return d > 0 ? 'mineral-scratches-tool' : 'tool-scratches-mineral';
}

/** Relative hardness on the Mohs scale (0–1). */
export function mohsFraction(hardness: number): number {
  return Math.max(0, Math.min(1, (hardness - 1) / 9));
}

// --------------------------------------------------------------------------
// Identification key
// --------------------------------------------------------------------------

export interface IdentifyCriteria {
  hardness?: number;
  hardnessTolerance?: number;
  cleavage?: string;
  luster?: Luster;
  streak?: string;
  sg?: number;
  sgTolerance?: number;
  crystalSystem?: CrystalSystem;
  mineralClass?: MineralClass;
  color?: string;
}

export interface IdentifyMatch {
  mineral: Mineral;
  score: number;
  matched: string[];
  missed: string[];
}

/**
 * Score each mineral against the supplied criteria. Each satisfied property
 * contributes weight; hardness and specific gravity use tolerance windows.
 * Returns candidates sorted by descending score (0–100).
 */
export function identifyMinerals(criteria: IdentifyCriteria, database: readonly Mineral[] = MINERALS): IdentifyMatch[] {
  const out: IdentifyMatch[] = [];
  const hTol = criteria.hardnessTolerance ?? 0.6;
  const sgTol = criteria.sgTolerance ?? 0.35;
  for (const m of database) {
    let score = 0;
    let max = 0;
    const matched: string[] = [];
    const missed: string[] = [];
    const check = (key: string, pass: boolean, weight: number) => {
      max += weight;
      if (pass) {
        score += weight;
        matched.push(key);
      } else missed.push(key);
    };
    if (criteria.hardness !== undefined) {
      const diff = Math.abs(m.hardness - criteria.hardness);
      const pass = diff <= hTol;
      max += 25;
      if (pass) {
        // Exact matches outrank minerals merely inside the tolerance window.
        score += 25 * (1 - diff / (2 * hTol));
        matched.push('hardness');
      } else missed.push('hardness');
    }
    if (criteria.cleavage) {
      const q = criteria.cleavage.toLowerCase();
      check('cleavage', m.cleavage.toLowerCase().includes(q) || m.cleavageZh.includes(criteria.cleavage), 18);
    }
    if (criteria.luster) check('luster', m.luster === criteria.luster, 12);
    if (criteria.streak) {
      const q = criteria.streak.toLowerCase();
      check('streak', m.streak.toLowerCase().includes(q) || m.streakZh.includes(criteria.streak), 15);
    }
    if (criteria.sg !== undefined) {
      const diff = Math.abs(m.sg - criteria.sg);
      const pass = diff <= sgTol;
      max += 16;
      if (pass) {
        score += 16 * (1 - diff / (2 * sgTol));
        matched.push('specific-gravity');
      } else missed.push('specific-gravity');
    }
    if (criteria.crystalSystem) check('crystal-system', m.crystalSystem === criteria.crystalSystem, 14);
    if (criteria.mineralClass) check('class', m.class === criteria.mineralClass, 10);
    if (criteria.color) {
      const q = criteria.color.toLowerCase();
      check('colour', m.color.toLowerCase().includes(q) || m.colorZh.includes(criteria.color), 8);
    }
    if (max === 0) continue;
    out.push({ mineral: m, score: (score / max) * 100, matched, missed });
  }
  out.sort((a, b) => b.score - a.score || a.mineral.name.localeCompare(b.mineral.name));
  return out;
}

/** Hierarchical classification path (class → structural group → mineral). */
export function classificationPath(m: Mineral, zh = false): string[] {
  const classLabel: Record<MineralClass, { en: string; zh: string }> = {
    silicate: { en: 'Silicates', zh: '硅酸盐' },
    carbonate: { en: 'Carbonates', zh: '碳酸盐' },
    oxide: { en: 'Oxides', zh: '氧化物' },
    sulfide: { en: 'Sulfides', zh: '硫化物' },
    sulfate: { en: 'Sulfates', zh: '硫酸盐' },
    halide: { en: 'Halides', zh: '卤化物' },
    native: { en: 'Native elements', zh: '自然元素' },
    phosphate: { en: 'Phosphates', zh: '磷酸盐' },
  };
  return [
    zh ? classLabel[m.class].zh : classLabel[m.class].en,
    zh ? m.groupZh : m.group,
    zh ? m.nameZh : m.name,
  ];
}

// --------------------------------------------------------------------------
// Crystal-system classification
// --------------------------------------------------------------------------

export interface UnitCell {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

/** Classify a unit cell into one of the six crystal systems. */
export function crystalSystemFromCell(cell: UnitCell): CrystalSystem {
  const eq = (x: number, y: number, tol = 0.005) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
  const ang = (x: number, target: number, tol = 0.8) => Math.abs(x - target) <= tol;
  const { a, b, c, alpha, beta, gamma } = cell;
  const allAngles90 = ang(alpha, 90) && ang(beta, 90) && ang(gamma, 90);
  if (allAngles90) {
    if (eq(a, b) && eq(b, c)) return 'cubic';
    // Two equal axes: tetragonal is the conventional assignment. (Strictly,
    // orthorhombic requires all three axes distinct, so a two-equal-axis cell
    // cannot be orthorhombic.)
    if (eq(a, b) || eq(b, c) || eq(a, c)) return 'tetragonal';
    return 'orthorhombic';
  }
  // Hexagonal setting: a = b, γ = 120°, α = β = 90°.
  if (ang(alpha, 90) && ang(beta, 90) && ang(gamma, 120) && eq(a, b)) return 'hexagonal';
  // Rhombohedral/trigonal cell folded into hexagonal (no separate trigonal type):
  // a = b = c with α = β = γ ≠ 90°.
  if (eq(a, b) && eq(b, c) && ang(alpha, beta) && ang(beta, gamma) && !ang(alpha, 90)) {
    return 'hexagonal';
  }
  const n90 = [ang(alpha, 90), ang(beta, 90), ang(gamma, 90)].filter(Boolean).length;
  // Monoclinic: exactly one oblique angle, in any of the three settings.
  if (n90 === 2) return 'monoclinic';
  return 'triclinic';
}

/** Axial ratio c/a for tetragonal / hexagonal cells. */
export function axialRatio(cell: UnitCell): number {
  return cell.c / cell.a;
}

// --------------------------------------------------------------------------
// Optical / thin-section model
// --------------------------------------------------------------------------

/** Retardation Γ = Δn · t (nm) for a 30-μm standard thin section. */
export function retardationNm(birefringence: number, thicknessUm = 30): number {
  return Math.max(0, birefringence) * Math.max(0, thicknessUm) * 1000;
}

/** Approximate Michel-Lévy interference colour for a retardation (nm). */
export function interferenceColor(retardation: number): { r: number; g: number; b: number; name: string; nameZh: string } {
  const g = Math.max(0, retardation);
  const table: Array<{ at: number; rgb: [number, number, number]; en: string; zh: string }> = [
    { at: 0, rgb: [30, 30, 30], en: 'black (extinction)', zh: '黑色（消光）' },
    { at: 80, rgb: [70, 70, 70], en: 'dark grey', zh: '暗灰' },
    { at: 150, rgb: [160, 160, 160], en: 'first-order grey', zh: '一级灰' },
    { at: 240, rgb: [235, 235, 225], en: 'first-order white', zh: '一级白' },
    { at: 320, rgb: [245, 225, 120], en: 'first-order yellow', zh: '一级黄' },
    { at: 420, rgb: [240, 150, 70], en: 'first-order orange', zh: '一级橙' },
    { at: 520, rgb: [220, 70, 70], en: 'first-order red', zh: '一级红' },
    { at: 620, rgb: [110, 90, 160], en: 'second-order blue', zh: '二级蓝' },
    { at: 720, rgb: [90, 150, 190], en: 'second-order blue-green', zh: '二级蓝绿' },
    { at: 820, rgb: [120, 200, 130], en: 'second-order green', zh: '二级绿' },
    { at: 920, rgb: [235, 220, 120], en: 'second-order yellow', zh: '二级黄' },
    { at: 1040, rgb: [235, 130, 120], en: 'second-order red', zh: '二级红' },
    { at: 1200, rgb: [180, 190, 220], en: 'third-order pale', zh: '三级淡色' },
    { at: 1600, rgb: [235, 235, 230], en: 'high-order white', zh: '高级白' },
  ];
  let i = 0;
  while (i + 1 < table.length && g > table[i + 1]!.at) i += 1;
  const a = table[i]!;
  const b = table[Math.min(i + 1, table.length - 1)]!;
  const f = b.at > a.at ? Math.max(0, Math.min(1, (g - a.at) / (b.at - a.at))) : 0;
  const mix = (k: 0 | 1 | 2) => Math.round(a.rgb[k] + (b.rgb[k] - a.rgb[k]) * f);
  const name = f < 0.5 ? a.en : b.en;
  const nameZh = f < 0.5 ? a.zh : b.zh;
  return { r: mix(0), g: mix(1), b: mix(2), name, nameZh };
}

/** Optical relief from the refractive-index contrast against Canada balsam. */
export function opticalRelief(mineralRi: number, mediumRi = 1.54): { relief: Relief; contrast: number } {
  const contrast = Math.abs(mineralRi - mediumRi);
  if (contrast < 0.03) return { relief: 'low', contrast };
  if (contrast < 0.08) return { relief: 'moderate', contrast };
  if (contrast < 0.15) return { relief: 'high', contrast };
  return { relief: 'very-high', contrast };
}

// --------------------------------------------------------------------------
// Parsing / validation
// --------------------------------------------------------------------------

/** Parse the mineral database CSV (header names are matched case-insensitively). */
export function parseMineralCsv(text: string): Mineral[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const out: Mineral[] = [];
  for (let li = 1; li < lines.length; li += 1) {
    const cols = splitCsvLine(lines[li]!);
    const get = (...names: string[]) => {
      const i = idx(...names);
      return i >= 0 ? (cols[i] ?? '').trim() : '';
    };
    const name = get('name');
    const hardness = Number(get('hardness'));
    const sg = Number(get('sg', 'specific_gravity'));
    if (!name || !Number.isFinite(hardness) || !Number.isFinite(sg)) continue;
    const system = get('crystal_system', 'system').toLowerCase() as CrystalSystem;
    out.push({
      id: get('id') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      nameZh: get('name_zh', 'namezh') || name,
      formula: get('formula'),
      class: (get('class') || 'silicate') as MineralClass,
      group: get('group') || 'unknown',
      groupZh: get('group_zh') || get('group') || '未知',
      hardness,
      cleavage: get('cleavage') || 'none',
      cleavageZh: get('cleavage_zh') || get('cleavage') || '无',
      luster: (get('luster') || 'vitreous') as Luster,
      streak: get('streak') || 'white',
      streakZh: get('streak_zh') || get('streak') || '白色',
      sg,
      crystalSystem: CRYSTAL_SYSTEMS.includes(system) ? system : 'cubic',
      birefringence: Number(get('birefringence')) || 0,
      relief: (get('relief') || 'low') as Relief,
      color: get('color', 'colour') || '',
      colorZh: get('color_zh') || get('color', 'colour') || '',
      opticalSign: (get('optical_sign') as '+' | '-' | 'none') || 'none',
      notes: get('notes') || '',
      notesZh: get('notes_zh') || get('notes') || '',
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface MineralBenchmark {
  id: string;
  pass: boolean;
  detail: string;
}

export function runMineralBenchmarks(): MineralBenchmark[] {
  const out: MineralBenchmark[] = [];
  // 1. Cubic cell classification.
  const cubic = crystalSystemFromCell({ a: 5.43, b: 5.43, c: 5.43, alpha: 90, beta: 90, gamma: 90 });
  out.push({ id: 'cell-cubic', pass: cubic === 'cubic', detail: `a=b=c=5.43 Å, all 90° → ${cubic}` });
  // 2. Hexagonal cell (a=b≠c, γ=120°).
  const hex = crystalSystemFromCell({ a: 4.91, b: 4.91, c: 5.40, alpha: 90, beta: 90, gamma: 120 });
  out.push({ id: 'cell-hexagonal', pass: hex === 'hexagonal', detail: `a=b=4.91, c=5.40, γ=120° → ${hex}` });
  // 3. Calcite retardation: Δn=0.172, t=30 µm → 5160 nm.
  const cal = mineralById('calcite')!;
  const gamma = retardationNm(cal.birefringence);
  out.push({ id: 'retardation-calcite', pass: Math.abs(gamma - 5160) < 1e-9, detail: `Γ=${gamma.toFixed(1)} nm (expected 5160)` });
  // 4. Identification: hardness 7 + no cleavage + vitreous + white streak must rank quartz first.
  const matches = identifyMinerals({ hardness: 7, cleavage: 'none', luster: 'vitreous', streak: 'white' });
  out.push({ id: 'identify-quartz', pass: matches[0]?.mineral.id === 'quartz', detail: `top match ${matches[0]?.mineral.name} @ ${matches[0]?.score.toFixed(1)}%` });
  // 5. Database sanity: unique ids, all six systems represented.
  const unique = new Set(MINERALS.map((m) => m.id)).size === MINERALS.length;
  const systems = new Set(MINERALS.map((m) => m.crystalSystem));
  out.push({ id: 'database-sanity', pass: unique && systems.size >= 5, detail: `${MINERALS.length} minerals, ${systems.size} crystal systems, unique ids=${unique}` });
  return out;
}
