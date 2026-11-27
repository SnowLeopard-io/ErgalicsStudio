// ==========================================================================
// Ergalics Studio — causal DAG algorithms (pure TS)
//
// Directed acyclic graphs let a researcher state *which* variables they are
// willing to hold fixed and get a precise answer about identifiability:
//
//   • d-separation answers "are X and Y independent given Z?" in the graph
//     sense (moralised ancestral graph + removed conditioning nodes);
//   • back-door paths enumerate every non-causal route from treatment to
//     outcome, and a set Z is a valid adjustment set iff it blocks them all;
//   • findAdjustmentSets searches the smallest sufficient sets, excluding
//     descendants of the treatment (adjusting for a mediator hides part of the
//     effect instead of deconfounding it).
//
// Everything here is deterministic and dependency-free — the estimator layer
// consumes the sets this module returns.
// ==========================================================================

export interface CausalGraph {
  /** All variable names. Edges may use names not listed here. */
  nodes: string[];
  /** Directed edges [cause, effect]. */
  edges: Array<[string, string]>;
}

interface Adjacency {
  parents: Map<string, Set<string>>;
  children: Map<string, Set<string>>;
}

function adjacency(graph: CausalGraph): Adjacency {
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  const ensure = (key: string): void => {
    if (!parents.has(key)) parents.set(key, new Set());
    if (!children.has(key)) children.set(key, new Set());
  };
  for (const node of graph.nodes) ensure(node);
  for (const [from, to] of graph.edges) {
    ensure(from);
    ensure(to);
    children.get(from)!.add(to);
    parents.get(to)!.add(from);
  }
  return { parents, children };
}

/** All ancestors of `start` (excluding the starting nodes themselves). */
export function ancestors(graph: CausalGraph, start: Iterable<string>): Set<string> {
  const { parents } = adjacency(graph);
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const parent of parents.get(node) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push(parent);
    }
  }
  for (const node of start) seen.delete(node);
  return seen;
}

/** All descendants of `start` (excluding the starting nodes themselves). */
export function descendants(graph: CausalGraph, start: Iterable<string>): Set<string> {
  const { children } = adjacency(graph);
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const child of children.get(node) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  for (const node of start) seen.delete(node);
  return seen;
}

/**
 * Graphical d-separation: `X ⟂ Y | Z`.
 *
 * Build the ancestral graph of {X,Y}∪Z, moralise every collider (marry the
 * parents of each node), remove Z, then check undirected connectivity. X and
 * Y are d-separated exactly when no path survives.
 */
export function dSeparated(
  graph: CausalGraph,
  x: string,
  y: string,
  conditioned: Iterable<string> = [],
): boolean {
  const z = new Set(conditioned);
  if (x === y) return false;
  const relevant = new Set<string>([x, y, ...z]);
  for (const node of ancestors(graph, relevant)) relevant.add(node);

  const { parents } = adjacency(graph);
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a)!.add(b);
    links.get(b)!.add(a);
  };
  for (const [from, to] of graph.edges) {
    if (relevant.has(from) && relevant.has(to)) link(from, to);
  }
  for (const node of relevant) {
    const ps = [...(parents.get(node) ?? [])].filter((p) => relevant.has(p));
    for (let i = 0; i < ps.length; i += 1) {
      for (let j = i + 1; j < ps.length; j += 1) link(ps[i]!, ps[j]!);
    }
  }

  const seen = new Set<string>([x]);
  const queue = [x];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === y) return false;
    for (const next of links.get(node) ?? []) {
      if (seen.has(next) || z.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return true;
}

export interface BackdoorPath {
  /** Nodes from treatment to outcome, inclusive. */
  nodes: string[];
  /** True when a conditioning set blocks this path. */
  blockedBy: (conditioning: ReadonlySet<string>) => boolean;
}

function isColliderAt(
  adjacencyData: Adjacency,
  prev: string,
  node: string,
  next: string,
): boolean {
  const intoNodeFromPrev = adjacencyData.children.get(prev)?.has(node) ?? false;
  const intoNodeFromNext = adjacencyData.children.get(next)?.has(node) ?? false;
  return intoNodeFromPrev && intoNodeFromNext;
}

/**
 * Enumerate simple undirected paths from `treatment` to `outcome` whose first
 * edge points *into* the treatment (i.e. non-causal back-door routes).
 * `blockedBy` implements the standard non-collider/collider rules.
 */
export function backdoorPaths(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  limit = 256,
): BackdoorPath[] {
  const adj = adjacency(graph);
  const paths: BackdoorPath[] = [];
  const visit = (path: string[]): void => {
    if (paths.length >= limit) return;
    const current = path[path.length - 1]!;
    if (current === outcome) {
      // A non-collider blocks the path when it IS conditioned on; a collider
      // blocks it when NEITHER the collider nor any descendant is conditioned.
      const segments: Array<{ kind: 'noncollider'; node: string } | { kind: 'collider'; openers: Set<string> }> = [];
      for (let i = 1; i < path.length - 1; i += 1) {
        const prev = path[i - 1]!;
        const node = path[i]!;
        const next = path[i + 1]!;
        if (isColliderAt(adj, prev, node, next)) {
          segments.push({
            kind: 'collider',
            openers: new Set<string>([node, ...descendants(graph, [node])]),
          });
        } else {
          segments.push({ kind: 'noncollider', node });
        }
      }
      paths.push({
        nodes: [...path],
        blockedBy: (conditioning) =>
          segments.some((segment) =>
            segment.kind === 'noncollider'
              ? conditioning.has(segment.node)
              : ![...segment.openers].some((node) => conditioning.has(node)),
          ),
      });
      return;
    }
    const neighbors = new Set<string>([
      ...(adj.parents.get(current) ?? []),
      ...(adj.children.get(current) ?? []),
    ]);
    for (const next of neighbors) {
      if (path.includes(next)) continue;
      // A back-door path must leave the treatment through a parent.
      if (current === treatment && !(adj.children.get(next)?.has(treatment) ?? false)) continue;
      visit([...path, next]);
      if (paths.length >= limit) return;
    }
  };
  visit([treatment]);
  return paths;
}

/** True when `set` blocks every back-door path (the back-door criterion). */
export function satisfiesBackdoor(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  set: Iterable<string>,
): boolean {
  const conditioning = new Set(set);
  const paths = backdoorPaths(graph, treatment, outcome);
  return paths.every((path) => path.blockedBy(conditioning));
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const choose = (start: number, acc: T[]): void => {
    if (acc.length === size) {
      result.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      acc.push(items[i]!);
      choose(i + 1, acc);
      acc.pop();
    }
  };
  choose(0, []);
  return result;
}

/**
 * Smallest valid adjustment sets. Descendants of the treatment are never
 * candidates (they are mediators/colliders, not confounders).
 */
export function findAdjustmentSets(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  options: { maxSize?: number; limit?: number } = {},
): string[][] {
  const banned = descendants(graph, [treatment]);
  const candidates = graph.nodes.filter(
    (node) => node !== treatment && node !== outcome && !banned.has(node),
  );
  const maxSize = Math.min(options.maxSize ?? 3, candidates.length);
  const limit = options.limit ?? 12;
  for (let size = 0; size <= maxSize; size += 1) {
    const found: string[][] = [];
    for (const combo of combinations(candidates, size)) {
      if (satisfiesBackdoor(graph, treatment, outcome, combo)) {
        found.push(combo);
        if (found.length >= limit) break;
      }
    }
    if (found.length > 0) return found;
  }
  return [];
}
