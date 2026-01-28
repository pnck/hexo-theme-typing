'use strict';
// Raise error if draft is mistakenly published
hexo.extend.filter.register('before_post_render', (data) => {
  const tags = new Set(data.tags.data.map((tag) => tag.name));
  if (tags.has('Draft')) {
    throw new Error('Draft is mistakenly published: ' + data.source);
  }
  return data;
});