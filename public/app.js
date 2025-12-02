function settingsApp() {
  return {
    settings: {
      video: {
        resolution: { width: 1280, height: 720 },
        bitrate: '2500k'
      },
      audio: {
        bitrate: '128k'
      },
      hls: {
        segmentTime: 4,
        listSize: 5
      },
      epg: {
        refreshInterval: 4
      },
      tuners: {
        count: 1
      }
    },
    presets: [],
    activePreset: null,
    activeTab: 'video',
    isDirty: false,
    saving: false,
    toast: {
      show: false,
      message: '',
      type: 'success'
    },

    // Logs state
    logs: [],
    logFilter: 'all',
    autoScroll: true,
    logsStarted: false,
    logsInterval: null,
    maxLogs: 500,

    // System status
    systemStatus: {
      system: {
        ready: false,
        message: 'Starting...',
        browserReady: false,
        channelsLoaded: false,
        uptime: 0
      },
      login: {
        isLoggedIn: false,
        needsLogin: false,
        message: 'Checking...',
        currentUrl: ''
      },
      epg: {
        channelCount: 0,
        lastRefresh: null,
        isRefreshing: false
      },
      tuners: {
        total: 1,
        active: 0,
        list: []
      },
      cinemaos: {
        available: false,
        movieCount: 0
      },
      tv: {
        available: false,
        showCount: 0
      },
      automations: {
        loginWatcher: false,
        autoEpgRefresh: false
      }
    },
    statusInterval: null,

    // Base URL for playlist/EPG
    baseUrl: window.location.origin,

    // Reset streams state
    resettingStreams: false,

    // Version info
    versionInfo: {
      version: '',
      name: '',
      image: '',
      buildDate: null,
      nodeVersion: '',
      uptime: 0,
      uptimeFormatted: ''
    },

    async init() {
      await this.loadVersion();
      await this.loadStatus();
      await this.loadSettings();
      await this.loadPresets();
      // Refresh version/uptime every 60 seconds
      setInterval(() => this.loadVersion(), 60000);
      // Poll status every 5 seconds until ready, then every 30 seconds
      this.startStatusPolling();
    },

    async loadVersion() {
      try {
        const res = await fetch('/api/version');
        if (res.ok) {
          this.versionInfo = await res.json();
        }
      } catch (err) {
        console.error('Failed to load version:', err);
      }
    },

    async loadSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          this.settings = await res.json();
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
        this.showToast('Failed to load settings', 'error');
      }
    },

    async loadPresets() {
      try {
        const res = await fetch('/api/presets');
        if (res.ok) {
          this.presets = await res.json();
        }
      } catch (err) {
        console.error('Failed to load presets:', err);
      }
    },

    async saveSettings() {
      this.saving = true;
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings)
        });

        if (res.ok) {
          const data = await res.json();
          this.settings = data.settings;
          this.isDirty = false;
          this.showToast('Settings saved! Some changes may require a restart.', 'success');
        } else {
          const err = await res.json();
          this.showToast(err.error || 'Failed to save settings', 'error');
        }
      } catch (err) {
        console.error('Failed to save settings:', err);
        this.showToast('Failed to save settings', 'error');
      } finally {
        this.saving = false;
      }
    },

    async applyPreset(presetId) {
      try {
        const res = await fetch(`/api/presets/${presetId}`, {
          method: 'POST'
        });

        if (res.ok) {
          const data = await res.json();
          this.settings = data.settings;
          this.activePreset = presetId;
          this.isDirty = false;
          this.showToast(`Applied "${data.name}" preset`, 'success');
        } else {
          const err = await res.json();
          this.showToast(err.error || 'Failed to apply preset', 'error');
        }
      } catch (err) {
        console.error('Failed to apply preset:', err);
        this.showToast('Failed to apply preset', 'error');
      }
    },

    async resetToDefaults() {
      if (!confirm('Reset all settings to defaults?')) return;

      try {
        const res = await fetch('/api/settings/reset', {
          method: 'POST'
        });

        if (res.ok) {
          const data = await res.json();
          this.settings = data.settings;
          this.activePreset = null;
          this.isDirty = false;
          this.showToast('Settings reset to defaults', 'success');
        } else {
          this.showToast('Failed to reset settings', 'error');
        }
      } catch (err) {
        console.error('Failed to reset settings:', err);
        this.showToast('Failed to reset settings', 'error');
      }
    },

    markDirty() {
      this.isDirty = true;
      this.activePreset = null;
    },

    showToast(message, type = 'success') {
      this.toast.message = message;
      this.toast.type = type;
      this.toast.show = true;

      setTimeout(() => {
        this.toast.show = false;
      }, 3000);
    },

    // noVNC
    openVNC() {
      // Get the current host (assumes noVNC is on port 6080 of the same server)
      const host = window.location.hostname;
      const vncUrl = `http://${host}:6080/vnc.html?autoconnect=true`;
      window.open(vncUrl, '_blank');
    },

    // Copy URL to clipboard
    copyUrl(inputEl) {
      inputEl.select();
      navigator.clipboard.writeText(inputEl.value).then(() => {
        this.showToast('URL copied to clipboard', 'success');
      }).catch(() => {
        // Fallback for older browsers
        document.execCommand('copy');
        this.showToast('URL copied to clipboard', 'success');
      });
    },

    // Logs functionality
    get filteredLogs() {
      if (this.logFilter === 'all') {
        return this.logs;
      }
      return this.logs.filter(log => log.level === this.logFilter);
    },

    async startLogs() {
      this.logsStarted = true;
      await this.refreshLogs();
      // Poll for new logs every 2 seconds
      this.logsInterval = setInterval(() => this.refreshLogs(), 2000);
    },

    stopLogs() {
      if (this.logsInterval) {
        clearInterval(this.logsInterval);
        this.logsInterval = null;
      }
    },

    async refreshLogs() {
      try {
        const res = await fetch('/api/logs?lines=200');
        if (res.ok) {
          const data = await res.json();
          this.logs = data.logs || [];

          // Auto-scroll to bottom
          if (this.autoScroll) {
            this.$nextTick(() => {
              const container = this.$refs.logsContainer;
              if (container) {
                container.scrollTop = container.scrollHeight;
              }
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch logs:', err);
      }
    },

    clearLogs() {
      this.logs = [];
    },

    // Parse log line to extract level
    parseLogLine(line) {
      const time = new Date().toLocaleTimeString();
      let level = 'info';
      let message = line;

      // Detect log level from common patterns
      if (line.includes('[error]') || line.includes('Error:') || line.includes('ERROR')) {
        level = 'error';
      } else if (line.includes('[debug]') || line.includes('DEBUG')) {
        level = 'debug';
      } else if (line.includes('[warn]') || line.includes('WARN')) {
        level = 'warn';
      }

      return { time, level, message };
    },

    // Status functionality
    async loadStatus() {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();

          // Update system status
          this.systemStatus.system = {
            ready: data.system?.ready || false,
            message: data.system?.message || 'Unknown',
            browserReady: data.system?.browserReady || false,
            channelsLoaded: data.system?.channelsLoaded || false,
            uptime: data.system?.uptime || 0
          };

          // Update login status
          this.systemStatus.login = {
            isLoggedIn: data.login?.isLoggedIn || false,
            needsLogin: data.login?.needsLogin || false,
            message: data.login?.message || 'Unknown',
            currentUrl: data.login?.currentUrl || ''
          };

          // Update EPG status
          this.systemStatus.epg = {
            channelCount: data.epg?.channelCount || 0,
            lastRefresh: data.epg?.lastFetch || null,
            isRefreshing: data.epg?.isRefreshing || false
          };

          // Update tuners status
          const tunerList = (data.tuners?.tuners || []).map(t => ({
            id: t.id,
            streaming: t.state === 'streaming',
            channel: t.channel || '',
            channelName: t.channelName || '',
            state: t.state,
            uptime: t.stream?.uptimeFormatted || '',
            bytes: t.stream?.bytesFormatted || ''
          }));
          const activeCount = tunerList.filter(t => t.streaming).length;
          this.systemStatus.tuners = {
            total: data.tuners?.numTuners || 1,
            active: activeCount,
            list: tunerList
          };

          // Update CinemaOS status
          this.systemStatus.cinemaos = {
            available: data.cinemaos?.enabled || false,
            movieCount: data.cinemaos?.movieCount || 0
          };

          // Update TV status
          this.systemStatus.tv = {
            available: data.tv?.enabled || false,
            showCount: data.tv?.showCount || 0
          };

          // Update automations status
          this.systemStatus.automations = {
            loginWatcher: data.automations?.loginWatcher || false,
            autoEpgRefresh: data.automations?.autoEpgRefresh || false
          };
        }
      } catch (err) {
        console.error('Failed to load status:', err);
      }
    },

    async resetStreams() {
      if (!confirm('Kill all FFmpeg processes and reset tuners? Active streams will be interrupted.')) {
        return;
      }
      this.resettingStreams = true;
      try {
        const res = await fetch('/api/ffmpeg/kill', { method: 'POST' });
        if (res.ok) {
          this.showToast('Streams reset successfully', 'success');
          setTimeout(() => this.loadStatus(), 1000);
        } else {
          const err = await res.json();
          this.showToast(err.error || 'Failed to reset streams', 'error');
        }
      } catch (err) {
        console.error('Failed to reset streams:', err);
        this.showToast('Failed to reset streams', 'error');
      } finally {
        this.resettingStreams = false;
      }
    },

    async refreshEpg() {
      this.systemStatus.epg.isRefreshing = true;
      try {
        const res = await fetch('/tve/directv/epg/refresh', {
          method: 'POST'
        });
        if (res.ok) {
          this.showToast('EPG refresh started', 'success');
          // Poll for completion
          setTimeout(() => this.loadStatus(), 3000);
          setTimeout(() => this.loadStatus(), 10000);
          setTimeout(() => this.loadStatus(), 30000);
        } else {
          this.showToast('Failed to start EPG refresh', 'error');
          this.systemStatus.epg.isRefreshing = false;
        }
      } catch (err) {
        console.error('Failed to refresh EPG:', err);
        this.showToast('Failed to refresh EPG', 'error');
        this.systemStatus.epg.isRefreshing = false;
      }
    },

    formatTime(timestamp) {
      if (!timestamp) return 'Never';
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} min ago`;

      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    },

    startStatusPolling() {
      if (!this.statusInterval) {
        this.statusInterval = setInterval(() => this.loadStatus(), 10000);
      }
    },

    stopStatusPolling() {
      if (this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = null;
      }
    }
  };
}
