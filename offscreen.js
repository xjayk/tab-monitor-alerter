let audioCtx = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAY_AUDIO') {
    playBeep();
  }
});

function playBeep() {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);

    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
        .then(() => {
          chrome.runtime.sendMessage({ type: 'AUDIO_OK' });
        })
        .catch((e) => {
          if (e.name === 'NotAllowedError') {
            chrome.runtime.sendMessage({ type: 'AUDIO_BLOCKED' });
          } else {
            console.error('Audio playback failed:', e);
          }
        });
    } else {
      chrome.runtime.sendMessage({ type: 'AUDIO_OK' });
    }
  } catch (e) {
    console.error('Audio playback failed:', e);
  }
}
