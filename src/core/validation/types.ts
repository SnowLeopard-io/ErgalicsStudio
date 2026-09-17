// ==========================================================================
// Validation framework — core types
//
// Validation is lazy (all issues are collected in one pass, à la Pandera
// `lazy=True`) and path-addressed (`users[0].email`) so a UI can attach an
// error message to the exact field that produced it and a CLI can print the
// exact failing row/column.
// ==========================================================================

export type IssueSeverity = 'error' | 'warning';

/** Field path segments: object keys (string) and array indices (number). */
export type Path = (string | number)[];

export interface ValidationIssue {
  /** Field path, e.g. ['axes', 0, 'grid', 'steps']. Root issues use []. */
  path: (string | number)[];
  /** Stable machine-readable code, e.g. 'number.min', 'string.pattern'. */
  code: string;
  /** Human-readable explanation (already interpolated, default locale). */
  message: string;
  severity?: IssueSeverity;
  /** The offending value (omitted from serialisation when too large). */
  value?: unknown;
}

/** Render a path as bracket/dot notation: `axes[0].grid.steps`. */
export function formatPath(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out.length === 0 ? segment : `.${segment}`;
  }
  return out;
}

/** Mutable accumulator used by validators; collapses to ValidationResult. */
export class IssueBag {
  readonly issues: ValidationIssue[] = [];

  add(issue: ValidationIssue): void {
    this.issues.push(issue);
  }

  addAt(
    path: (string | number)[],
    code: string,
    message: string,
    severity: IssueSeverity = 'error',
    value?: unknown,
  ): void {
    this.issues.push({ path, code, message, severity, ...(value === undefined ? {} : { value }) });
  }

  /** Merge nested validator issues under `prefix`. */
  merge(prefix: (string | number)[], issues: ReadonlyArray<ValidationIssue>): void {
    for (const issue of issues) {
      this.issues.push({
        ...issue,
        path: [...prefix, ...issue.path],
      });
    }
  }

  get length(): number {
    return this.issues.length;
  }

  errors(): ValidationIssue[] {
    return this.issues.filter((i) => i.severity !== 'warning');
  }

  warnings(): ValidationIssue[] {
    return this.issues.filter((i) => i.severity === 'warning');
  }

  /** First issue at or below `path` (exact prefix match). */
  at(path: ReadonlyArray<string | number>): ValidationIssue | undefined {
    return this.issues.find((issue) =>
      path.every((segment, i) => issue.path[i] === segment),
    );
  }
}

export interface ValidationResult<T = unknown> {
  readonly valid: boolean;
  readonly issues: ReadonlyArray<ValidationIssue>;
  readonly errors: ReadonlyArray<ValidationIssue>;
  readonly warnings: ReadonlyArray<ValidationIssue>;
  /** Present on successful `parse` validators. */
  readonly value?: T;
  /** First error/warning at or below the given path. */
  issueAt(path: ReadonlyArray<string | number>): ValidationIssue | undefined;
}

export function toResult<T = unknown>(
  issues: ReadonlyArray<ValidationIssue>,
  value?: T,
): ValidationResult<T> {
  const errors = issues.filter((i) => i.severity !== 'warning');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
    ...(value !== undefined && errors.length === 0 ? { value } : {}),
    issueAt(path) {
      return issues.find((issue) => path.every((segment, i) => issue.path[i] === segment));
    },
  };
}
