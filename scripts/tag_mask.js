// {% mask %}
// {% endmask %}

const cheerio = require("cheerio");

function parseTagMask(args, content) {
  const inner = hexo.render.renderSync({ text: content, engine: "markdown" });
  const doc = cheerio.load(inner, {
    xmlMode: true,
    normalizeWhitespace: true,
    decodeEntities: false,
  });
  doc.root().children().addClass("masked");
  doc("a,p,h1,h2,h3,h4,h5,h6").addClass("masked");

  return `<div>
  <style>
  .masked {background-color:#555;color:#555 !important;}
  .masked:hover {color:#FFF !important;}
  a.masked {border:0;}
  a.masked:hover {border-bottom: 1px solid #FFF;}
  </style>
${doc.html()}
</div>`;
}

hexo.extend.tag.register("mask", parseTagMask, { ends: true });
