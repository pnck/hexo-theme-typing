"use strict";
// Add special link mark to link-only pages

hexo.extend.filter.register("before_post_render", (data) => {
  if (data.link && data.link.length > 0) {
    data.title = "⧉ " + data.title;
    data.portal = data.link;
  }
  return data;
});
