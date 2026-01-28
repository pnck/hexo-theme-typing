'use strict';
// Hide draft blocks from the final output

// {% draft %}
// (Content that will be stripped from the rendered HTML)
// {% enddraft %}

function parseTagDraft(args, content) {
  content = '';
}

hexo.extend.tag.register('draft', parseTagDraft, { ends: true });