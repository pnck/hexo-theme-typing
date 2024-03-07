"use strict";
// Add special link mark to link-only pages

hexo.extend.filter.register("before_post_render", (data) => {
  const tags = new Set(data.tags.data.map((tag) => tag.name));

  if (data.link && data.link.length > 0) {
    data.title = "⧉ " + data.title;
    data.portal = data.link;
    if (!tags.has("Portal")) {
      hexo.log.warn(`Post "${data.source}" is a link-only page but not tagged with "Portal"!`);
    }
  }
  return data;
});
