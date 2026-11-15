// The product document also feeds the print generator, so keep its fenced
// gallery/card source format and render the same data as semantic web content.
export function researchBlocks(md) {
  const renderFence = md.renderer.rules.fence;
  const escape = md.utils.escapeHtml;

  md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const kind = token.info.trim();
    if (kind !== 'gallery' && kind !== 'card') {
      return renderFence(tokens, index, options, env, renderer);
    }

    const lines = token.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (kind === 'gallery') {
      const items = lines.map((line) => {
        const separator = line.indexOf('|');
        if (separator < 1) return null;
        const src = line.slice(0, separator).trim();
        const caption = line.slice(separator + 1).trim();
        return src && caption && md.validateLink(src) ? { src, caption } : null;
      });
      // Preserve malformed source as a code block instead of silently losing it.
      if (!items.length || items.some((item) => !item)) {
        return renderFence(tokens, index, options, env, renderer);
      }
      return `<div class="research-gallery">\n${items.map(({ src, caption }) =>
        `<figure><img src="${escape(src)}" alt="${escape(caption)}" loading="lazy"><figcaption>${escape(caption)}</figcaption></figure>`
      ).join('\n')}\n</div>\n`;
    }

    if (!lines.length) return renderFence(tokens, index, options, env, renderer);
    const [title, ...rows] = lines;
    const definitions = rows.map((row) => {
      const separator = row.indexOf('｜');
      return separator > 0
        ? `<div><dt>${escape(row.slice(0, separator).trim())}</dt><dd>${md.renderInline(row.slice(separator + 1).trim(), env)}</dd></div>`
        : `<div><dd>${md.renderInline(row, env)}</dd></div>`;
    }).join('\n');
    return `<aside class="research-card"><p class="research-card-title">${escape(title)}</p><dl>${definitions}</dl></aside>\n`;
  };
}
