'use strict';
// {% fold h1 title with space.. %}
// {% fold inline text foldable %}
// {% endfold %}

const { log } = hexo;

function parseTagFold(args, content) {
  if (/[hH][1-6]/.test(args[0])) {
    // title
    const title = args.slice(1).join(' ');
    const H = args[0];
    // log.debug("?=>", title);
    let renderedTitle = hexo.render.renderSync({ text: `${'#'.repeat(H[1])} ${title}`, engine: 'markdown' });
    // <h? id="title">title</h?>
    renderedTitle = renderedTitle.replace(/<h[1-6]/, `<${H} class="foldable folded"`);
    return `${renderedTitle}<div class="fold-content">\n${hexo.render.renderSync({ text: content, engine: 'markdown' })}</div>\n`;
  } else {
    // inline
    const text = args.join(' ');
    return `<p class="foldable folded">${text}</p>\n<div class="fold-content">\n${hexo.render.renderSync({
      text: content,
      engine: 'markdown',
    })}</div>\n`;
  }
}

hexo.extend.tag.register('fold', parseTagFold, { ends: true });