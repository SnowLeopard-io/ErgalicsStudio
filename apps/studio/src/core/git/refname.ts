// ==========================================================================
// Ergalics Studio — git ref-name validation (git-check-ref-format subset)
//
// Branch/tag names come from UI inputs and flow straight into git APIs. In
// the Node adapter they land in the raw argv array (git.raw / git.log /
// git.revparse), where a name starting with '-' is parsed as an OPTION —
// argument injection (`-c core.pager=…`, `--upload-pack=…`). Every adapter
// entry point that accepts a ref validates it here first, so a bad name
// fails with a clear error instead of reaching git.
// ==========================================================================

/**
 * A name git would accept as a branch/tag and that can never be mistaken
 * for a command-line option. Implements the git-check-ref-format rules that
 * matter for single ref names (see gittutorial / git-check-ref-format(1)):
 * no leading '-', '/', or '.'; no ASCII controls/space/~^:?*[\; no '..',
 * '@{', '//', or '/.'; no trailing '.', '/', or '.lock'.
 */
export function isValidGitRef(name: string): boolean {
  if (!name || name.startsWith('-') || name.startsWith('/') || name.startsWith('.')) return false;
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//') || name.includes('/.')) {
    return false;
  }
  if (name === '@') return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\s~^:?*[\]\\]/.test(name)) return false;
  return true;
}

/** Throwing variant for adapter/store entry points. */
export function assertValidGitRef(name: string, what = 'ref'): void {
  if (!isValidGitRef(name)) {
    throw new Error(
      `git: invalid ${what} name ${JSON.stringify(name)} — names must follow ` +
        'git-check-ref-format rules and must not start with "-"',
    );
  }
}
