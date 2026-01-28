'use strict';
const fs = require('fs');
const path = require('path');
// {% audio src="/path/to/audio.mp3" %}
// {% audio id="asset-id" %}
// {% video src="https://example.com/video.mp4" %}
// {% video id="asset-id" %}
// {% audio_clip src="/path/to/audio.mp3" start="1:23" end="1:45" %}text{% endaudio_clip %}
// {% audio_clip id="asset-id" start="0" end="15" title="片段标题" fade %}
// ============================================
// Workaround: Hexo 的 escapeAllSwigTags 只会处理有对应 end tag 的标签
// 对于非闭合 tag，需要在 before_post_render 阶段手动添加 endaudio 标记
// 这样 Hexo 才会在 markdown 渲染前将其替换为占位符
// ============================================
hexo.extend.filter.register('before_post_render', (data) => {
  // 匹配独立的 {% audio ... %} 和 {% video ... %} (后面没有紧跟对应的 end tag)
  // 为其添加一个空的 end tag 标记
  data.content = data.content.replace(
    /(\{% *audio\b[^%]*%\})(?!\s*\{% *endaudio)/g,
    '$1{% endaudio %}'
  );
  data.content = data.content.replace(
    /(\{% *video\b[^%]*%\})(?!\s*\{% *endvideo)/g,
    '$1{% endvideo %}'
  );
  return data;
}, 5); // 优先级 5，在其他 filter 之前运行

/**
 * 解析时间字符串为秒数
 * 支持格式: "83", "1:23", "1:23.5"
 */
function parseTime(timeStr) {
  if (!timeStr) return 0;
  timeStr = String(timeStr).trim();
  
  if (timeStr.includes(':')) {
    const parts = timeStr.split(':');
    const min = parseInt(parts[0], 10) || 0;
    const sec = parseFloat(parts[1]) || 0;
    return min * 60 + sec;
  }
  return parseFloat(timeStr) || 0;
}

/**
 * 格式化秒数为 m:ss 格式
 */
function formatDuration(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * 解析 tag 参数为对象
 * 支持: key=value, key="value with spaces"
 */
function parseArgs(args) {
  const result = {};
  const argsStr = args.join(' ');
  
  // 匹配 key=value 或 key="value"
  const regex = /(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match;
  
  while ((match = regex.exec(argsStr)) !== null) {
    const key = match[1];
    const value = match[2] || match[3] || match[4];
    result[key] = value;
  }

  // 解析独立标记（例如 fade）
  const flagRegex = /(^|\s)([a-zA-Z][\w-]*)(?=\s|$)/g;
  while ((match = flagRegex.exec(argsStr)) !== null) {
    const key = match[2];
    if (!(key in result)) {
      result[key] = true;
    }
  }
  
  return result;
}

/**
 * 生成简单的路径 hash 作为 ID
 */
function hashPath(path) {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return 'path' + Math.abs(hash).toString(36);
}

/**
 * 判断是否是远程 URL
 */
function isRemoteUrl(src) {
  return typeof src === 'string' && /^(https?:)?\/\//i.test(src);
}

/**
 * 解析本地媒体文件路径
 */
function resolveLocalPathCandidates(hexo, src, context) {
  if (!src) return [];
  if (src.startsWith('/')) {
    return [path.resolve(hexo.source_dir, src.slice(1))];
  }

  const baseDir = context && context.source ? path.dirname(context.source) : '';
  const postName = context && context.source
    ? path.basename(context.source, path.extname(context.source))
    : '';

  const candidates = [];
  if (postName) {
    candidates.push(path.resolve(hexo.source_dir, baseDir, postName, src));
  }
  candidates.push(path.resolve(hexo.source_dir, baseDir, src));
  return candidates;
}

/**
 * 验证本地媒体文件存在
 */
function assertLocalMediaExists(hexo, src, contextLabel, context) {
  if (!src || isRemoteUrl(src)) return;
  const candidates = resolveLocalPathCandidates(hexo, src, context);
  const found = candidates.some((localPath) => fs.existsSync(localPath));
  if (!found) {
    throw new Error(`${contextLabel} local file not found: ${src}`);
  }
}

/**
 * 解析媒体源信息（音频或视频）
 * 优先使用 id 引用 front-matter assets，否则使用 src 直接路径
 */
function resolveMediaSource(params, context) {
  // 优先使用 id 引用
  if (params.id) {
    const assets = context.assets || {};
    const asset = assets[params.id];
    
    if (!asset) {
      throw new Error(`Media asset "${params.id}" not found in front-matter assets`);
    }
    
    const src = typeof asset === 'string' ? asset : asset.src;
    const meta = typeof asset === 'object' ? asset : {};
    
    // 检测媒体类型
    const type = meta.type || detectMediaType(src);
    
    assertLocalMediaExists(hexo, src, `Media asset "${params.id}"`, context);

    return {
      id: params.id,
      src: src,
      type: type,
      title: meta.title || '',
      artist: meta.artist || '',
      poster: meta.poster || '' // 视频封面
    };
  }
  
  // 使用直接路径
  if (params.src) {
    const id = hashPath(params.src);
    const type = detectMediaType(params.src);

    assertLocalMediaExists(hexo, params.src, 'Media src', context);
    
    return {
      id: id,
      src: params.src,
      type: type,
      title: params.title || '',
      artist: '',
      poster: params.poster || ''
    };
  }
  
  throw new Error('Either id or src is required for media tag');
}

/**
 * 检测媒体类型（audio 或 video）
 */
function detectMediaType(src) {
  const audioExts = /\.(mp3|wav|ogg|m4a|flac|aac|webm)$/i;
  const videoExts = /\.(mp4|webm|ogv|mov|m4v)$/i;
  
  if (audioExts.test(src)) return 'audio';
  if (videoExts.test(src)) return 'video';
  
  // URL 默认视为视频（通常在线视频都是 URL）
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return 'video';
  }
  
  return 'audio'; // 默认音频
}

/**
 * 检测是否是 YouTube URL 并提取视频 ID
 */
function parseYouTubeUrl(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * 检测是否是 Vimeo URL 并提取视频 ID
 */
function parseVimeoUrl(url) {
  const pattern = /vimeo\.com\/(\d+)/;
  const match = url.match(pattern);
  return match ? match[1] : null;
}

/**
 * 检测视频提供商类型
 */
function detectVideoProvider(src) {
  if (parseYouTubeUrl(src)) return 'youtube';
  if (parseVimeoUrl(src)) return 'vimeo';
  return 'html5';
}

/**
 * 收集页面中直接使用 src 的媒体（用于生成 media pool）
 * 存储在 hexo.locals 中
 */
function collectDirectMedia(hexo, postPath, mediaInfo) {
  if (!hexo._mediaDirectSources) {
    hexo._mediaDirectSources = new Map();
  }
  
  if (!hexo._mediaDirectSources.has(postPath)) {
    hexo._mediaDirectSources.set(postPath, new Map());
  }
  
  const postMedia = hexo._mediaDirectSources.get(postPath);
  if (!postMedia.has(mediaInfo.id)) {
    postMedia.set(mediaInfo.id, mediaInfo);
  }
}

// ============================================
// Tag: audio - 完整音频播放器（使用 plyr）
// ============================================
function parseTagAudio(args) {
  const params = parseArgs(args);
  
  let mediaInfo;
  try {
    mediaInfo = resolveMediaSource(params, this);
  } catch (e) {
    hexo.log.error(`[audio tag] ${e.message}`);
    return `<div class="media-error">音频加载错误: ${e.message}</div>`;
  }
  
  // 如果是直接路径，收集起来
  if (params.src && !params.id) {
    collectDirectMedia(hexo, this.source, mediaInfo);
  }
  
  const title = mediaInfo.title || params.title || '';
  const playerId = 'p' + Date.now() + Math.random().toString(36).substr(2, 9);
  
  // 使用 plyr 的标准 HTML 结构
  return `<div class="plyr-container" data-player-id="${playerId}" data-media-id="${mediaInfo.id}" data-type="${mediaInfo.type}">
  ${title ? `<div class="plyr-title">${title}</div>` : ''}
  <audio id="${playerId}" controls crossorigin playsinline>
    <source src="${mediaInfo.src}" type="audio/${getAudioMimeType(mediaInfo.src)}" />
  </audio>
</div>`;
}

// ============================================
// Tag: video - 完整视频播放器（使用 plyr）
// ============================================
function parseTagVideo(args) {
  const params = parseArgs(args);
  
  let mediaInfo;
  try {
    mediaInfo = resolveMediaSource(params, this);
  } catch (e) {
    hexo.log.error(`[video tag] ${e.message}`);
    return `<div class="media-error">视频加载错误: ${e.message}</div>`;
  }
  
  // 如果是直接路径，收集起来
  if (params.src && !params.id) {
    collectDirectMedia(hexo, this.source, mediaInfo);
  }
  
  const title = mediaInfo.title || params.title || '';
  const poster = mediaInfo.poster || params.poster || '';
  const playerId = 'p' + Date.now() + Math.random().toString(36).substr(2, 9);
  
  // 解析起始/结束时间
  const startTime = parseTime(params.start) || 0;
  const endTime = parseTime(params.end) || 0;
  
  // 检测视频提供商
  const provider = detectVideoProvider(mediaInfo.src);
  
  // 构建 data 属性（用于传递时间信息给 JS）
  const dataAttrs = [];
  if (startTime > 0) dataAttrs.push(`data-start="${startTime}"`);
  if (endTime > 0) dataAttrs.push(`data-end="${endTime}"`);
  const dataAttrStr = dataAttrs.join(' ');
  
  let videoHtml = '';
  
  if (provider === 'youtube') {
    // YouTube 视频 - 通过 data 属性传递时间，由 JS 处理
    const videoId = parseYouTubeUrl(mediaInfo.src);
    videoHtml = `<div id="${playerId}" data-plyr-provider="youtube" data-plyr-embed-id="${videoId}" ${dataAttrStr}></div>`;
  } else if (provider === 'vimeo') {
    // Vimeo 视频 - 通过 data 属性传递时间
    const videoId = parseVimeoUrl(mediaInfo.src);
    videoHtml = `<div id="${playerId}" data-plyr-provider="vimeo" data-plyr-embed-id="${videoId}" ${dataAttrStr}></div>`;
  } else {
    // HTML5 视频 - 使用 Media Fragments URI
    let srcWithFragment = mediaInfo.src;
    if (startTime > 0 || endTime > 0) {
      const fragment = endTime > 0 ? `#t=${startTime},${endTime}` : `#t=${startTime}`;
      srcWithFragment = mediaInfo.src + fragment;
    }
    const posterAttr = poster ? `poster="${poster}"` : '';
    videoHtml = `<video id="${playerId}" controls crossorigin playsinline ${posterAttr} ${dataAttrStr}>
    <source src="${srcWithFragment}" type="video/${getVideoMimeType(mediaInfo.src)}" />
  </video>`;
  }
  
  // 使用 plyr 的标准 HTML 结构
  return `<div class="plyr-container" data-player-id="${playerId}" data-media-id="${mediaInfo.id}" data-type="${mediaInfo.type}" data-provider="${provider}">
  ${title ? `<div class="plyr-title">${title}</div>` : ''}
  ${videoHtml}
</div>`;
}

/**
 * 获取音频 MIME type
 */
function getAudioMimeType(src) {
  if (src.endsWith('.mp3')) return 'mp3';
  if (src.endsWith('.ogg')) return 'ogg';
  if (src.endsWith('.wav')) return 'wav';
  if (src.endsWith('.m4a')) return 'mp4';
  if (src.endsWith('.aac')) return 'aac';
  if (src.endsWith('.flac')) return 'flac';
  if (src.endsWith('.webm')) return 'webm';
  return 'mp3';
}

/**
 * 获取视频 MIME type
 */
function getVideoMimeType(src) {
  if (src.endsWith('.mp4') || src.endsWith('.m4v')) return 'mp4';
  if (src.endsWith('.webm')) return 'webm';
  if (src.endsWith('.ogv')) return 'ogg';
  if (src.endsWith('.mov')) return 'quicktime';
  return 'mp4';
}

// ============================================
// Tag: audio_clip - 音频片段（行内）
// ============================================
function parseTagAudioClip(args, content) {
  const params = parseArgs(args);
  
  let mediaInfo;
  try {
    mediaInfo = resolveMediaSource(params, this);
  } catch (e) {
    hexo.log.error(`[audio_clip tag] ${e.message}`);
    return `<span class="audio-clip-error">[音频错误]</span>`;
  }
  
  // 如果是直接路径，收集起来
  if (params.src && !params.id) {
    collectDirectMedia(hexo, this.source, mediaInfo);
  }
  
  // 解析时间
  const startSec = parseTime(params.start);
  const endSec = parseTime(params.end);
  
  if (endSec <= startSec) {
    hexo.log.warn(`[audio_clip tag] end time should be greater than start time`);
  }
  
  const duration = endSec - startSec;
  const durationStr = formatDuration(duration);
  
  // 片段文本：优先使用 content，其次使用 title 参数
  let text = '';
  if (content && content.trim()) {
    text = content.trim();
  } else if (params.title) {
    text = params.title;
  } else {
    text = `${formatDuration(startSec)}-${formatDuration(endSec)}`;
  }
  
  // 判断是否共享：使用 id 参数的为共享，使用 src 的为独立
  const isShared = !!params.id;
  const fadeEnabled = params.fade !== undefined;
  
  return `<span class="audio-clip" 
    data-audio-id="${mediaInfo.id}" 
    data-src="${mediaInfo.src}"
    data-start="${startSec}" 
    data-end="${endSec}"
    data-shared="${isShared}"
    ${fadeEnabled ? 'data-fade="true"' : ''}
    role="button"
    tabindex="0"
    aria-label="播放音频片段: ${text}">
<span class="audio-clip-icon play-icon">▶</span>
<span class="audio-clip-icon pause-icon">⏸</span>
<span class="audio-clip-bars">
  <span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span>
</span>
<span class="audio-clip-text"><span class="audio-clip-title-bracket-left">(</span>${text}<span class="audio-clip-title-bracket-right">)</span></span>
<span class="audio-clip-duration">${durationStr}</span>
</span>`;
}

// 注册 tags
hexo.extend.tag.register('audio', parseTagAudio, { ends: true });
hexo.extend.tag.register('video', parseTagVideo, { ends: true });
hexo.extend.tag.register('audio_clip', parseTagAudioClip, { ends: true });

// ============================================
// Filter: 注入 media pool 到页面
// ============================================
hexo.extend.filter.register('after_post_render', function(data) {
  // 检查是否有 assets 定义或直接引用的媒体
  const assets = data.assets || {};
  const directSources = hexo._mediaDirectSources?.get(data.source) || new Map();
  
  // 收集所有需要预加载的媒体
  const mediaPool = new Map();
  
  // 从 front-matter assets 中收集媒体
  for (const [id, asset] of Object.entries(assets)) {
    const src = typeof asset === 'string' ? asset : asset.src;
    const type = typeof asset === 'object' ? asset.type : detectMediaType(src);
    
    // 检查是否是音频/视频文件
    if (type === 'audio' || type === 'video') {
      mediaPool.set(id, { src, type, ...asset });
    }
  }
  
  // 添加直接引用的媒体
  for (const [id, mediaInfo] of directSources) {
    if (!mediaPool.has(id)) {
      mediaPool.set(id, mediaInfo);
    }
  }
  
  // media 元素将由客户端 JavaScript（plyr）动态初始化
  // 这样可以避免页面加载时下载所有媒体文件
  
  return data;
});