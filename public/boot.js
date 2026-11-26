// Pre-hydration: apply saved theme/language to avoid flash of wrong theme.
// Kept as an external classic script (not inline) so CSP does not need a
// source hash and CRLF/LF differences can never invalidate the policy.
(function () {
  try {
    var theme = localStorage.getItem('ergalics:theme');
    // First visit defaults to the instrument-console dark look — must
    // match src/theme/index.ts detectInitialPreference() or the app
    // paints light and then snaps to dark after hydration.
    var resolved = 'dark';
    if (theme === 'dark' || theme === 'light') {
      resolved = theme;
    } else if (theme === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    document.documentElement.dataset.theme = resolved;
    var lang = localStorage.getItem('ergalics:lang') || 'zh-CN';
    document.documentElement.lang = lang;
  } catch (e) {
    /* noop */
  }
})();
