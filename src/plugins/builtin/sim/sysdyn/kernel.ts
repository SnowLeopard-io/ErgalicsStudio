// ==========================================================================
// sim-sysdyn kernel — System Dynamics stock-flow simulation core.
//
// Model spec (JSON): stocks, flows (rate equations), auxiliaries, parameters.
// Expressions are safe arithmetic strings parsed by a shunting-yard evaluator
// (no eval / Function). Integration: Euler or RK4. Includes causal-loop
// polarity helpers, feedback-loop detection, a documented one-step loop
// dominance heuristic and parameter sweeps. Five built-in templates.
// ==========================================================================

// ---- Model spec -------------------------------------------------------------

export interface SDStock { name: string; initial: string }
export interface SDFlow { name: string; from?: string; to?: string; expr: string }
export interface SDAuxiliary { name: string; expr: string }
export interface SDParameter { name: string; value: number }

export interface SDModel {
  stocks: SDStock[];
  flows: SDFlow[];
  auxiliaries: SDAuxiliary[];
  parameters: SDParameter[];
  /** Explicit causal links for the causal-loop diagram view. */
  links?: Array<{ from: string; to: string; polarity: 1 | -1 }>;
}

export interface SDSimSettings {
  tStart: number;
  tStop: number;
  dt: number;
  method: 'euler' | 'rk4';
}

export interface SDSeries {
  t: number[];
  stocks: Record<string, number[]>;
  flows: Record<string, number[]>;
  auxiliaries: Record<string, number[]>;
}

export function validateModel(model: SDModel): string | null {
  if (!model.stocks.length) return 'Model needs at least one stock';
  const names = new Set<string>();
  for (const s of [...model.stocks, ...model.flows, ...model.auxiliaries, ...model.parameters]) {
    if (names.has(s.name)) return `Duplicate name '${s.name}'`;
    names.add(s.name);
  }
  return null;
}

// ---- Expression evaluator ---------------------------------------------------

interface Token { kind: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; text: string }

const FUNCS = new Set(['min', 'max', 'abs', 'sqrt', 'exp', 'ln', 'log', 'pow', 'sin', 'cos', 'tan']);
const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, 'u-': 4 };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j]!)) j++;
      if (j < src.length && (src[j] === '+' || src[j] === '-') && j > i + 1 && /[eE]/.test(src[j - 1]!)) {
        let k = j + 1;
        while (k < src.length && /[0-9]/.test(src[k]!)) k++;
        tokens.push({ kind: 'num', text: src.slice(i, k) });
        i = k;
        continue;
      }
      tokens.push({ kind: 'num', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++;
      tokens.push({ kind: 'id', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(ch)) { tokens.push({ kind: 'op', text: ch }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lp', text: ch }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rp', text: ch }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma', text: ch }); i++; continue; }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

/** Shunting-yard: expression -> RPN token list. `variables` are the allowed
 * identifiers (stock/flow/auxiliary/parameter names plus t). */
export function parseExpression(src: string, variables: string[]): string[] {
  const vars = new Set(variables);
  const output: string[] = [];
  const stack: string[] = [];
  let prev: Token | null = null;
  for (const tk of tokenize(src)) {
    if (tk.kind === 'num') {
      if (!Number.isFinite(Number(tk.text))) throw new Error(`Invalid number '${tk.text}'`);
      output.push(tk.text);
    } else if (tk.kind === 'id') {
      if (FUNCS.has(tk.text)) stack.push('f:' + tk.text);
      else if (vars.has(tk.text)) output.push('v:' + tk.text);
      else throw new Error(`Unknown identifier '${tk.text}'`);
    } else if (tk.kind === 'op') {
      const unary = tk.text === '-' && (!prev || prev.kind === 'op' || prev.kind === 'lp' || prev.kind === 'comma');
      const op = unary ? 'u-' : tk.text;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top.startsWith('f:')) { output.push(stack.pop()!); continue; }
        if (PREC[top] !== undefined && PREC[top]! >= PREC[op]! && !(op === '^' && top === '^')) {
          output.push(stack.pop()!);
          continue;
        }
        break;
      }
      stack.push(op);
    } else if (tk.kind === 'lp') {
      stack.push('(');
    } else if (tk.kind === 'rp') {
      let found = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top === '(') { found = true; break; }
        output.push(top);
      }
      if (!found) throw new Error('Unbalanced parentheses');
      if (stack.length && stack[stack.length - 1]!.startsWith('f:')) output.push(stack.pop()!);
    } else if (tk.kind === 'comma') {
      let found = false;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top === '(') { found = true; break; }
        output.push(stack.pop()!);
      }
      if (!found) throw new Error('Comma outside function call');
    }
    prev = tk;
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top === '(') throw new Error('Unbalanced parentheses');
    output.push(top);
  }
  return output;
}

export function evalRpn(rpn: string[], scope: Record<string, number>): number {
  const st: number[] = [];
  for (const tk of rpn) {
    if (tk.startsWith('v:')) {
      const v = scope[tk.slice(2)];
      if (v === undefined || !Number.isFinite(v)) throw new Error(`Unbound variable '${tk.slice(2)}'`);
      st.push(v);
    } else if (tk.startsWith('f:')) {
      const f = tk.slice(2);
      const arity = f === 'pow' || f === 'min' || f === 'max' ? 2 : 1;
      if (st.length < arity) throw new Error(`Function '${f}' expects ${arity} argument(s)`);
      const args = st.splice(st.length - arity, arity);
      st.push(applyFunc(f, args[0] ?? 0, args[1] ?? 0));
    } else if (tk === 'u-') {
      if (!st.length) throw new Error('Missing operand');
      st.push(-st.pop()!);
    } else if (PREC[tk] !== undefined) {
      if (st.length < 2) throw new Error('Missing operand');
      const b = st.pop()!;
      const a = st.pop()!;
      st.push(applyOp(tk, a, b));
    } else {
      st.push(Number(tk));
    }
  }
  if (st.length !== 1) throw new Error('Malformed expression');
  return st[0]!;
}

function applyOp(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '^': return Math.pow(a, b);
    default: throw new Error(`Unknown operator '${op}'`);
  }
}

function applyFunc(f: string, a: number, b: number): number {
  switch (f) {
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    case 'abs': return Math.abs(a);
    case 'sqrt': return Math.sqrt(a);
    case 'exp': return Math.exp(a);
    case 'ln': return Math.log(a);
    case 'log': return Math.log10(a);
    case 'pow': return Math.pow(a, b);
    case 'sin': return Math.sin(a);
    case 'cos': return Math.cos(a);
    case 'tan': return Math.tan(a);
    default: throw new Error(`Unknown function '${f}'`);
  }
}

// ---- Compiled model ---------------------------------------------------------

interface CompiledSD {
  model: SDModel;
  stockNames: string[];
  flowRpn: Array<{ name: string; rpn: string[] }>;
  auxRpn: Array<{ name: string; rpn: string[] }>;
  params: Record<string, number>;
  /** Topologically ordered non-stock evaluation plan. */
  evalOrder: Array<{ kind: 'flow' | 'aux'; name: string; rpn: string[] }>;
}

/** Compile all expressions once. Throws on unknown identifiers or malformed
 * expressions. Auxiliary/flow dependencies must be acyclic among themselves. */
export function compileModel(model: SDModel): CompiledSD {
  const err = validateModel(model);
  if (err) throw new Error(err);
  const vars = [...model.stocks.map((s) => s.name), ...model.flows.map((f) => f.name), ...model.auxiliaries.map((a) => a.name), ...model.parameters.map((p) => p.name), 't'];
  const flowRpn = model.flows.map((f) => ({ name: f.name, rpn: parseExpression(f.expr, vars) }));
  const auxRpn = model.auxiliaries.map((a) => ({ name: a.name, rpn: parseExpression(a.expr, vars) }));
  const params: Record<string, number> = {};
  for (const p of model.parameters) params[p.name] = p.value;
  // Cycle check among auxiliaries/flows (stocks are state, always allowed).
  const deps = (rpn: string[]): string[] => rpn.filter((t) => t.startsWith('v:')).map((t) => t.slice(2));
  const nonStock = new Set([...model.flows.map((f) => f.name), ...model.auxiliaries.map((a) => a.name)]);
  const adj = new Map<string, string[]>();
  for (const f of flowRpn) adj.set(f.name, deps(f.rpn).filter((d) => nonStock.has(d)));
  for (const a of auxRpn) adj.set(a.name, deps(a.rpn).filter((d) => nonStock.has(d)));
  const state: Record<string, 0 | 1 | 2> = {};
  const visit = (n: string, path: Set<string>): void => {
    if (state[n] === 2) return;
    if (state[n] === 1 || path.has(n)) throw new Error(`Circular dependency involving '${n}'`);
    state[n] = 1;
    path.add(n);
    for (const d of adj.get(n) ?? []) visit(d, path);
    state[n] = 2;
  };
  for (const n of adj.keys()) visit(n, new Set());
  // Topological order: emit dependencies before dependents.
  const evalOrder: CompiledSD['evalOrder'] = [];
  const emitted = new Set<string>();
  const emit = (n: string): void => {
    if (emitted.has(n)) return;
    for (const d of adj.get(n) ?? []) emit(d);
    emitted.add(n);
    const flow = flowRpn.find((f) => f.name === n);
    if (flow) evalOrder.push({ kind: 'flow', name: n, rpn: flow.rpn });
    else {
      const aux = auxRpn.find((a) => a.name === n);
      if (aux) evalOrder.push({ kind: 'aux', name: n, rpn: aux.rpn });
    }
  };
  for (const n of adj.keys()) emit(n);
  return { model, stockNames: model.stocks.map((s) => s.name), flowRpn, auxRpn, params, evalOrder };
}

function evalAuxAndFlows(comp: CompiledSD, stocks: Record<string, number>, t: number, overrideParam?: string, overrideValue?: number): { flows: Record<string, number>; aux: Record<string, number> } {
  const scope: Record<string, number> = { ...comp.params, ...stocks, t };
  if (overrideParam) scope[overrideParam] = overrideValue ?? 0;
  const aux: Record<string, number> = {};
  const flows: Record<string, number> = {};
  for (const node of comp.evalOrder) {
    const v = evalRpn(node.rpn, scope);
    scope[node.name] = v;
    if (node.kind === 'flow') flows[node.name] = v;
    else aux[node.name] = v;
  }
  return { flows, aux };
}

/** Net rate of change of each stock given current state. */
function stockDerivatives(comp: CompiledSD, stocks: Record<string, number>, t: number, overrideParam?: string, overrideValue?: number): Record<string, number> {
  const d: Record<string, number> = {};
  for (const name of comp.stockNames) d[name] = 0;
  const { flows } = evalAuxAndFlows(comp, stocks, t, overrideParam, overrideValue);
  for (const f of comp.model.flows) {
    const rate = flows[f.name]!;
    if (f.to) d[f.to] = (d[f.to] ?? 0) + rate;
    if (f.from) d[f.from] = (d[f.from] ?? 0) - rate;
    // A flow with neither from nor to contributes nowhere (documented).
  }
  return d;
}

export function simulateSD(model: SDModel, settings: SDSimSettings, paramOverride?: { name: string; value: number }): SDSeries {
  const comp = compileModel(model);
  const { dt, method } = settings;
  const steps = Math.max(1, Math.round((settings.tStop - settings.tStart) / dt));
  const stocks: Record<string, number> = {};
  const initScope: Record<string, number> = { ...comp.params, t: settings.tStart };
  for (const s of model.stocks) stocks[s.name] = evalRpn(parseExpression(s.initial, [...comp.stockNames, ...model.flows.map((f) => f.name), ...model.auxiliaries.map((a) => a.name), ...model.parameters.map((p) => p.name), 't']), initScope);

  const series: SDSeries = { t: [], stocks: {}, flows: {}, auxiliaries: {} };
  for (const name of comp.stockNames) series.stocks[name] = [];
  for (const f of model.flows) series.flows[f.name] = [];
  for (const a of model.auxiliaries) series.auxiliaries[a.name] = [];

  const ov = paramOverride;
  const deriv = (st: Record<string, number>, t: number) => stockDerivatives(comp, st, t, ov?.name, ov?.value);

  let t = settings.tStart;
  for (let i = 0; i <= steps; i++) {
    const { flows, aux } = evalAuxAndFlows(comp, stocks, t, ov?.name, ov?.value);
    series.t.push(t);
    for (const name of comp.stockNames) series.stocks[name]!.push(stocks[name]!);
    for (const f of model.flows) series.flows[f.name]!.push(flows[f.name] ?? 0);
    for (const a of model.auxiliaries) series.auxiliaries[a.name]!.push(aux[a.name] ?? 0);
    if (i === steps) break;
    if (method === 'rk4') {
      const k1 = deriv(stocks, t);
      const s2: Record<string, number> = {};
      for (const n of comp.stockNames) s2[n] = stocks[n]! + (dt / 2) * k1[n]!;
      const k2 = deriv(s2, t + dt / 2);
      const s3: Record<string, number> = {};
      for (const n of comp.stockNames) s3[n] = stocks[n]! + (dt / 2) * k2[n]!;
      const k3 = deriv(s3, t + dt / 2);
      const s4: Record<string, number> = {};
      for (const n of comp.stockNames) s4[n] = stocks[n]! + dt * k3[n]!;
      const k4 = deriv(s4, t + dt);
      for (const n of comp.stockNames) stocks[n] = stocks[n]! + (dt / 6) * (k1[n]! + 2 * k2[n]! + 2 * k3[n]! + k4[n]!);
    } else {
      const k1 = deriv(stocks, t);
      for (const n of comp.stockNames) stocks[n] = stocks[n]! + dt * k1[n]!;
    }
    t = settings.tStart + (i + 1) * dt;
  }
  return series;
}

/** Parameter sweep: one series per value of `paramName` (bounded count). */
export function sweepSD(model: SDModel, settings: SDSimSettings, paramName: string, values: number[]): SDSeries[] {
  if (values.length > 25) throw new Error('Parameter sweep supports at most 25 values');
  return values.map((v) => simulateSD(model, settings, { name: paramName, value: v }));
}

// ---- Causal loops and dominance ---------------------------------------------

export interface CausalLink { from: string; to: string; polarity: 1 | -1 }

/** Derive causal links from the model structure: stock -> its flows (negative
 * drain / positive fill), flow -> variables it references (positive), unless
 * explicit links are provided in the model. */
export function deriveCausalLinks(model: SDModel): CausalLink[] {
  if (model.links && model.links.length) return model.links;
  const links: CausalLink[] = [];
  const varNames = new Set([...model.flows.map((f) => f.name), ...model.auxiliaries.map((a) => a.name), ...model.parameters.map((p) => p.name)]);
  const varDeps = (rpn: string[]): string[] => rpn.filter((t) => t.startsWith('v:')).map((t) => t.slice(2));
  for (const f of model.flows) {
    const rpn = parseExpression(f.expr, [...model.stocks.map((s) => s.name), ...varNames, 't']);
    for (const d of varDeps(rpn)) links.push({ from: d, to: f.name, polarity: 1 });
    if (f.to) links.push({ from: f.name, to: f.to, polarity: 1 });
    if (f.from) links.push({ from: f.name, to: f.from, polarity: -1 });
  }
  return links;
}

export interface SDLoop {
  nodes: string[];
  /** Product of polarities around the loop: +1 reinforcing, -1 balancing. */
  sign: 1 | -1;
}

/** Detect feedback loops over the causal graph (simple cycles up to length 6,
 * deduplicated by rotation). */
export function findLoops(model: SDModel, maxLen = 6): SDLoop[] {
  const links = deriveCausalLinks(model);
  const adj = new Map<string, Array<{ to: string; polarity: 1 | -1 }>>();
  for (const l of links) {
    const list = adj.get(l.from) ?? [];
    list.push({ to: l.to, polarity: l.polarity });
    adj.set(l.from, list);
  }
  const loops: SDLoop[] = [];
  const seen = new Set<string>();
  const dfs = (start: string, node: string, path: string[], sign: number, depth: number) => {
    if (depth > maxLen) return;
    for (const e of adj.get(node) ?? []) {
      if (e.to === start && path.length >= 2) {
        const key = [...path].sort().join('>');
        if (!seen.has(key)) {
          seen.add(key);
          loops.push({ nodes: [...path], sign: (sign * e.polarity) as 1 | -1 });
        }
        continue;
      }
      if (path.includes(e.to)) continue;
      dfs(start, e.to, [...path, e.to], sign * e.polarity, depth + 1);
    }
  };
  for (const n of adj.keys()) dfs(n, n, [n], 1, 1);
  return loops.slice(0, 24);
}

export interface LoopDominance {
  loop: SDLoop;
  /** Relative loop gain magnitude in three time windows (start/mid/end),
   * computed as the one-step sensitivity of the loop's net stock change to a
   * small perturbation of that stock (documented heuristic). */
  gain: { start: number; mid: number; end: number };
}

/** One-step loop-dominance heuristic: for each detected reinforcing/balancing
 * loop, perturb the first stock in the loop by +1% of its current value and
 * measure the induced change in the loop stock's net derivative one step
 * later. Reported per time window as |d(rate)/d(stock)| * stock / rate. */
export function loopDominance(model: SDModel, settings: SDSimSettings): LoopDominance[] {
  const comp = compileModel(model);
  const loops = findLoops(model);
  const out: LoopDominance[] = [];
  // baseline run for stock trajectories
  const base = simulateSD(model, settings);
  const n = base.t.length;
  const windows = [0, Math.floor((n - 1) / 2), n - 1];
  for (const loop of loops) {
    const stockName = loop.nodes.find((nd) => comp.stockNames.includes(nd));
    if (!stockName) continue;
    const gain = { start: 0, mid: 0, end: 0 };
    windows.forEach((wi, wn) => {
      const t = base.t[wi]!;
      const stocks: Record<string, number> = {};
      for (const sn of comp.stockNames) stocks[sn] = seriesAt(base.stocks[sn]!, wi);
      const d0 = stockDerivatives(comp, stocks, t);
      const eps = Math.abs(stocks[stockName]!) * 0.01 || 0.01;
      const pert: Record<string, number> = { ...stocks, [stockName]: stocks[stockName]! + eps };
      const d1 = stockDerivatives(comp, pert, t);
      const dd = (d1[stockName]! - d0[stockName]!);
      const denom = Math.abs(d0[stockName]!) * (eps / Math.max(Math.abs(stocks[stockName]!), 1e-12)) || 1e-12;
      const g = Math.abs(dd) / denom;
      const key = wn === 0 ? 'start' : wn === 1 ? 'mid' : 'end';
      gain[key as keyof typeof gain] = g;
    });
    out.push({ loop, gain });
  }
  return out;
}

function seriesAt(arr: number[], i: number): number {
  return arr[Math.min(i, arr.length - 1)]!;
}

// ---- Built-in templates -------------------------------------------------------

export type SDTemplateId = 'logistic' | 'lotka-volterra' | 'supply-chain' | 'climate-carbon' | 'bass';

export const SD_TEMPLATE_LABEL: Record<SDTemplateId, { en: string; zh: string }> = {
  logistic: { en: 'Logistic population', zh: '逻辑斯蒂人口' },
  'lotka-volterra': { en: 'Predator-prey (Lotka-Volterra)', zh: '捕食者-猎物（Lotka-Volterra）' },
  'supply-chain': { en: 'Supply chain (2-stage)', zh: '供应链（两级库存）' },
  'climate-carbon': { en: 'Climate carbon (2-box)', zh: '气候碳循环（两箱模型）' },
  bass: { en: 'Business growth (Bass diffusion)', zh: '业务增长（Bass 扩散）' },
};

export function templateModel(id: SDTemplateId): SDModel {
  switch (id) {
    case 'logistic':
      return {
        stocks: [{ name: 'population', initial: '10' }],
        flows: [{ name: 'growth', to: 'population', expr: 'r * population * (1 - population / K)' }],
        auxiliaries: [],
        parameters: [{ name: 'r', value: 0.5 }, { name: 'K', value: 1000 }],
      };
    case 'lotka-volterra':
      return {
        stocks: [
          { name: 'prey', initial: '40' },
          { name: 'predator', initial: '9' },
        ],
        flows: [
          { name: 'preyGrowth', to: 'prey', expr: 'alpha * prey' },
          { name: 'preyKilled', from: 'prey', to: 'predator', expr: 'beta * prey * predator' },
          { name: 'predatorDeath', from: 'predator', expr: 'gamma * predator' },
        ],
        auxiliaries: [],
        parameters: [{ name: 'alpha', value: 0.6 }, { name: 'beta', value: 0.05 }, { name: 'gamma', value: 0.4 }],
      };
    case 'supply-chain':
      return {
        stocks: [
          { name: 'inventory', initial: '50' },
          { name: 'supplierInventory', initial: '80' },
        ],
        flows: [
          { name: 'demand', from: 'inventory', expr: 'min(baseDemand, inventory * 5)' },
          { name: 'reorder', to: 'inventory', from: 'supplierInventory', expr: 'max(0, targetInventory - inventory) / delay' },
          { name: 'production', to: 'supplierInventory', expr: 'max(0, targetSupplier - supplierInventory) / delay' },
        ],
        auxiliaries: [
          { name: 'targetInventory', expr: 'baseDemand * coverWeeks' },
          { name: 'targetSupplier', expr: 'baseDemand * coverWeeks + reorder * delay' },
        ],
        parameters: [
          { name: 'baseDemand', value: 10 },
          { name: 'coverWeeks', value: 6 },
          { name: 'delay', value: 3 },
        ],
      };
    case 'climate-carbon':
      return {
        stocks: [
          { name: 'atmosphere', initial: '850' },
          { name: 'ocean', initial: '38000' },
        ],
        flows: [
          { name: 'emissions', to: 'atmosphere', expr: 'emissionRate' },
          { name: 'uptake', from: 'atmosphere', to: 'ocean', expr: 'k * (atmosphere - 590)' },
          { name: 'outgas', from: 'ocean', to: 'atmosphere', expr: 'k2 * max(0, ocean - 38000)' },
          { name: 'sink', from: 'atmosphere', expr: 'sinkRate * atmosphere' },
        ],
        auxiliaries: [],
        parameters: [
          { name: 'emissionRate', value: 10 },
          { name: 'k', value: 0.005 },
          { name: 'k2', value: 0.002 },
          { name: 'sinkRate', value: 0.003 },
        ],
      };
    case 'bass':
      return {
        stocks: [{ name: 'adopters', initial: '0' }],
        flows: [{ name: 'adoption', to: 'adopters', expr: 'p * (market - adopters) + q * adopters * (market - adopters) / market' }],
        auxiliaries: [],
        parameters: [
          { name: 'p', value: 0.03 },
          { name: 'q', value: 0.38 },
          { name: 'market', value: 1000 },
        ],
      };
  }
}
