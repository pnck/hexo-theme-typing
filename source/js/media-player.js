/**
 * Media Player & Clip Manager
 * 管理页面中的媒体播放器（使用 Plyr）和音频片段
 */
(function() {
  'use strict';

  // 常量配置
  const VOLUME_CONTROL_SHOW_DELAY = 500;      // 显示前的等待时间（较长）
  const VOLUME_CONTROL_HIDE_DELAY = 100;      // 隐藏前的等待时间（较短）
  const VOLUME_CONTROL_TRANSITION = 300;
  
  // 设置CSS变量以控制动画时长
  document.documentElement.style.setProperty('--volume-control-transition', VOLUME_CONTROL_TRANSITION + 'ms');

  // 工具函数
  function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return min + ':' + sec.toString().padStart(2, '0');
  }

  function getAudioElement(elementId, src) {
    let audio = document.getElementById(elementId);
    
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = elementId;
      audio.preload = 'none';
      audio.dataset.pendingSrc = src;
      
      let pool = document.getElementById('audio-pool');
      if (!pool) {
        pool = document.createElement('div');
        pool.id = 'audio-pool';
        pool.style.display = 'none';
        document.body.appendChild(pool);
      }
      pool.appendChild(audio);
    }
    
    // Lazy load
    if (!audio.src && audio.dataset.pendingSrc) {
      audio.src = audio.dataset.pendingSrc;
      delete audio.dataset.pendingSrc;
    }
    
    return audio;
  }

  // ClipState - 管理片段播放状态
  class ClipState {
    constructor(element, audioElement, audioId) {
      this.element = element;
      this.audioElement = audioElement;
      this.audioId = audioId;
      this.state = 'stopped';
      this.startTime = parseFloat(element.dataset.start) || 0;
      this.endTime = parseFloat(element.dataset.end) || Infinity;
    }

    play(fromStart = false) {
      if (fromStart || this.state === 'stopped') {
        this.audioElement.currentTime = this.startTime;
      }
      // 确保音量正确（从 GlobalPlaybackManager 获取）
      const storedVolume = GlobalPlaybackManager.getVolume(this.audioId);
      this.audioElement.volume = storedVolume;
      
      this.audioElement.play();
      this.state = 'playing';
      this._updateUI();
      this._bindEvents();
    }

    pause() {
      this.audioElement.pause();
      this.state = 'paused';
      this._updateUI();
    }

    stop() {
      this.audioElement.pause();
      this.audioElement.currentTime = this.startTime;
      this.state = 'stopped';
      this._updateUI();
      this._unbindEvents();
    }

    _bindEvents() {
      if (!this.audioElement._boundEvents) {
        const audioElement = this.audioElement;
        
        // 事件处理器需要查找当前活动的 ClipState
        audioElement.addEventListener('timeupdate', () => {
          const activeClipState = audioElement._activeClipState;
          if (activeClipState && activeClipState.state === 'playing' && 
              audioElement.currentTime >= activeClipState.endTime) {
            activeClipState.stop();
          }
        });
        
        audioElement.addEventListener('ended', () => {
          const activeClipState = audioElement._activeClipState;
          if (activeClipState && activeClipState.state === 'playing') {
            activeClipState.stop();
          }
        });
        
        audioElement._boundEvents = true;
      }
      // 标记当前活动的 ClipState
      this.audioElement._activeClipState = this;
    }

    _unbindEvents() {
      // 清除活动标记
      if (this.audioElement._activeClipState === this) {
        this.audioElement._activeClipState = null;
      }
    }

    _updateUI() {
      this.element.classList.remove('playing', 'paused');
      if (this.state === 'playing') {
        this.element.classList.add('playing');
      } else if (this.state === 'paused') {
        this.element.classList.add('paused');
      }
    }
  }

  // 全局播放管理器
  const GlobalPlaybackManager = {
    currentPlaying: null,
    currentPlayingType: null,
    volumes: new Map(),

    getVolume(audioElementId) {
      return this.volumes.has(audioElementId) ? this.volumes.get(audioElementId) : 1.0;
    },

    setVolume(audioElementId, volume) {
      this.volumes.set(audioElementId, volume);
      const audio = document.getElementById(audioElementId);
      if (audio) audio.volume = volume;
    },

    createGlobalVolumeControl() {
      if (this._globalVolumeControl) return this._globalVolumeControl;
      
      const volumeControl = document.createElement('div');
      volumeControl.className = 'audio-clip-volume-control hidden';
      volumeControl.innerHTML = `
        <div class="audio-clip-volume-slider-container">
          <span class="audio-clip-volume-icon"></span>
          <input type="range" class="audio-clip-volume-slider" min="0" max="100" value="100" style="--volume-percent: 100%"/>
          <span class="audio-clip-volume-value">100%</span>
        </div>
      `;
      document.body.appendChild(volumeControl);
      
      // FSM 状态机
      const VolumeControlFSM = {
        state: 'hidden',
        currentClip: null,
        currentTask: null,
        
        async delay(ms) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            this.currentTask = () => {
              clearTimeout(timer);
              reject(new Error('cancelled'));
            };
          });
        },
        
        cancel() {
          if (this.currentTask) {
            this.currentTask();
            this.currentTask = null;
          }
        },
        
        setState(newState) {
          if (this.state === newState) return;
          this.state = newState;
          volumeControl.className = 'audio-clip-volume-control ' + newState;
          if (newState === 'hidden') this.currentClip = null;
        },
        
        async runAutoFlow() {
          this.cancel();
          try {
            this.setState('waiting');
            await this.delay(VOLUME_CONTROL_SHOW_DELAY);
            this.setState('showing');
            await this.delay(VOLUME_CONTROL_TRANSITION);
            this.setState(volumeControl.matches(':hover') ? 'holding' : 'show');
          } catch (err) {
            // cancelled
          }
        },
        
        async runHideFlow() {
          this.cancel();
          try {
            await this.delay(VOLUME_CONTROL_HIDE_DELAY);
            this.setState('hiding');
            await this.delay(VOLUME_CONTROL_TRANSITION);
            this.setState('hidden');
          } catch (err) {
            // cancelled
          }
        }
      };
      
      volumeControl._fsm = VolumeControlFSM;
      
      // 滑动条事件
      const slider = volumeControl.querySelector('.audio-clip-volume-slider');
      const valueDisplay = volumeControl.querySelector('.audio-clip-volume-value');
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        e.target.style.setProperty('--volume-percent', value + '%');
        valueDisplay.textContent = value + '%';
        if (volumeControl._currentAudioElementId) {
          this.setVolume(volumeControl._currentAudioElementId, value / 100);
        }
      });
      
      // 阻止冒泡
      ['click', 'mousedown', 'dblclick'].forEach(evt => {
        volumeControl.addEventListener(evt, e => e.stopPropagation());
      });
      
      // 控制器事件
      volumeControl.addEventListener('mouseenter', () => {
        VolumeControlFSM.cancel();
        if (['show', 'showing', 'holding'].includes(VolumeControlFSM.state)) {
          VolumeControlFSM.setState('holding');
        }
      });
      
      volumeControl.addEventListener('mouseleave', (e) => {
        const targetClip = e.relatedTarget?.closest('.audio-clip');
        if (targetClip) {
          if (targetClip !== VolumeControlFSM.currentClip) {
            this.updateVolumeControl(targetClip);
            VolumeControlFSM.currentClip = targetClip;
          }
          VolumeControlFSM.runAutoFlow();
        } else if (VolumeControlFSM.state === 'holding') {
          VolumeControlFSM.runHideFlow();
        }
      });
      
      this._globalVolumeControl = volumeControl;
      return volumeControl;
    },

    updateVolumeControl(clipElement) {
      const volumeControl = this._globalVolumeControl;
      if (!volumeControl) return;
      
      // 获取该片段关联的 audio element ID
      // 优先从 clipState 获取，否则从 dataset 构造
      let audioElementId;
      if (clipElement._clipState) {
        audioElementId = clipElement._clipState.audioId;
      } else {
        const audioId = clipElement.dataset.audioId;
        const isShared = clipElement.dataset.shared === 'true';
        audioElementId = isShared ? ('clip-' + audioId) : ('clip-unique-' + audioId);
      }
      
      volumeControl._currentAudioElementId = audioElementId;
      
      const currentVolume = this.getVolume(audioElementId);
      const volumePercent = Math.round(currentVolume * 100);
      const slider = volumeControl.querySelector('.audio-clip-volume-slider');
      const valueDisplay = volumeControl.querySelector('.audio-clip-volume-value');
      slider.value = volumePercent;
      slider.style.setProperty('--volume-percent', volumePercent + '%');
      valueDisplay.textContent = volumePercent + '%';
      
      const rect = clipElement.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      volumeControl.style.left = (rect.left + scrollLeft + rect.width / 2) + 'px';
      volumeControl.style.top = (rect.bottom + scrollTop + 4) + 'px';
    },

    showVolumeControl(clipElement) {
      const volumeControl = this.createGlobalVolumeControl();
      const FSM = volumeControl._fsm;
      
      if (FSM.currentClip !== clipElement) {
        this.updateVolumeControl(clipElement);
        FSM.currentClip = clipElement;
      }
      FSM.runAutoFlow();
    },

    hideVolumeControl(e) {
      const volumeControl = this._globalVolumeControl;
      if (!volumeControl) return;
      
      const FSM = volumeControl._fsm;
      
      if (e && e.relatedTarget && volumeControl.contains(e.relatedTarget)) {
        FSM.cancel();
        FSM.setState('holding');
        return;
      }
      
      if (FSM.state === 'waiting') {
        FSM.cancel();
        FSM.setState('hidden');
      } else if (['show', 'holding'].includes(FSM.state)) {
        FSM.runHideFlow();
      }
    },

    switchTo(newPlayer, type) {
      if (this.currentPlaying && this.currentPlaying !== newPlayer) {
        if (this.currentPlayingType === 'plyr') {
          this.currentPlaying.pause();
        } else if (this.currentPlayingType === 'clip') {
          this.currentPlaying.stop();
        }
      }
      
      if (type === 'clip') {
        document.querySelectorAll('.audio-clip').forEach(el => {
          if (el._clipState && el._clipState !== newPlayer) {
            el._clipState.state = 'stopped';
            el._clipState._updateUI();
          }
        });
      }
      
      this.currentPlaying = newPlayer;
      this.currentPlayingType = type;
    },

    showError(container, message) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'plyr-error';
      errorDiv.innerHTML = `
        <div class="plyr-error-icon">⚠️</div>
        <div class="plyr-error-message">${message}</div>
      `;
      const plyrElement = container.querySelector('.plyr');
      if (plyrElement) plyrElement.remove();
      container.appendChild(errorDiv);
    },

    initPlyrPlayer(container) {
      const videoElement = container.querySelector('audio, video, [data-plyr-provider]');
      if (!videoElement) return;
      
      try {
        const player = new Plyr(videoElement, {
          controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen'],
          settings: ['quality', 'speed'],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] }
        });
        
        player.on('play', () => this.switchTo(player, 'plyr'));
        container._plyrInstance = player;
      } catch (error) {
        console.error('Plyr初始化失败:', error);
        this.showError(container, '播放器加载失败');
      }
    },

    getOrCreateClipState(clipElement) {
      if (clipElement._clipState) return clipElement._clipState;
      
      const audioId = clipElement.dataset.audioId;
      const src = clipElement.dataset.src;
      const isShared = clipElement.dataset.shared === 'true';
      const audioElementId = isShared ? ('clip-' + audioId) : ('clip-unique-' + audioId);
      const audioElement = getAudioElement(audioElementId, src);
      
      // 应用存储的音量
      const storedVolume = this.getVolume(audioElementId);
      audioElement.volume = storedVolume;
      
      clipElement._clipState = new ClipState(clipElement, audioElement, audioElementId);
      return clipElement._clipState;
    },

    handleClipClick(clipElement) {
      const clipState = this.getOrCreateClipState(clipElement);
      
      if (clipState.state === 'stopped') {
        this.switchTo(clipState, 'clip');
        clipState.play(true);
      } else if (clipState.state === 'playing') {
        clipState.pause();
      } else if (clipState.state === 'paused') {
        this.switchTo(clipState, 'clip');
        clipState.play(false);
      }
    },

    handleClipStop(clipElement) {
      const clipState = clipElement._clipState;
      if (clipState) {
        clipState.stop();
        if (this.currentPlaying === clipState) {
          this.currentPlaying = null;
          this.currentPlayingType = null;
        }
      }
    }
  };

  // 初始化
  function init() {
    // Plyr 播放器
    document.querySelectorAll('.plyr-container').forEach(container => {
      GlobalPlaybackManager.initPlyrPlayer(container);
    });

    // 音频片段
    document.querySelectorAll('.audio-clip').forEach(clip => {
      const self = GlobalPlaybackManager;
      
      clip.addEventListener('mouseenter', () => self.showVolumeControl(clip));
      clip.addEventListener('mouseleave', (e) => self.hideVolumeControl(e));
      clip.addEventListener('click', (e) => {
        e.preventDefault();
        self.handleClipClick(clip);
      });
      clip.addEventListener('dblclick', (e) => {
        e.preventDefault();
        self.handleClipStop(clip);
      });

      // 长按停止
      let longPressTimer = null;
      clip.addEventListener('mousedown', () => {
        longPressTimer = setTimeout(() => self.handleClipStop(clip), 500);
      });
      clip.addEventListener('mouseup', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
      clip.addEventListener('mouseleave', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
