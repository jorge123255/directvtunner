const { Tuner, TunerState } = require('./tuner');
const config = require('./config');

class TunerManager {
  constructor() {
    this.tuners = [];
    this.initialized = false;
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
  async allocateTuner(channelId) {
    // First, check if any tuner is already on this channel
    const existingTuner = this.tuners.find(
      t => t.state === TunerState.STREAMING && t.currentChannel === channelId
    );

    if (existingTuner) {
      console.log(`[tuner-manager] Reusing tuner ${existingTuner.id} already on ${channelId}`);
      existingTuner.addClient();
      return existingTuner;
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

    // All tuners busy with active clients
    console.log(`[tuner-manager] All tuners busy`);
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
