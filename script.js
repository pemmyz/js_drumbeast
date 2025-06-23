document.addEventListener('DOMContentLoaded', () => {
    // --- Dark Mode ---
    const darkModeToggleBtn = document.getElementById('dark-mode-toggle');
    const body = document.body;

    function setDarkMode(enabled) {
        if (enabled) {
            body.classList.remove('light-mode');
            darkModeToggleBtn.textContent = '☀️ Light Mode';
        } else {
            body.classList.add('light-mode');
            darkModeToggleBtn.textContent = '🌙 Dark Mode';
        }
        localStorage.setItem('darkMode', enabled ? 'enabled' : 'disabled');
    }

    darkModeToggleBtn.addEventListener('click', () => {
        setDarkMode(body.classList.contains('light-mode'));
        darkModeToggleBtn.blur();
    });

    const savedDarkMode = localStorage.getItem('darkMode');
    setDarkMode(savedDarkMode === null || savedDarkMode === 'enabled');

    // --- Audio Setup & State ---
    let audioContext;
    let noiseBuffer;
    let openHiHatGain;

    const statusDiv = document.getElementById('audio-status');
    const noteDisplay = document.getElementById('note-display');

    const keyToDrumMap = {
        'q': 'kick', 'w': 'snare', 'e': 'hatClosed', 'r': 'hatOpen',
        'a': 'tom1', 's': 'tom2', 'd': 'tom3', 'f': 'crash'
    };
    const drumDisplayNames = {
        'kick': 'Kick', 'snare': 'Snare', 'hatClosed': 'Hat (C)', 'hatOpen': 'Hat (O)',
        'tom1': 'Tom 1', 'tom2': 'Tom 2', 'tom3': 'Tom 3', 'crash': 'Crash'
    };

    const kbdElements = {};
    document.querySelectorAll('kbd').forEach(kbd => {
        const key = kbd.dataset.key;
        if (key) kbdElements[key] = kbd;
    });

    // --- Sequencer State ---
    let isRecording = false;
    let recordingStartTime = 0;
    let recordedSequence = [];
    let isPlayingBack = false;
    let playbackTimeouts = [];
    let loopDuration = 0;
    let sequenceDisplayLineInfo = [];

    // --- UI Elements ---
    const sidePanel = document.getElementById('side-panel');
    const togglePanelBtn = document.getElementById('toggle-panel-btn');
    const recordBtn = document.getElementById('record-btn');
    const playBtn = document.getElementById('play-btn');
    const stopPlaybackBtn = document.getElementById('stop-playback-btn');
    const sequenceDisplay = document.getElementById('note-sequence-display');
    const copySequenceBtn = document.getElementById('copy-sequence-btn');
    const pasteSequenceBtn = document.getElementById('paste-sequence-btn');
    const exportBtn = document.getElementById('export-btn');
    const importFileInput = document.getElementById('import-file-input');
    const importLabel = document.querySelector('label[for="import-file-input"]');
    const clearSequenceBtn = document.getElementById('clear-sequence-btn');

    // --- Panel Management ---
    togglePanelBtn.addEventListener('click', () => {
        const isVisible = sidePanel.classList.contains('visible');
        if (isVisible) {
            sidePanel.classList.remove('visible');
            body.classList.remove('panel-open-main-adjust');
            togglePanelBtn.textContent = '🎹 Beat Sequencer';
        } else {
            sidePanel.classList.add('visible');
            body.classList.add('panel-open-main-adjust');
            togglePanelBtn.textContent = '➡️ Close Sequencer';
        }
        togglePanelBtn.blur();
    });
    
    // --- Audio Initialization ---
    function initializeAudio() {
        return new Promise((resolve, reject) => {
            if (audioContext && audioContext.state === 'running') {
                resolve(); return;
            }
            try {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const bufferSize = 2 * audioContext.sampleRate;
                    noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
                    const output = noiseBuffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) {
                        output[i] = Math.random() * 2 - 1;
                    }
                }
                audioContext.resume().then(() => {
                    updateAudioStatus("Audio Ready", "ready"); resolve();
                }).catch(e => {
                    updateAudioStatus("Error resuming audio.", "error"); reject(e);
                });
            } catch (e) {
                updateAudioStatus("Web Audio API not supported.", "error"); reject(e);
            }
        });
    }

    function updateAudioStatus(message = '', type = '') {
        if (!statusDiv) return;
        statusDiv.className = '';
        if (type) statusDiv.classList.add(type);
        statusDiv.textContent = message;
    }
    
    // --- Drum Sound Synthesis Functions ---
    function playKick() {
        if (!audioContext) return; const now = audioContext.currentTime;
        const osc = audioContext.createOscillator(); const gain = audioContext.createGain();
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.5);
        gain.gain.setValueAtTime(1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    }

    function playSnare() {
        if (!audioContext) return; const now = audioContext.currentTime;
        const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer;
        const noiseFilter = audioContext.createBiquadFilter(); noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 1500; noiseFilter.Q.value = 0.5;
        const noiseGain = audioContext.createGain(); noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain); noiseGain.connect(audioContext.destination);
        const osc = audioContext.createOscillator(); osc.type = 'triangle';
        const oscGain = audioContext.createGain(); osc.connect(oscGain);
        oscGain.connect(audioContext.destination);
        noiseGain.gain.setValueAtTime(1, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.frequency.setValueAtTime(100, now); oscGain.gain.setValueAtTime(0.7, now);
        oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        noise.start(now); osc.start(now);
        noise.stop(now + 0.2); osc.stop(now + 0.1);
    }
    
    function chokeOpenHiHat() {
        if (openHiHatGain) {
            const now = audioContext.currentTime;
            openHiHatGain.gain.cancelScheduledValues(now);
            openHiHatGain.gain.setValueAtTime(openHiHatGain.gain.value, now);
            openHiHatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
            openHiHatGain = null;
        }
    }

    function playHat(isOpen) {
        if (!audioContext) return;
        if (isOpen) { chokeOpenHiHat(); } else { chokeOpenHiHat(); }
        const now = audioContext.currentTime;
        const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer;
        const bandpass = audioContext.createBiquadFilter(); bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000; bandpass.Q.value = 1.5;
        const highpass = audioContext.createBiquadFilter(); highpass.type = 'highpass';
        highpass.frequency.value = 7000;
        const gain = audioContext.createGain();
        noise.connect(highpass); highpass.connect(bandpass);
        bandpass.connect(gain); gain.connect(audioContext.destination);
        const decayTime = isOpen ? 0.5 : 0.05;
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + decayTime);
        if (isOpen) { openHiHatGain = gain; }
        noise.start(now); noise.stop(now + decayTime);
    }
    
    function playTom(pitch) {
        if (!audioContext) return; const now = audioContext.currentTime;
        const osc = audioContext.createOscillator(); const gain = audioContext.createGain();
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(pitch, now);
        osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.4);
        gain.gain.setValueAtTime(0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now); osc.stop(now + 0.4);
    }

    function playCrash() {
        if (!audioContext) return; const now = audioContext.currentTime;
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        gain.connect(audioContext.destination);
        const bandpass = audioContext.createBiquadFilter(); bandpass.type = 'bandpass';
        bandpass.frequency.value = 4000; bandpass.Q.value = 0.5;
        bandpass.connect(gain);
        const highpass = audioContext.createBiquadFilter(); highpass.type = 'highpass';
        highpass.frequency.value = 2000; highpass.connect(bandpass);
        const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer;
        noise.connect(highpass);
        noise.start(now); noise.stop(now + 1.2);
    }

    const soundBank = {
        'kick': playKick, 'snare': playSnare, 'hatClosed': () => playHat(false),
        'hatOpen': () => playHat(true), 'tom1': () => playTom(250), 'tom2': () => playTom(180),
        'tom3': () => playTom(120), 'crash': playCrash
    };

    function triggerDrum(key) {
        initializeAudio().then(() => {
            const drumType = keyToDrumMap[key];
            if (!drumType || !soundBank[drumType]) return;
            soundBank[drumType]();
            if (kbdElements[key]) {
                kbdElements[key].classList.add('active');
                setTimeout(() => kbdElements[key].classList.remove('active'), 100);
            }
            noteDisplay.textContent = drumDisplayNames[drumType];
            if (isRecording) {
                const now = audioContext.currentTime;
                const startTimeOffset = now - recordingStartTime;
                recordedSequence.push({ key, startTime: startTimeOffset, duration: 0.1, volume: 1.0 });
                updateSequenceDisplay();
                updateSequencerControls();
            }
        }).catch(err => console.error("Could not trigger drum:", err));
    }

    document.querySelectorAll('kbd[data-key]').forEach(kbd => {
        const key = kbd.dataset.key; if (!key) return;
        kbd.addEventListener('mousedown', (e) => { e.preventDefault(); if (isPlayingBack) return; triggerDrum(key); });
        kbd.addEventListener('touchstart', (e) => { e.preventDefault(); if (isPlayingBack) return; triggerDrum(key); }, { passive: false });
    });

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'TEXTAREA' || e.repeat || isPlayingBack) return;
        const key = e.key.toLowerCase();
        if (keyToDrumMap[key]) { e.preventDefault(); triggerDrum(key); }
        if (e.key === "Escape") { e.preventDefault(); if (isPlayingBack) stopSequencePlayback(true); }
    });

    function updateSequencerControls() {
        const hasSequence = recordedSequence.length > 0;
        const activityLock = isRecording || isPlayingBack;
        playBtn.disabled = !hasSequence || activityLock;
        exportBtn.disabled = !hasSequence || activityLock;
        copySequenceBtn.disabled = !hasSequence || activityLock;
        pasteSequenceBtn.disabled = activityLock;
        clearSequenceBtn.disabled = !hasSequence || activityLock;
        recordBtn.disabled = isPlayingBack;
        stopPlaybackBtn.disabled = !isPlayingBack;
        if (importLabel) {
            importFileInput.disabled = activityLock;
            importLabel.classList.toggle('disabled-label', activityLock);
        }
    }

    function updateSequenceDisplay(highlightIndex = -1) {
        sequenceDisplayLineInfo = [];
        let currentText = "";
        if (recordedSequence.length === 0) {
            sequenceDisplay.value = "";
            return;
        }

        const linesForInfo = recordedSequence.map((note, index) => {
            const drumName = drumDisplayNames[keyToDrumMap[note.key]] || 'Unknown';
            return `${String(index + 1).padStart(3, '0')}: ${drumName.padEnd(10)} @ ${note.startTime.toFixed(2)}s`;
        });
        currentText = linesForInfo.join('\n');
        
        let charIndex = 0;
        linesForInfo.forEach((line, idx) => {
            const start = charIndex;
            const end = charIndex + line.length;
            sequenceDisplayLineInfo.push({ start, end });
            charIndex = end + 1;
        });
        sequenceDisplay.value = currentText;

        if (highlightIndex > -1 && sequenceDisplayLineInfo[highlightIndex]) {
            const { start, end } = sequenceDisplayLineInfo[highlightIndex];
            if (document.activeElement !== sequenceDisplay && sidePanel.classList.contains('visible')) {
                sequenceDisplay.focus({ preventScroll: true });
            }
            if (document.activeElement === sequenceDisplay) {
                sequenceDisplay.setSelectionRange(start, end);
            }
            const ta = sequenceDisplay;
            const totalLines = linesForInfo.length;
            if (totalLines > 0) {
                const avgLineHeight = ta.scrollHeight / totalLines;
                const targetScrollTop = (highlightIndex * avgLineHeight) - (ta.clientHeight / 2) + (avgLineHeight / 2);
                ta.scrollTop = Math.max(0, targetScrollTop);
            }
        }
    }

    recordBtn.addEventListener('click', () => {
        initializeAudio().then(() => {
            isRecording = !isRecording;
            if (isRecording) {
                recordBtn.classList.add('recording');
                recordBtn.textContent = '▉ Stop Recording';
                recordingStartTime = audioContext.currentTime;
                recordedSequence = [];
                noteDisplay.textContent = "REC 🔴";
            } else {
                recordBtn.classList.remove('recording');
                recordBtn.textContent = '⏺️ Record Beat';
                noteDisplay.textContent = "REC ⏹️";
                if (recordedSequence.length > 0) {
                    recordedSequence.sort((a, b) => a.startTime - b.startTime);
                }
            }
            updateSequenceDisplay();
            updateSequencerControls();
        });
    });

    playBtn.addEventListener('click', () => {
        if (recordedSequence.length === 0 || isRecording || isPlayingBack) return;
        startPlayback();
    });

    stopPlaybackBtn.addEventListener('click', () => stopSequencePlayback(true));

    function startPlayback() {
        if (!audioContext || audioContext.state !== 'running') {
            initializeAudio().then(() => {
                if(audioContext.state === 'running') startPlayback();
            });
            return;
        }

        isPlayingBack = true;
        updateSequencerControls();
        noteDisplay.textContent = "PLAY ▶️";
        
        const maxTime = Math.max(0, ...recordedSequence.map(n => n.startTime));
        loopDuration = Math.ceil(maxTime + 0.2);
        if (loopDuration < 1) loopDuration = 1;

        runLoop();
    }
    
    function runLoop() {
        if (!isPlayingBack) return;

        recordedSequence.forEach((note, index) => {
            const playTimeoutId = setTimeout(() => {
                if (!isPlayingBack) return;
                
                soundBank[keyToDrumMap[note.key]]();
                updateSequenceDisplay(index);

                if (kbdElements[note.key]) {
                    kbdElements[note.key].classList.add('active');
                    setTimeout(() => kbdElements[note.key].classList.remove('active'), 100);
                }
                noteDisplay.textContent = `${drumDisplayNames[keyToDrumMap[note.key]]} (Seq)`;

            }, note.startTime * 1000);
            playbackTimeouts.push(playTimeoutId);
        });

        const loopTimeoutId = setTimeout(runLoop, loopDuration * 1000);
        playbackTimeouts.push(loopTimeoutId);
    }

    function stopSequencePlayback(manualStop = true) {
        if (!isPlayingBack) return;
        isPlayingBack = false;
        playbackTimeouts.forEach(clearTimeout);
        playbackTimeouts = [];
        chokeOpenHiHat();
        noteDisplay.textContent = "PLAY ⏹️";
        updateSequencerControls();
        updateSequenceDisplay(-1); // Clear highlight
        setTimeout(() => { if (noteDisplay.textContent.endsWith("(Seq)") || noteDisplay.textContent === "PLAY ⏹️") noteDisplay.textContent = ' '; }, 1500);
    }
    
    clearSequenceBtn.addEventListener('click', () => {
        recordedSequence = [];
        updateSequenceDisplay();
        updateSequencerControls();
        noteDisplay.textContent = "Beat Cleared";
        setTimeout(() => { if (noteDisplay.textContent === "Beat Cleared") noteDisplay.textContent = ' '; }, 1500);
    });

    function processLoadedSequenceData(notes) {
        recordedSequence = notes.map(n => ({ key: n.key, startTime: parseFloat(n.startTime || 0), duration: 0.1, volume: 1.0 }));
        recordedSequence.sort((a, b) => a.startTime - b.startTime);
        updateSequenceDisplay();
        updateSequencerControls();
    }

    exportBtn.addEventListener('click', () => {
        const dataToSave = recordedSequence.map(({ key, startTime }) => ({ key, startTime }));
        const jsonData = JSON.stringify(dataToSave, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        a.download = `drumbeast_beat_${timestamp}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });

    importFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedJson = JSON.parse(e.target.result);
                if (Array.isArray(importedJson)) {
                     processLoadedSequenceData(importedJson);
                     noteDisplay.textContent = "Beat Loaded";
                } else { alert('Invalid beat file format.'); }
            } catch (err) { alert('Error parsing beat file.'); }
        };
        reader.readAsText(file);
    });

    copySequenceBtn.addEventListener('click', () => {
        const dataToSave = recordedSequence.map(({ key, startTime }) => ({ key, startTime }));
        const jsonSequence = JSON.stringify(dataToSave, null, 2);
        navigator.clipboard.writeText(jsonSequence).then(() => { noteDisplay.textContent = "Beat copied!"; })
        .catch(err => console.error('Copy failed: ', err));
    });

    pasteSequenceBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            const importedJson = JSON.parse(text);
            if (Array.isArray(importedJson)) {
                processLoadedSequenceData(importedJson);
                noteDisplay.textContent = "Beat Pasted!";
            } else { noteDisplay.textContent = "Clipboard data is not a valid beat."; }
        } catch (err) { noteDisplay.textContent = "Paste failed or invalid format."; }
    });

    updateSequencerControls();
    const initialUnlockHandler = () => {
        initializeAudio().then(() => {
            document.body.removeEventListener('click', initialUnlockHandler);
            document.body.removeEventListener('keydown', initialUnlockHandler);
        });
    };
    document.body.addEventListener('click', initialUnlockHandler);
    document.body.addEventListener('keydown', initialUnlockHandler);
});
