// ==========================================================================
// automata — pure kernel
//
// Regular expression → Thompson NFA → subset-construction DFA → Moore
// minimisation. Matching is full-strip ASCII simulation. The supported regex
// subset is literals, `.`, `|`, concatenation, `?`, `*`, `+`, parentheses and
// single-character classes (`[abc]`, `[a-z]`).
// ==========================================================================

export type RegexNode =
  | { kind: 'empty' }
  | { kind: 'char'; char: string }
  | { kind: 'any' }
  | { kind: 'class'; chars: string[] }
  | { kind: 'concat'; items: RegexNode[] }
  | { kind: 'alt'; options: RegexNode[] }
  | { kind: 'star'; child: RegexNode }
  | { kind: 'plus'; child: RegexNode }
  | { kind: 'opt'; child: RegexNode };

/** Sentinel standing for "any character not otherwise in the alphabet". */
export const OTHER_CHAR = '\u0000';

export class RegexError extends Error {}

export function parseRegex(pattern: string): RegexNode {
  let pos = 0;
  const peek = (): string | undefined => pattern[pos];
  const eat = (): string => pattern[pos++]!;

  function parseAlt(): RegexNode {
    const options = [parseConcat()];
    while (peek() === '|') {
      eat();
      options.push(parseConcat());
    }
    return options.length === 1 ? options[0]! : { kind: 'alt', options };
  }

  function parseConcat(): RegexNode {
    const items: RegexNode[] = [];
    while (pos < pattern.length && peek() !== '|' && peek() !== ')') items.push(parseRepeat());
    if (items.length === 0) return { kind: 'empty' };
    return items.length === 1 ? items[0]! : { kind: 'concat', items };
  }

  function parseRepeat(): RegexNode {
    let node = parseAtom();
    for (;;) {
      const c = peek();
      if (c === '*') {
        eat();
        node = { kind: 'star', child: node };
      } else if (c === '+') {
        eat();
        node = { kind: 'plus', child: node };
      } else if (c === '?') {
        eat();
        node = { kind: 'opt', child: node };
      } else break;
    }
    return node;
  }

  function parseAtom(): RegexNode {
    const c = peek();
    if (c === undefined) throw new RegexError('Unexpected end of pattern.');
    if (c === '(') {
      eat();
      const inner = parseAlt();
      if (peek() !== ')') throw new RegexError('Missing closing parenthesis.');
      eat();
      return inner;
    }
    if (c === '[') return parseClass();
    if (c === '.') {
      eat();
      return { kind: 'any' };
    }
    if (c === '\\') {
      eat();
      const next = eat();
      if (next === undefined) throw new RegexError('Trailing backslash.');
      return { kind: 'char', char: next };
    }
    if (c === '*' || c === '+' || c === '?' || c === '|' || c === ')') {
      throw new RegexError(`Unexpected "${c}" at position ${pos}.`);
    }
    eat();
    return { kind: 'char', char: c };
  }

  function parseClass(): RegexNode {
    eat();
    const chars = new Set<string>();
    let negate = false;
    if (peek() === '^') {
      negate = true;
      eat();
    }
    while (pos < pattern.length && peek() !== ']') {
      let first = eat();
      if (first === '\\') first = eat() ?? '';
      if (peek() === '-' && pattern[pos + 1] !== ']' && pattern[pos + 1] !== undefined) {
        eat();
        let last = eat();
        if (last === '\\') last = eat() ?? '';
        for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code += 1) chars.add(String.fromCharCode(code));
      } else {
        chars.add(first);
      }
    }
    if (peek() !== ']') throw new RegexError('Missing closing bracket in character class.');
    eat();
    if (negate) {
      const all = new Set<string>();
      for (let code = 32; code < 127; code += 1) {
        const ch = String.fromCharCode(code);
        if (!chars.has(ch)) all.add(ch);
      }
      return { kind: 'class', chars: [...all] };
    }
    return { kind: 'class', chars: [...chars] };
  }

  const ast = parseAlt();
  if (pos < pattern.length) throw new RegexError(`Unexpected "${pattern[pos]}" at position ${pos}.`);
  return ast;
}

// ---- Thompson NFA -----------------------------------------------------------

export interface NfaTransition {
  /** Explicit characters; empty + any = wildcard. */
  chars: string[];
  any: boolean;
  to: number;
}

export interface NfaState {
  eps: number[];
  out: NfaTransition[];
}

export interface Nfa {
  states: NfaState[];
  start: number;
  accept: number;
  alphabet: string[];
}

interface Fragment {
  start: number;
  end: number;
}

export function buildNfa(ast: RegexNode): Nfa {
  const states: NfaState[] = [];
  const literals = new Set<string>();
  const fresh = (): number => {
    states.push({ eps: [], out: [] });
    return states.length - 1;
  };

  const build = (node: RegexNode): Fragment => {
    switch (node.kind) {
      case 'empty': {
        const start = fresh();
        const end = fresh();
        states[start]!.eps.push(end);
        return { start, end };
      }
      case 'char': {
        literals.add(node.char);
        const start = fresh();
        const end = fresh();
        states[start]!.out.push({ chars: [node.char], any: false, to: end });
        return { start, end };
      }
      case 'any': {
        const start = fresh();
        const end = fresh();
        states[start]!.out.push({ chars: [], any: true, to: end });
        return { start, end };
      }
      case 'class': {
        for (const c of node.chars) literals.add(c);
        const start = fresh();
        const end = fresh();
        states[start]!.out.push({ chars: node.chars, any: false, to: end });
        return { start, end };
      }
      case 'concat': {
        if (node.items.length === 0) return build({ kind: 'empty' });
        let frag = build(node.items[0]!);
        for (let i = 1; i < node.items.length; i += 1) {
          const next = build(node.items[i]!);
          states[frag.end]!.eps.push(next.start);
          frag = { start: frag.start, end: next.end };
        }
        return frag;
      }
      case 'alt': {
        const start = fresh();
        const end = fresh();
        for (const option of node.options) {
          const frag = build(option);
          states[start]!.eps.push(frag.start);
          states[frag.end]!.eps.push(end);
        }
        return { start, end };
      }
      case 'star': {
        const start = fresh();
        const end = fresh();
        const child = build(node.child);
        states[start]!.eps.push(child.start, end);
        states[child.end]!.eps.push(child.start, end);
        return { start, end };
      }
      case 'plus': {
        const start = fresh();
        const end = fresh();
        const child = build(node.child);
        states[start]!.eps.push(child.start);
        states[child.end]!.eps.push(child.start, end);
        return { start, end };
      }
      case 'opt': {
        const start = fresh();
        const end = fresh();
        const child = build(node.child);
        states[start]!.eps.push(child.start, end);
        states[child.end]!.eps.push(end);
        return { start, end };
      }
    }
  };

  const frag = build(ast);
  const alphabet = [...literals].sort();
  alphabet.push(OTHER_CHAR);
  return { states, start: frag.start, accept: frag.end, alphabet };
}

export function epsilonClosure(nfa: Nfa, states: Iterable<number>): Set<number> {
  const out = new Set<number>();
  const stack: number[] = [];
  for (const s of states) {
    if (!out.has(s)) {
      out.add(s);
      stack.push(s);
    }
  }
  while (stack.length > 0) {
    const s = stack.pop()!;
    for (const to of nfa.states[s]!.eps) {
      if (!out.has(to)) {
        out.add(to);
        stack.push(to);
      }
    }
  }
  return out;
}

// ---- DFA --------------------------------------------------------------------

export interface DfaState {
  id: number;
  /** NFA state subsets, kept for inspection. */
  nfaStates: number[];
  accept: boolean;
  trans: Record<string, number>;
}

export interface Dfa {
  states: DfaState[];
  start: number;
  accept: number[];
  alphabet: string[];
}

const keyOf = (set: Iterable<number>): string => [...set].sort((a, b) => a - b).join(',');

export function subsetConstruction(nfa: Nfa): Dfa {
  const startSet = epsilonClosure(nfa, [nfa.start]);
  const index = new Map<string, number>([[keyOf(startSet), 0]]);
  const sets: Set<number>[] = [startSet];
  const states: DfaState[] = [];
  const queue = [0];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const set = sets[id]!;
    const trans: Record<string, number> = {};
    for (const symbol of nfa.alphabet) {
      const moved = new Set<number>();
      for (const s of set) {
        for (const t of nfa.states[s]!.out) {
          const matches = t.any || (symbol === OTHER_CHAR ? !t.chars.length : t.chars.includes(symbol));
          if (matches) moved.add(t.to);
        }
      }
      if (moved.size === 0) continue;
      const closure = epsilonClosure(nfa, moved);
      const key = keyOf(closure);
      let target = index.get(key);
      if (target === undefined) {
        target = sets.length;
        index.set(key, target);
        sets.push(closure);
        queue.push(target);
      }
      trans[symbol] = target;
    }
    states.push({
      id,
      nfaStates: [...set].sort((a, b) => a - b),
      accept: set.has(nfa.accept),
      trans,
    });
  }
  return {
    states,
    start: 0,
    accept: states.filter((s) => s.accept).map((s) => s.id),
    alphabet: nfa.alphabet,
  };
}

/** Moore partition refinement over a partial DFA (missing transition = dead). */
export function minimiseDfa(dfa: Dfa): Dfa {
  const n = dfa.states.length;
  if (n === 0) return dfa;
  let block = new Array<number>(n).fill(0);
  // Initial partition: accepting vs non-accepting.
  const acceptSet = new Set(dfa.accept);
  const first = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const k = acceptSet.has(i) ? 'A' : 'N';
    if (!first.has(k)) first.set(k, first.size);
    block[i] = first.get(k)!;
  }
  for (;;) {
    const signature = new Map<string, number>();
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      const parts = [acceptSet.has(i) ? 'A' : 'N'];
      for (const symbol of dfa.alphabet) {
        const to = dfa.states[i]!.trans[symbol];
        parts.push(to === undefined ? '∅' : String(block[to]));
      }
      const key = parts.join('|');
      if (!signature.has(key)) signature.set(key, signature.size);
      next[i] = signature.get(key)!;
    }
    const changed = next.some((b, i) => b !== block[i]);
    block = next;
    if (!changed) break;
  }
  const count = Math.max(...block) + 1;
  const members: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < n; i += 1) members[block[i]!]!.push(i);
  const states: DfaState[] = members.map((group, id) => {
    const trans: Record<string, number> = {};
    for (const symbol of dfa.alphabet) {
      const to = dfa.states[group[0]!]!.trans[symbol];
      if (to !== undefined) trans[symbol] = block[to]!;
    }
    return {
      id,
      nfaStates: group.flatMap((g) => dfa.states[g]!.nfaStates),
      accept: group.some((g) => acceptSet.has(g)),
      trans,
    };
  });
  return {
    states,
    start: block[dfa.start]!,
    accept: states.filter((s) => s.accept).map((s) => s.id),
    alphabet: dfa.alphabet,
  };
}

export interface AutomataBuild {
  ast: RegexNode;
  nfa: Nfa;
  dfa: Dfa;
  minDfa: Dfa;
}

export function buildAutomata(pattern: string): AutomataBuild {
  const ast = parseRegex(pattern);
  const nfa = buildNfa(ast);
  const dfa = subsetConstruction(nfa);
  const minDfa = minimiseDfa(dfa);
  return { ast, nfa, dfa, minDfa };
}

export interface MatchStep {
  index: number;
  char: string;
  from: number;
  to: number;
  accepted: boolean;
}

export interface MatchResult {
  accepted: boolean;
  steps: MatchStep[];
  /** Index of the first rejected character, or −1. */
  failAt: number;
}

export function matchDfa(dfa: Dfa, input: string): MatchResult {
  const steps: MatchStep[] = [];
  let state = dfa.start;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    const symbol = dfa.alphabet.includes(ch) ? ch : OTHER_CHAR;
    const from = state;
    const to = dfa.states[state]!.trans[symbol];
    if (to === undefined) {
      steps.push({ index: i, char: ch, from, to: -1, accepted: false });
      return { accepted: false, steps, failAt: i };
    }
    state = to;
    steps.push({ index: i, char: ch, from, to, accepted: false });
  }
  const accepted = dfa.accept.includes(state);
  if (steps.length > 0) steps[steps.length - 1]!.accepted = accepted;
  return { accepted, steps, failAt: accepted ? -1 : input.length };
}

/** Simpler, trace-free acceptance test used by tests and benchmarks. */
export function accepts(dfa: Dfa, input: string): boolean {
  let state = dfa.start;
  for (const ch of input) {
    const symbol = dfa.alphabet.includes(ch) ? ch : OTHER_CHAR;
    const to = dfa.states[state]!.trans[symbol];
    if (to === undefined) return false;
    state = to;
  }
  return dfa.accept.includes(state);
}

export interface AutomataBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runAutomataBenchmarks(): AutomataBenchmark[] {
  const star = buildAutomata('a*');
  const abb = buildAutomata('(a|b)*abb');
  const single = buildAutomata('a|a');

  const cases = [
    {
      id: 'thompson-star',
      labelEn: 'Thompson NFA for a* has 4 states',
      labelZh: 'a* 的 Thompson NFA 有 4 个状态',
      measured: star.nfa.states.length,
      expected: 4,
      tol: 0,
    },
    {
      id: 'subset-abb',
      labelEn: '(a|b)*abb minimal DFA has 4 states',
      labelZh: '(a|b)*abb 的最小 DFA 有 4 个状态',
      measured: abb.minDfa.states.length,
      expected: 4,
      tol: 0,
    },
    {
      id: 'dfa-minimise',
      labelEn: 'a|a minimises to 2 states',
      labelZh: 'a|a 最小化为 2 个状态',
      measured: single.minDfa.states.length,
      expected: 2,
      tol: 0,
    },
    {
      id: 'regex-match',
      labelEn: '(a|b)*abb accepts "ababb"',
      labelZh: '(a|b)*abb 接受 "ababb"',
      measured: accepts(abb.dfa, 'ababb') ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'regex-reject',
      labelEn: '(a|b)*abb rejects "aba"',
      labelZh: '(a|b)*abb 拒绝 "aba"',
      measured: accepts(abb.dfa, 'aba') ? 0 : 1,
      expected: 1,
      tol: 0,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}

/** Parse `regex: …` / `test: …` lines or `regex,test` CSV rows. */
export function parseAutomataInput(text: string): { regex: string; tests: string[] } {
  let regex = '';
  const tests: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = /^(regex|pattern|test|input)\s*[:=,]\s*(.*)$/i.exec(line);
    if (kv) {
      if (kv[1]!.toLowerCase() === 'test' || kv[1]!.toLowerCase() === 'input') tests.push(kv[2]!);
      else regex = kv[2]!;
      continue;
    }
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length >= 2) {
      regex = cells[0]!;
      tests.push(cells[1]!);
    }
  }
  return { regex, tests };
}
