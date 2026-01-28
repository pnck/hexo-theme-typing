'use strict';
// Manually convert any break lines into <br> tags

hexo.extend.filter.register('before_post_render', (data) => {
  data.content = data.content.replace(/(^ *$\n){2}/gm, '\n<br>\n\n').replace(/(?<=\S)$/gm, ' '.repeat(2));
  return data;
});