'use strict';
// {% mask %}
// {% endmask %}
// {% inlinemask %}
// {% endinlinemask %}

function parseTagMask(args, content) {
  const inner = hexo.render.renderSync({ text: content, engine: 'markdown' });
  /*
  const cheerio = require("cheerio");
  const doc = cheerio.load(inner, {
    xmlMode: true,
    normalizeWhitespace: true,
    decodeEntities: false,
  });
  doc.root().children().addClass("masked");
  doc("a,p,h1,h2,h3,h4,h5,h6").addClass("masked");
  */

  return `<div class="masked" style="display: contents">
${inner}
</div>`;
}

hexo.extend.tag.register('mask', parseTagMask, { ends: true });
hexo.extend.tag.register(
  'inlinemask',
  (args, content) => {
    return `<span class="masked">${content.trim()}</span>`;
  },
  { ends: true }
);