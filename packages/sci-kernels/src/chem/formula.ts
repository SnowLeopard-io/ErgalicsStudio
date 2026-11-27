// ==========================================================================
// Ergalics Studio — 化学式解析
//
// 把 "CaCO3" / "(NH4)2SO4" / "Ca^2+" 解析成元素计数 + 净电荷，供守恒校验使用。
//
// 两条硬规则：
//   ▸ 自带完整 118 元素表，不复用 chem/elements.ts —— 那张表只有 49 个元素
//     （给质量/半径用的），拿它当白名单会把 Pt、U、Th 判成非法。
//   ▸ 电荷必须写成 ^ 形式。SO42- 可能是 SO₄²⁻ 也可能是 S O₄₂，NH4+ 同理；
//     猜错不会报错、只会算错，所以有歧义一律拒绝。
// ==========================================================================

/**
 * 判定用的元素表（118 个）。与 chem/elements.ts（49 个，含质量/半径）分开：
 * 判定表必须完整且稳定，不能随业务表的取舍变化。
 */
const ELEMENT_SYMBOLS = new Set(
  ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
    + 'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd '
    + 'Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th '
    + 'Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '),
);

/** 尾部 ^ 电荷，如 "SO4^2-"、"Fe^3+"。 */
const CARET_CHARGE = /\^(\d*)([+-])$/;
/** 只有符号没有数字，如 "OH-"、"Na+"。 */
const BARE_SIGN = /([+-])$/;
/** 数字紧贴符号且无 ^：有歧义，见文件头。 */
const AMBIGUOUS_SIGN = /(\d+)([+-])$/;

export interface ParsedFormula {
  /** 元素符号 → 原子数。 */
  elements: Record<string, number>;
  /** 净电荷（元电荷）。 */
  charge: number;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function knownElement(symbol: string): boolean {
  return ELEMENT_SYMBOLS.has(symbol);
}

/**
 * 解析化学式。无法解析时抛错，不返回半截结果——
 * 读不懂的式子绝不能被当成"守恒"。
 */
export function parseFormula(raw: string): ParsedFormula {
  let s = String(raw ?? '').replace(/\s+/g, '');
  if (!s) throw new Error('空化学式');

  let charge = 0;
  const caret = s.match(CARET_CHARGE);
  if (caret) {
    const mag = caret[1] === '' ? 1 : Number(caret[1]);
    charge = (caret[2] === '-' ? -1 : 1) * mag;
    s = s.slice(0, s.length - caret[0].length);
  } else {
    if (AMBIGUOUS_SIGN.test(s)) {
      throw new Error(`电荷写法有歧义，请用 ^ 形式（如 SO4^2- / NH4^+ / Ca^2+）：${raw}`);
    }
    const bare = s.match(BARE_SIGN);
    if (bare) {
      charge = bare[1] === '-' ? -1 : 1;
      s = s.slice(0, s.length - 1);
    }
  }

  if (!s) throw new Error('化学式缺少主体: ' + raw);

  const stack: Record<string, number>[] = [{}];
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch === '(' || ch === '[') {
      stack.push({});
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      if (stack.length === 1) throw new Error('括号不匹配: ' + raw);
      const group = stack.pop() as Record<string, number>;
      i += 1;
      let num = '';
      while (i < s.length && isDigit(s.charAt(i))) num += s.charAt(i++);
      const mul = num === '' ? 1 : Number(num);
      const parent = stack[stack.length - 1]!;
      for (const k of Object.keys(group)) parent[k] = (parent[k] ?? 0) + (group[k] ?? 0) * mul;
      continue;
    }
    if (isDigit(ch)) throw new Error('系数位置异常: ' + raw);
    if (ch === '.' || ch === '·') throw new Error('暂不支持水合物写法: ' + raw);

    const m = /^[A-Z][a-z]?/.exec(s.slice(i));
    if (!m) throw new Error(`无法解析的字符 "${ch}": ${raw}`);
    const sym = m[0];
    if (!knownElement(sym)) throw new Error(`未知元素 "${sym}": ${raw}`);
    i += sym.length;
    let num = '';
    while (i < s.length && isDigit(s.charAt(i))) num += s.charAt(i++);
    const n = num === '' ? 1 : Number(num);
    const cur = stack[stack.length - 1]!;
    cur[sym] = (cur[sym] ?? 0) + n;
  }

  if (stack.length !== 1) throw new Error('括号不匹配: ' + raw);
  return { elements: stack[0]!, charge };
}
