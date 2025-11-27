const { Tuner, TunerState } = require('./tuner');
const config = require('./config');

class TunerManager {
  constructor() {
    this.tuners = [];
    this.initialized = false;
    // Track pending channel request to handle rapid surfing
    this.pendingChannel = null;
    this.pendingResolvers = [];
    this.tuningLock = false;
  }

  async initialize() {
    if (this.initialized) return;

    console.log(`[tuner-manager] Initializing ${config.numTuners} tuner(s)...`);

    for (let i = 0; i < config.numTuners; i++) {
      const tuner = new Tuner(i);
      this.tuners.push(tuner);

      try {
        await tuner.start();
      } catch (err) {
        console.error(`[tuner-manager] Failed to start tuner ${i}:`, err.message);
      }
    }

    this.initialized = true;
    console.log(`[tuner-manager] Initialized ${this.tuners.filter(t => t.state === TunerState.FREE).length} tuner(s)`);

    // Start idle cleanup interval
    this.startIdleCleanup();
  }

  startIdleCleanup() {
    setInterval(() => {
      for (const tuner of this.tuners) {
        if (tuner.state === TunerState.STREAMING && tuner.isIdle()) {
          console.log(`[tuner-manager] Tuner ${tuner.id} is idle, releasing...`);
          this.releaseTuner(tuner.id);
        }
      }
    }, 60000);  // Check every minute
  }

  // Find a tuner for the requested channel
  // Handles rapid channel surfing by queuing and debouncing requests
  async allocateTuner(channelId) {
    // First, check if any tuner is already streaming this channel
    const existingTuner = this.tuners.find(
      t => t.state === TunerState.STREAMING && t.currentChannel === channelId
    );

    if (existingTuner) {
      console.log(`[tuner-manager] Reusing tuner ${existingTuner.id} already on ${channelId}`);
      existingTuner.addClient();
      return existingTuner;
    }

    // Check if a tuner is currently TUNING to this channel - wait for it
    const tuningToThis = this.tuners.find(
      t => t.state === TunerState.TUNING && t.currentChannel === channelId
    );

    if (tuningToThis) {
      console.log(`[tuner-manager] Tuner ${tuningToThis.id} already tuning to ${channelId}, waiting...`);
      // Wait for the tuner to finish tuning (poll every 500ms)
      const maxWait = 30000;
      let waited = 0;
      while (waited < maxWait) {
        await new Promise(r => setTimeout(r, 500));
        waited += 500;
        if (tuningToThis.state === TunerState.STREAMING && tuningToThis.currentChannel === channelId) {
          console.log(`[tuner-manager] Tuner ${tuningToThis.id} finished tuning to ${channelId}`);
          tuningToThis.addClient();
          return tuningToThis;
        }
        if (tuningToThis.state === TunerState.ERROR || tuningToThis.state === TunerState.FREE) {
          console.log(`[tuner-manager] Tuner ${tuningToThis.id} tuning failed, will try allocation`);
          break;
        }
      }
    }

    // If we're currently tuning to a DIFFERENT channel, this is channel surfing
    // Queue this request and cancel/supersede the current one
    const tuningTuner = this.tuners.find(t => t.state === TunerState.TUNING);
    if (tuningTuner && tuningTuner.currentChannel !== channelId) {
      console.log(`[tuner-manager] Channel surf detected: ${tuningTuner.currentChannel} -> ${channelId}, queuing new channel`);

      // Store the new channel as the target - the current tune will complete
      // but we'll immediately switch to this one
      this.pendingChannel = channelId;

      // Wait for the current tuning to complete
      const maxWait = 35000;
      let waited = 0;
      while (waited < maxWait && tuningTuner.state === TunerState.TUNING) {
        await new Promise(r => setTimeout(r, 500));
        waited += 500;

        // Check if another channel was requested during this wait
        if (this.pendingChannel !== channelId) {
          console.log(`[tuner-manager] Channel ${channelId} superseded by ${this.pendingChannel}`);
          return null;  // This request is no longer relevant
        }
      }

      // Clear pending since we're about to process this
      this.pendingChannel = null;

      // Now switch to the new channel
      if (tuningTuner.state === TunerState.STREAMING || tuningTuner.state === TunerState.FREE) {
        console.log(`[tuner-manager] Now switching to queued channel ${channelId}`);
        tuningTuner.clients = 0;
        await tuningTuner.tuneToChannel(channelId);
        tuningTuner.addClient();
        return tuningTuner;
      }
    }

    // Find a free tuner
    const freeTuner = this.tuners.find(t => t.state === TunerState.FREE);

    if (freeTuner) {
      console.log(`[tuner-manager] Allocating free tuner ${freeTuner.id} for ${channelId}`);
      await freeTuner.tuneToChannel(channelId);
      freeTuner.addClient();
      return freeTuner;
    }

    // No free tuners - check for idle tuners we can steal
    const idleTuner = this.tuners
      .filter(t => t.state === TunerState.STREAMING && t.clients === 0)
      .sort((a, b) => a.lastActivity - b.lastActivity)[0];

    if (idleTuner) {
      console.log(`[tuner-manager] Stealing idle tuner ${idleTuner.id} for ${channelId}`);
      await idleTuner.tuneToChannel(channelId);
      idleTuner.addClient();
      return idleTuner;
    }

    // AUTO-SWITCH: For single-tuner setup, auto-switch busy tuner to new channel
    // This allows channel switching without manual release
    const busyTuner = this.tuners.find(t => t.state === TunerState.STREAMING);
    if (busyTuner) {
      console.log(`[tuner-manager] Auto-switching tuner ${busyTuner.id} from ${busyTuner.currentChannel} to ${channelId}`);
      // Reset clients since we're switching to a new channel
      busyTuner.clients = 0;
      await busyTuner.tuneToChannel(channelId);
      busyTuner.addClient();
      return busyTuner;
    }

    // All tuners busy with active clients or in error state
    console.log(`[tuner-manager] All tuners busy or unavailable`);
    return null;
  }

  // Get tuner by ID
  getTuner(tunerId) {
    return this.tuners.find(t => t.id === parseInt(tunerId));
  }

  // Release a client from a tuner
  releaseClient(tunerId) {
    const tuner = this.getTuner(tunerId);
    if (tuner) {
      tuner.removeClient();
    }
  }

  // Force release a tuner (stop streaming)
  async releaseTuner(tunerId) {
    const tuner = this.getTuner(tunerId);
    if (tuner && tuner.state === TunerState.STREAMING) {
      // Stop FFmpeg but keep Chrome running
      if (tuner.ffmpeg) {
        tuner.ffmpeg.stop();
      }
      tuner.state = TunerState.FREE;
      tuner.currentChannel = null;
      tuner.clients = 0;
      console.log(`[tuner-manager] Released tuner ${tunerId}`);
    }
  }

  // Get status of all tuners
  getStatus() {
    return {
      numTuners: this.tuners.length,
      tuners: this.tuners.map(t => t.getStatus()),
    };
  }

  // Shutdown all tuners
  async shutdown() {
    console.log(`[tuner-manager] Shutting down all tuners...`);
    for (const tuner of this.tuners) {
      await tuner.stop();
    }
    this.tuners = [];
    this.initialized = false;
  }
}

// Singleton instance
const tunerManager = new TunerManager();

module.exports = tunerManager;
