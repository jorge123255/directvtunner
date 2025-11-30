// Popup script

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');

  // Update stats display
  function updateStats() {
    chrome.runtime.sendMessage({ action: 'getData' }, (data) => {
      if (data) {
        document.getElementById('requestCount').textContent = data.requests?.length || 0;
        document.getElementById('headerCount').textContent = data.headers?.length || 0;
        document.getElementById('cookieCount').textContent = data.cookies?.length || 0;
        document.getElementById('eventCount').textContent = data.pageData?.length || 0;

        if (data.isRecording) {
          statusEl.className = 'status recording';
          statusEl.textContent = 'Status: Recording...';
        } else {
          statusEl.className = 'status stopped';
          statusEl.textContent = 'Status: Not Recording';
        }
      }
    });
  }

  // Initial update
  updateStats();

  // Update every second while popup is open
  setInterval(updateStats, 1000);

  // Start recording
  startBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
      if (response?.success) {
        statusEl.className = 'status recording';
        statusEl.textContent = 'Status: Recording...';
      }
    });
  });

  // Stop recording
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
      if (response?.success) {
        statusEl.className = 'status stopped';
        statusEl.textContent = 'Status: Stopped';
        updateStats();
      }
    });
  });

  // Export data
  exportBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'exportData' }, (data) => {
      if (data) {
        // Create downloadable JSON
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = `directv-capture-${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('Exported data:', data);
      }
    });
  });

  // Clear data
  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'startRecording' });
    chrome.runtime.sendMessage({ action: 'stopRecording' });
    updateStats();
  });
});
