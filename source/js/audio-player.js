/**
 * Audio Player & Clip Manager
 * 管理页面中的音频播放器和音频片段
 * 
 * 【架构设计】
 * - PlayerState: 管理单个播放器的状态机 (stopped -> playing -> paused)
 * - GlobalPlaybackManager: 管理全局播放切换逻辑
 * 
 * 【状态管理策略】
 * - 共享 audioId 的片段：使用同一个 PlayerState
 * - 完整播放器：每个拥有独立的 PlayerState
 * - 仅使用 src 的片段：每个拥有独立的 PlayerState
 * 
 * 【播放切换规则】
 * - 下一个播放器开始时，如果当前是完整播放器则暂停（保留进度）
 * - 下一个播放器开始时，如果当前是片段则停止（重置到片段开头）
 */
(function() {
  'use strict';

  // ============================================
  // 工具函数
  // ============================================
  
  /**
   * 格式化秒数为 m:ss 格式
   */
  function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return min + ':' + sec.toString().padStart(2, '0');
  }

  /**
   * 获取或创建音频元素
   * 
   * @param {string} audioId - 音频 ID
   * @param {string} src - 音频源路径
   * @param {string} type - 类型（'player' | 'clip' | 'clip-unique'）
   * @param {boolean} createIfNotExists - 如果不存在是否创建（默认 true）
   * @param {boolean} setSrc - 是否立即设置 src（默认 false，延迟到播放时）
   * @returns {HTMLAudioElement|null}
   */
  function getAudioElement(audioId, src, type, createIfNotExists, setSrc) {
    if (createIfNotExists === undefined) createIfNotExists = true;
    if (setSrc === undefined) setSrc = false;
    
    let elementId = type + '-' + audioId;
    let audio = document.getElementById(elementId);
    
    if (!audio && createIfNotExists) {
      // 如果不存在，创建新的
      audio = document.createElement('audio');
      audio.id = elementId;
      audio.preload = 'none';
      
      // 延迟设置 src：只在 setSrc=true 时设置，避免浏览器自动预加载
      if (setSrc) {
        audio.src = src;
      } else {
        // 将 src 存储为 data 属性，稍后使用
        audio.dataset.pendingSrc = src;
      }
      
      // 添加到 audio-pool 或 body
      let pool = document.getElementById('audio-pool');
      if (!pool) {
        pool = document.createElement('div');
        pool.id = 'audio-pool';
        pool.style.display = 'none';
        document.body.appendChild(pool);
      }
      pool.appendChild(audio);
    }
    
    // 如果 audio 已存在但还没设置 src，且现在需要设置
    if (audio && !audio.src && setSrc && audio.dataset.pendingSrc) {
      audio.src = audio.dataset.pendingSrc;
      delete audio.dataset.pendingSrc;
    }
    
    return audio;
  }

  // ============================================
  // PlayerState - 管理单个播放器的状态
  // 每个播放器实例拥有独立的状态机: stopped <-> playing <-> paused
  // ============================================
  class PlayerState {
    constructor(element, audioElement, type) {
      this.element = element;           // DOM 元素（clip 或 player）
      this.audioElement = audioElement; // audio 元素
      this.type = type;                 // 'clip' 或 'player'
      this.state = 'stopped';           // 'stopped' | 'playing' | 'paused'
      
      // 片段专用属性
      this.startTime = null;
      this.endTime = null;
      
      // 事件处理器
      this.timeUpdateHandler = null;
      this.endedHandler = null;
    }

    /**
     * 播放（从头开始或从当前位置继续）
     */
    play(fromStart = false) {
      const self = this;
      
      // 确保 audio src 已设置
      if (!this.audioElement.src && this.audioElement.dataset.pendingSrc) {
        this.audioElement.src = this.audioElement.dataset.pendingSrc;
        delete this.audioElement.dataset.pendingSrc;
      }
      
      // 如果从头开始，重置播放位置
      if (fromStart) {
        if (this.type === 'clip' && this.startTime !== null) {
          this.audioElement.currentTime = this.startTime;
        } else {
          this.audioElement.currentTime = 0;
        }
      }
      
      // 设置事件监听器
      this._setupEventListeners();
      
      // 播放
      const playPromise = this.audioElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(function(error) {
          console.warn('Audio play failed:', error);
        });
      }
      
      // 更新状态
      this.state = 'playing';
      this._updateUI();
    }

    /**
     * 暂停
     */
    pause() {
      this.audioElement.pause();
      this.state = 'paused';
      this._updateUI();
    }

    /**
     * 停止（重置到开头）
     */
    stop() {
      this.audioElement.pause();
      
      // 重置播放位置
      if (this.type === 'clip' && this.startTime !== null) {
        this.audioElement.currentTime = this.startTime;
      } else {
        this.audioElement.currentTime = 0;
      }
      
      // 移除事件监听器
      this._removeEventListeners();
      
      // 更新状态
      this.state = 'stopped';
      this._updateUI();
    }

    /**
     * 恢复播放（从暂停位置继续）
     */
    resume() {
      this.play(false);
    }

    /**
     * 设置事件监听器
     */
    _setupEventListeners() {
      const self = this;
      
      // 移除旧的监听器
      this._removeEventListeners();
      
      if (this.type === 'clip') {
        // 片段：监听是否到达结束时间
        this.timeUpdateHandler = function() {
          if (self.audioElement.currentTime >= self.endTime) {
            self.stop();
          }
        };
        this.audioElement.addEventListener('timeupdate', this.timeUpdateHandler);
        
        this.endedHandler = function() {
          self.stop();
        };
        this.audioElement.addEventListener('ended', this.endedHandler);
      } else {
        // 完整播放器：更新进度条
        this.timeUpdateHandler = function() {
          self._updateProgress();
        };
        this.audioElement.addEventListener('timeupdate', this.timeUpdateHandler);
        
        this.endedHandler = function() {
          self.stop();
        };
        this.audioElement.addEventListener('ended', this.endedHandler);
      }
    }

    /**
     * 移除事件监听器
     */
    _removeEventListeners() {
      if (this.timeUpdateHandler) {
        this.audioElement.removeEventListener('timeupdate', this.timeUpdateHandler);
        this.timeUpdateHandler = null;
      }
      if (this.endedHandler) {
        this.audioElement.removeEventListener('ended', this.endedHandler);
        this.endedHandler = null;
      }
    }

    /**
     * 更新 UI 状态
     */
    _updateUI() {
      if (this.type === 'clip') {
        // 片段 UI
        this.element.classList.remove('playing', 'paused', 'stopped');
        if (this.state === 'playing') {
          this.element.classList.add('playing');
        } else if (this.state === 'paused') {
          this.element.classList.add('paused');
        }
      } else {
        // 完整播放器 UI
        this.element.classList.remove('playing', 'paused');
        if (this.state === 'playing') {
          this.element.classList.add('playing');
        } else if (this.state === 'paused') {
          this.element.classList.add('paused');
        }
        
        // 停止时重置进度条
        if (this.state === 'stopped') {
          const progressBar = this.element.querySelector('.audio-player-progress-bar');
          const progressHandle = this.element.querySelector('.audio-player-progress-handle');
          const currentTime = this.element.querySelector('.audio-player-current');
          
          if (progressBar) progressBar.style.width = '0%';
          if (progressHandle) progressHandle.style.left = '0%';
          if (currentTime) currentTime.textContent = '0:00';
        }
      }
    }

    /**
     * 更新播放器进度条
     */
    _updateProgress() {
      if (this.type !== 'player') return;
      
      const progressBar = this.element.querySelector('.audio-player-progress-bar');
      const progressHandle = this.element.querySelector('.audio-player-progress-handle');
      const currentTime = this.element.querySelector('.audio-player-current');

      if (this.audioElement.duration && isFinite(this.audioElement.duration)) {
        const percent = (this.audioElement.currentTime / this.audioElement.duration) * 100;
        if (progressBar) progressBar.style.width = percent + '%';
        if (progressHandle) progressHandle.style.left = percent + '%';
      }

      if (currentTime) {
        currentTime.textContent = formatTime(this.audioElement.currentTime);
      }
    }
  }

  // ============================================
  // GlobalPlaybackManager - 管理全局播放切换
  // ============================================
  const GlobalPlaybackManager = {
    currentPlaying: null,  // 当前正在播放的 PlayerState
    // 服务器是否支持 Range 请求
    supportsRange: null, // null=未检测, true=支持, false=不支持

    /**
     * 切换到新的播放器
     * 规则：下一个播放器开始时，如果当前是完整播放器则暂停，如果是片段则停止
     */
    switchTo: function(newPlayerState) {
      if (this.currentPlaying && this.currentPlaying !== newPlayerState) {
        if (this.currentPlaying.type === 'player') {
          // 完整播放器：暂停（保留进度）
          this.currentPlaying.pause();
        } else {
          // 片段播放器：停止（重置到片段开头）
          this.currentPlaying.stop();
        }
      }
      
      // 更新当前播放
      this.currentPlaying = newPlayerState;
    },

    /**
     * 获取或创建播放器状态
     * 对于片段：共享 audioId 的使用同一个 PlayerState
     * 对于完整播放器：每个播放器独立的 PlayerState
     */
    getOrCreatePlayerState: function(element, type) {
      // 检查元素是否已有绑定的状态
      if (element._playerState) {
        return element._playerState;
      }
      
      let audioElement, stateKey;
      
      if (type === 'clip') {
        const audioId = element.dataset.audioId;
        const src = element.dataset.src;
        const isShared = element.dataset.shared === 'true';
        
        // 共享 id 的片段使用同一个 PlayerState
        if (isShared) {
          stateKey = 'clip-' + audioId;
          
          // 检查是否已有其他片段创建了这个状态
          const existingElements = document.querySelectorAll(`.audio-clip[data-audio-id="${audioId}"][data-shared="true"]`);
          for (let el of existingElements) {
            if (el._playerState && el !== element) {
              element._playerState = el._playerState;
              return el._playerState;
            }
          }
        }
        
        // 创建新的 audio 元素
        audioElement = getAudioElement(
          audioId,
          src,
          isShared ? 'clip' : 'clip-unique',
          true,
          false  // 延迟设置 src
        );
        
        // 创建新的状态
        const playerState = new PlayerState(element, audioElement, 'clip');
        playerState.startTime = parseFloat(element.dataset.start) || 0;
        playerState.endTime = parseFloat(element.dataset.end) || Infinity;
        
        element._playerState = playerState;
        return playerState;
        
      } else {
        // 完整播放器：每个都独立
        const playerId = element.dataset.playerId;
        const src = element.dataset.src;
        
        audioElement = getAudioElement(playerId, src, 'player', true, false);
        
        const playerState = new PlayerState(element, audioElement, 'player');
        element._playerState = playerState;
        
        // 设置元数据加载事件
        const self = this;
        audioElement.addEventListener('loadedmetadata', function() {
          self.updatePlayerDuration(element, audioElement);
        });
        
        return playerState;
      }
    },

    /**
     * 更新播放器时长显示
     */
    updatePlayerDuration: function(playerElement, audio) {
      const durationEl = playerElement.querySelector('.audio-player-duration');
      if (durationEl && audio.duration && isFinite(audio.duration)) {
        durationEl.textContent = formatTime(audio.duration);
      }
    },

    /**
     * 跳转到指定位置（仅完整播放器）
     */
    seekPlayer: function(playerElement, percent) {
      const playerState = playerElement._playerState;
      if (!playerState || playerState.type !== 'player') return;
      
      const audio = playerState.audioElement;
      
      // 确保音频已加载
      if (!audio.duration || !isFinite(audio.duration)) {
        const self = this;
        audio.addEventListener('loadedmetadata', function onLoaded() {
          audio.removeEventListener('loadedmetadata', onLoaded);
          if (audio.duration && isFinite(audio.duration)) {
            audio.currentTime = audio.duration * percent;
            if (playerState.state === 'playing') {
              playerState._updateProgress();
            }
          }
        });
        
        // 设置 src 触发加载
        if (!audio.src && audio.dataset.pendingSrc) {
          audio.src = audio.dataset.pendingSrc;
          delete audio.dataset.pendingSrc;
        }
        return;
      }

      audio.currentTime = audio.duration * percent;
      
      // 更新UI进度
      if (playerState.state === 'playing') {
        playerState._updateProgress();
      }
    },

    /**
     * 检测服务器是否支持 HTTP Range 请求
     */
    detectRangeSupport: function(audioSrc, callback) {
      // 如果已经检测过，直接返回结果
      if (this.supportsRange !== null) {
        callback(this.supportsRange);
        return;
      }

      const self = this;
      fetch(audioSrc, {
        method: 'HEAD',
        headers: {
          'Range': 'bytes=0-1'
        }
      })
      .then(function(response) {
        // 检查响应状态码是否为 206 Partial Content
        self.supportsRange = response.status === 206;
        callback(self.supportsRange);
      })
      .catch(function(error) {
        console.warn('Range 支持检测失败:', error);
        // 默认假设不支持
        self.supportsRange = false;
        callback(false);
      });
    },

    /**
     * 高层接口：处理片段点击
     */
    handleClipClick: function(clipElement) {
      const playerState = this.getOrCreatePlayerState(clipElement, 'clip');
      
      // 状态机：根据当前状态决定行为
      switch (playerState.state) {
        case 'playing':
          playerState.pause();
          break;
        case 'paused':
          // 从暂停恢复播放：也要切换播放器（停止其他播放的）
          this.switchTo(playerState);
          playerState.resume();
          break;
        case 'stopped':
        default:
          // 从头开始播放
          this.switchTo(playerState);
          playerState.play(true);
          break;
      }
    },

    /**
     * 高层接口：处理片段停止（双击/长按）
     */
    handleClipStop: function(clipElement) {
      const playerState = clipElement._playerState;
      if (playerState) {
        playerState.stop();
        // 如果这是当前播放的，清除全局引用
        if (this.currentPlaying === playerState) {
          this.currentPlaying = null;
        }
      }
    },

    /**
     * 高层接口：处理完整播放器播放/暂停
     */
    handlePlayerPlayPause: function(playerElement) {
      const playerState = this.getOrCreatePlayerState(playerElement, 'player');
      
      // 如果正在播放，则暂停
      if (playerState.state === 'playing') {
        playerState.pause();
      } else if (playerState.state === 'paused') {
        // 从暂停恢复播放：也要切换播放器（停止其他播放的）
        this.switchTo(playerState);
        playerState.resume();
      } else {
        // 停止状态，从头开始播放
        this.switchTo(playerState);
        playerState.play(false);
      }
    },

    /**
     * 高层接口：处理完整播放器停止
     */
    handlePlayerStop: function(playerElement) {
      const playerState = playerElement._playerState;
      if (playerState) {
        playerState.stop();
        // 如果这是当前播放的，清除全局引用
        if (this.currentPlaying === playerState) {
          this.currentPlaying = null;
        }
      }
    }
  };

  // ============================================
  // 事件绑定
  // ============================================
  
  function init() {
    // 绑定音频片段事件
    document.querySelectorAll('.audio-clip').forEach(function(clip) {
      // 单击：播放/暂停/恢复
      clip.addEventListener('click', function(e) {
        e.preventDefault();
        GlobalPlaybackManager.handleClipClick(clip);
      });

      // 双击：停止（重置到开头）
      clip.addEventListener('dblclick', function(e) {
        e.preventDefault();
        GlobalPlaybackManager.handleClipStop(clip);
      });

      // 长按：停止（重置到开头）
      let longPressTimer = null;
      clip.addEventListener('mousedown', function(e) {
        longPressTimer = setTimeout(function() {
          GlobalPlaybackManager.handleClipStop(clip);
        }, 500); // 500ms 长按
      });
      clip.addEventListener('mouseup', function() {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
      clip.addEventListener('mouseleave', function() {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });

      // 触摸设备长按支持
      clip.addEventListener('touchstart', function(e) {
        longPressTimer = setTimeout(function() {
          GlobalPlaybackManager.handleClipStop(clip);
        }, 500);
      });
      clip.addEventListener('touchend', function() {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });

      // 键盘支持
      clip.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          GlobalPlaybackManager.handleClipClick(clip);
        }
        // Escape 键停止
        if (e.key === 'Escape') {
          e.preventDefault();
          GlobalPlaybackManager.handleClipStop(clip);
        }
      });
    });

    // 绑定完整播放器事件
    document.querySelectorAll('.audio-player').forEach(function(player) {
      const btn = player.querySelector('.audio-player-btn');
      const stopBtn = player.querySelector('.audio-player-stop-btn');
      const progress = player.querySelector('.audio-player-progress');

      // 播放/暂停按钮
      if (btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          GlobalPlaybackManager.handlePlayerPlayPause(player);
        });
      }

      // 停止按钮
      if (stopBtn) {
        stopBtn.addEventListener('click', function(e) {
          e.preventDefault();
          GlobalPlaybackManager.handlePlayerStop(player);
        });
      }

      // 进度条点击跳转
      if (progress) {
        const progressClickHandler = function(e) {
          e.stopPropagation();
          const rect = progress.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percent = Math.max(0, Math.min(1, clickX / rect.width));
          GlobalPlaybackManager.seekPlayer(player, percent);
        };
        
        // 检测服务器是否支持 Range
        const src = player.dataset.src;
        if (src) {
          GlobalPlaybackManager.detectRangeSupport(src, function(supportsRange) {
            if (supportsRange) {
              // 支持 Range：启用进度条点击
              progress.addEventListener('click', progressClickHandler);
              progress.style.cursor = 'pointer';
            } else {
              // 不支持 Range：禁用进度条点击，添加提示
              progress.style.cursor = 'not-allowed';
              progress.title = '当前服务器不支持进度跳转（需要 HTTP Range 支持）';
              progress.style.opacity = '0.6';
            }
          });
        }
      }
    });
  }

  // DOM ready 时初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 导出到全局（用于调试）
  window.GlobalPlaybackManager = GlobalPlaybackManager;

})();
