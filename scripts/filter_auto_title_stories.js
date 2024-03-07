"use strict";
// Add "Story -" prefix to stories' title

hexo.extend.filter.register("before_post_render", (data) => {
  const tags = new Set(data.tags.data.map((tag) => tag.name));
  if (tags.has("Story")) {
    data.title = "Story - " + data.title;
  }
  return data;
});
