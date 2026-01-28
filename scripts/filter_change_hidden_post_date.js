'use strict';
// Set date to 1970-01-01 to make sure it's always on the last page

const moment = require('moment-timezone');

hexo.extend.filter.register('before_post_render', (data) => {
  const tags = new Set(data.tags.data.map((tag) => tag.name));
  if (tags.has('hidden') || tags.has('Hidden')) {
    data.date = hexo.config.timezone
      ? moment.tz('1970-01-01', hexo.config.timezone)
      : moment('1970-01-01');
  }
  return data;
});