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
    let globalVolume = 0.8;
    let limiter;

    // NEW: Voice Pooling System
    const soundPools = {};
    const POOL_SIZE = 10; // Number of voices per drum sound. 10 is plenty for rapid hits.
    
    const statusDiv = document.getElementById('audio-status');
    const noteDisplay = document.getElementById('note-display');
    const volumeSlider = document.getElementById('volume-slider');

    if (volumeSlider) {
        volumeSlider.value = globalVolume;
        volumeSlider.addEventListener('input', (e) => {
            globalVolume = parseFloat(e.target.value);
        });
    }

    const keyToDrumMap = {
        'q': 'kick', 'w': 'snare', 'e': 'hatClosed', 'r': 'hatOpen',
        'a': 'tom1', 's': 'tom2', 'd': 'tom3', 'f': 'crash',
        'z': 'clap', 'x': 'rimshot', 'v': 'ride', 'b': 'tambourine',
        'n': 'kick808', 'm': 'snare808'
    };
    const drumDisplayNames = {
        'kick': 'Kick', 'snare': 'Snare', 'hatClosed': 'Hat (C)', 'hatOpen': 'Hat (O)',
        'tom1': 'Tom 1', 'tom2': 'Tom 2', 'tom3': 'Tom 3', 'crash': 'Crash',
        'clap': 'Clap', 'rimshot': 'Rimshot', 'ride': 'Ride', 'tambourine': 'Tambourine',
        'kick808': '808 Kick', 'snare808': '808 Snare'
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

    function createLimiter(ctx) {
        const limiterNode = ctx.createDynamicsCompressor();
        limiterNode.threshold.setValueAtTime(-1.0, ctx.currentTime); // Threshold at -1dB
        limiterNode.knee.setValueAtTime(0, ctx.currentTime);      // Hard knee
        limiterNode.ratio.setValueAtTime(20, ctx.currentTime);     // 20:1 ratio for limiting
        limiterNode.attack.setValueAtTime(0.002, ctx.currentTime); // Fast attack
        limiterNode.release.setValueAtTime(0.1, ctx.currentTime);  // Fast release
        limiterNode.connect(ctx.destination);
        return limiterNode;
    }

    function initializeAudio() {
        return new Promise((resolve, reject) => {
            if (audioContext && audioContext.state === 'running') {
                resolve();
                return;
            }
            try {
                if (!audioContext) {
                    audioContext = new(window.AudioContext || window.webkitAudioContext)();
                    limiter = createLimiter(audioContext); // Create master limiter
                    const bufferSize = 2 * audioContext.sampleRate;
                    noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
                    const output = noiseBuffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) {
                        output[i] = Math.random() * 2 - 1;
                    }
                    // Pre-populate the sound pools
                    Object.keys(keyToDrumMap).forEach(key => {
                        soundPools[key] = { voices: [], index: 0 };
                        for (let i = 0; i < POOL_SIZE; i++) {
                            soundPools[key].voices.push({ busy: false });
                        }
                    });
                }
                audioContext.resume().then(() => {
                    updateAudioStatus("Audio Ready", "ready");
                    resolve();
                }).catch(e => {
                    updateAudioStatus("Error resuming audio.", "error");
                    reject(e);
                });
            } catch (e) {
                updateAudioStatus("Web Audio API not supported.", "error");
                reject(e);
            }
        });
    }

    function updateAudioStatus(message = '', type = '') {
        if (!statusDiv) return;
        statusDiv.className = '';
        if (type) statusDiv.classList.add(type);
        statusDiv.textContent = message;
    }

    // This function now gets a specific "voice" object from the pool to use
    function getVoiceFromPool(key) {
        if (!soundPools[key]) return null;
        const pool = soundPools[key];
        // Cycle through the pool to find a free voice
        for (let i = 0; i < POOL_SIZE; i++) {
            const voiceIndex = (pool.index + i) % POOL_SIZE;
            if (!pool.voices[voiceIndex].busy) {
                pool.index = (voiceIndex + 1) % POOL_SIZE; // Move index for next time
                return pool.voices[voiceIndex];
            }
        }
        // If all voices are busy, just return the next one in line (steals the voice)
        const voice = pool.voices[pool.index];
        pool.index = (pool.index + 1) % POOL_SIZE;
        return voice;
    }

    function playSound(key, playFunc) {
        if (!audioContext) return;
        const voice = getVoiceFromPool(key);
        if (!voice) return;
        
        voice.busy = true;
        
        // This stops any previously playing sound on this specific voice instance
        if(voice.sourceNodes) {
            voice.sourceNodes.forEach(node => {
                try { node.stop(); } catch (e) {}
                node.disconnect();
            });
        }
        
        // The play function now returns the nodes it created
        voice.sourceNodes = playFunc();

        // The sound is no longer busy after it has finished playing
        const totalDuration = 2000; // A safe upper limit for all sounds
        setTimeout(() => {
            voice.busy = false;
        }, totalDuration);
    }
    
    // --- Drum Sound Synthesis Functions (UPDATED FOR POOLING) ---
    // They now return an array of the top-level source nodes they create.
    function playKick() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); osc.connect(gain); gain.connect(limiter); osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.5); gain.gain.setValueAtTime(1 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.5); osc.start(now); osc.stop(now + 0.5); return [osc]; }
    function playSnare() { const now = audioContext.currentTime; const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const noiseFilter = audioContext.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1500; noiseFilter.Q.value = 0.5; const noiseGain = audioContext.createGain(); noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(limiter); const osc = audioContext.createOscillator(); osc.type = 'triangle'; const oscGain = audioContext.createGain(); osc.connect(oscGain); oscGain.connect(limiter); noiseGain.gain.setValueAtTime(1 * globalVolume, now); noiseGain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.2); osc.frequency.setValueAtTime(100, now); oscGain.gain.setValueAtTime(0.7 * globalVolume, now); oscGain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.1); noise.start(now); osc.start(now); noise.stop(now + 0.2); osc.stop(now + 0.1); return [noise, osc]; }
    
    let openHiHatNodes = [];
    function chokeOpenHiHat() {
        openHiHatNodes.forEach(node => {
            if (node.gain.value > 0) {
                 const now = audioContext.currentTime;
                 node.gain.cancelScheduledValues(now);
                 node.gain.setValueAtTime(node.gain.value, now);
                 node.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
            }
        });
        openHiHatNodes = [];
    }

    function playHat(isOpen) { const now = audioContext.currentTime; const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const bandpass = audioContext.createBiquadFilter(); bandpass.type = 'bandpass'; bandpass.frequency.value = 10000; bandpass.Q.value = 1.5; const highpass = audioContext.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 7000; const gain = audioContext.createGain(); noise.connect(highpass); highpass.connect(bandpass); bandpass.connect(gain); gain.connect(limiter); const decayTime = isOpen ? 0.5 : 0.05; if (isOpen) { chokeOpenHiHat(); openHiHatNodes.push(gain); } else { chokeOpenHiHat(); } gain.gain.setValueAtTime(0.5 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.001 * globalVolume, now + decayTime); noise.start(now); noise.stop(now + decayTime); return [noise]; }
    function playTom(pitch) { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); osc.connect(gain); gain.connect(limiter); osc.frequency.setValueAtTime(pitch, now); osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.4); gain.gain.setValueAtTime(0.8 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.4); osc.start(now); osc.stop(now + 0.4); return [osc]; }
    function playCrash() { const now = audioContext.currentTime; const gain = audioContext.createGain(); gain.gain.setValueAtTime(0.4 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.001 * globalVolume, now + 1.2); gain.connect(limiter); const bandpass = audioContext.createBiquadFilter(); bandpass.type = 'bandpass'; bandpass.frequency.value = 4000; bandpass.Q.value = 0.5; bandpass.connect(gain); const highpass = audioContext.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 2000; highpass.connect(bandpass); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(highpass); noise.start(now); noise.stop(now + 1.2); return [noise]; }
    function playClap() { const now = audioContext.currentTime; const gain = audioContext.createGain(); const filter = audioContext.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1000; filter.Q.value = 0.5; gain.connect(filter); filter.connect(limiter); gain.gain.setValueAtTime(1 * globalVolume, now); gain.gain.setValueAtTime(0, now + 0.01); gain.gain.setValueAtTime(1 * globalVolume, now + 0.02); gain.gain.setValueAtTime(0, now + 0.03); gain.gain.setValueAtTime(1 * globalVolume, now + 0.04); gain.gain.exponentialRampToValueAtTime(0.001 * globalVolume, now + 0.15); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(gain); noise.start(now); noise.stop(now + 0.2); return [noise]; }
    function playRimshot() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); osc.type = 'sine'; osc.frequency.value = 1500; const gain = audioContext.createGain(); gain.gain.setValueAtTime(1 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.05); osc.connect(gain); gain.connect(limiter); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const noiseGain = audioContext.createGain(); noiseGain.gain.setValueAtTime(0.2 * globalVolume, now); noiseGain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.02); noise.connect(noiseGain); noiseGain.connect(limiter); osc.start(now); osc.stop(now + 0.05); noise.start(now); noise.stop(now + 0.02); return [osc, noise]; }
    function playRide() { const now = audioContext.currentTime; const gain = audioContext.createGain(); gain.gain.setValueAtTime(0.3 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.001 * globalVolume, now + 2.5); gain.connect(limiter); const filter1 = audioContext.createBiquadFilter(); filter1.type = 'bandpass'; filter1.frequency.value = 5000; filter1.Q.value = 0.5; const filter2 = audioContext.createBiquadFilter(); filter2.type = 'bandpass'; filter2.frequency.value = 8000; filter2.Q.value = 0.4; filter1.connect(gain); filter2.connect(gain); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(filter1); noise.connect(filter2); noise.start(now); noise.stop(now + 2.5); return [noise]; }
    function playTambourine() { const now = audioContext.currentTime; const gain = audioContext.createGain(); gain.gain.setValueAtTime(0.5 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.001 * globalVolume, now + 0.3); gain.connect(limiter); const filter = audioContext.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 8000; filter.connect(gain); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(filter); noise.start(now); noise.stop(now + 0.3); return [noise]; }
    function play808Kick() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); osc.type = 'sine'; const gain = audioContext.createGain(); osc.connect(gain); gain.connect(limiter); osc.frequency.setValueAtTime(120, now); osc.frequency.exponentialRampToValueAtTime(30, now + 0.5); gain.gain.setValueAtTime(1 * globalVolume, now); gain.gain.linearRampToValueAtTime(0.001 * globalVolume, now + 0.9); osc.start(now); osc.stop(now + 1); const clickOsc = audioContext.createOscillator(); clickOsc.type = 'triangle'; const clickGain = audioContext.createGain(); clickOsc.connect(clickGain); clickGain.connect(limiter); clickOsc.frequency.value = 1000; clickGain.gain.setValueAtTime(0.3 * globalVolume, now); clickGain.gain.exponentialRampToValueAtTime(0.001 * globalVolume, now + 0.02); clickOsc.start(now); clickOsc.stop(now + 0.02); return [osc, clickOsc]; }
    function play808Snare() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 180; const oscGain = audioContext.createGain(); oscGain.gain.setValueAtTime(0.5 * globalVolume, now); oscGain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.2); osc.connect(oscGain); oscGain.connect(limiter); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const noiseFilter = audioContext.createBiquadFilter(); noiseFilter.type = 'highpass'; noiseFilter.frequency.value = 1000; const noiseGain = audioContext.createGain(); noiseGain.gain.setValueAtTime(1 * globalVolume, now); noiseGain.gain.exponentialRampToValueAtTime(0.01 * globalVolume, now + 0.15); noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(limiter); osc.start(now); osc.stop(now + 0.2); noise.start(now); noise.stop(now + 0.15); return [osc, noise]; }

    const soundBank = {
        'kick': playKick, 'snare': playSnare, 'hatClosed': () => playHat(false),
        'hatOpen': () => playHat(true), 'tom1': () => playTom(250), 'tom2': () => playTom(180),
        'tom3': () => playTom(120), 'crash': playCrash,
        'clap': playClap, 'rimshot': playRimshot, 'ride': playRide, 'tambourine': playTambourine,
        'kick808': play808Kick, 'snare808': play808Snare
    };

    function triggerDrum(key) {
        initializeAudio().then(() => {
            const drumType = keyToDrumMap[key];
            if (!drumType || !soundBank[drumType]) return;

            // Use the new playSound function with the pool
            playSound(key, soundBank[drumType]);

            if (kbdElements[key]) {
                kbdElements[key].classList.add('active');
                setTimeout(() => kbdElements[key].classList.remove('active'), 100);
            }
            noteDisplay.textContent = drumDisplayNames[drumType];
            if (isRecording) {
                const now = audioContext.currentTime;
                const startTimeOffset = now - recordingStartTime;
                recordedSequence.push({
                    key,
                    startTime: startTimeOffset,
                    duration: 0.1,
                    volume: 1.0
                });
                updateSequenceDisplay();
                updateSequencerControls();
            }
        }).catch(err => console.error("Could not trigger drum:", err));
    }

    // --- Event Listeners and Sequencer Logic (mostly unchanged) ---
    document.querySelectorAll('kbd[data-key]').forEach(kbd => { const key = kbd.dataset.key; if (!key) return; kbd.addEventListener('mousedown', (e) => { e.preventDefault(); if (isPlayingBack) return; triggerDrum(key); }); kbd.addEventListener('touchstart', (e) => { e.preventDefault(); if (isPlayingBack) return; triggerDrum(key); }, { passive: false }); });
    window.addEventListener('keydown', (e) => { if (e.target.tagName === 'TEXTAREA' || e.repeat || isPlayingBack) return; const key = e.key.toLowerCase(); if (keyToDrumMap[key]) { e.preventDefault(); triggerDrum(key); } if (e.key === "Escape") { e.preventDefault(); if (isPlayingBack) stopSequencePlayback(true); } });
    function updateSequencerControls() { const hasSequence = recordedSequence.length > 0; const activityLock = isRecording || isPlayingBack; playBtn.disabled = !hasSequence || activityLock; exportBtn.disabled = !hasSequence || activityLock; copySequenceBtn.disabled = !hasSequence || activityLock; pasteSequenceBtn.disabled = activityLock; clearSequenceBtn.disabled = !hasSequence || activityLock; recordBtn.disabled = isPlayingBack; stopPlaybackBtn.disabled = !isPlayingBack; if (importLabel) { importFileInput.disabled = activityLock; importLabel.classList.toggle('disabled-label', activityLock); } }
    function updateSequenceDisplay(highlightIndex = -1) { sequenceDisplayLineInfo = []; let currentText = ""; if (recordedSequence.length === 0) { sequenceDisplay.value = ""; return; } const linesForInfo = recordedSequence.map((note, index) => { const drumName = drumDisplayNames[keyToDrumMap[note.key]] || 'Unknown'; return `${String(index + 1).padStart(3, '0')}: ${drumName.padEnd(10)} @ ${note.startTime.toFixed(2)}s`; }); currentText = linesForInfo.join('\n'); let charIndex = 0; linesForInfo.forEach((line, idx) => { const start = charIndex; const end = charIndex + line.length; sequenceDisplayLineInfo.push({ start, end }); charIndex = end + 1; }); sequenceDisplay.value = currentText; if (highlightIndex > -1 && sequenceDisplayLineInfo[highlightIndex]) { const { start, end } = sequenceDisplayLineInfo[highlightIndex]; if (document.activeElement !== sequenceDisplay && sidePanel.classList.contains('visible')) { sequenceDisplay.focus({ preventScroll: true }); } if (document.activeElement === sequenceDisplay) { sequenceDisplay.setSelectionRange(start, end); } const ta = sequenceDisplay; const totalLines = linesForInfo.length; if (totalLines > 0) { const avgLineHeight = ta.scrollHeight / totalLines; const targetScrollTop = (highlightIndex * avgLineHeight) - (ta.clientHeight / 2) + (avgLineHeight / 2); ta.scrollTop = Math.max(0, targetScrollTop); } } }
    recordBtn.addEventListener('click', () => { initializeAudio().then(() => { isRecording = !isRecording; if (isRecording) { recordBtn.classList.add('recording'); recordBtn.textContent = '▉ Stop Recording'; recordingStartTime = audioContext.currentTime; recordedSequence = []; noteDisplay.textContent = "REC 🔴"; } else { recordBtn.classList.remove('recording'); recordBtn.textContent = '⏺️ Record Beat'; noteDisplay.textContent = "REC ⏹️"; if (recordedSequence.length > 0) { recordedSequence.sort((a, b) => a.startTime - b.startTime); } } updateSequenceDisplay(); updateSequencerControls(); }); });
    playBtn.addEventListener('click', () => { if (recordedSequence.length === 0 || isRecording || isPlayingBack) return; startPlayback(); });
    stopPlaybackBtn.addEventListener('click', () => stopSequencePlayback(true));
    function startPlayback() { if (!audioContext || audioContext.state !== 'running') { initializeAudio().then(() => { if(audioContext.state === 'running') startPlayback(); }); return; } isPlayingBack = true; updateSequencerControls(); noteDisplay.textContent = "PLAY ▶️"; const maxTime = Math.max(0, ...recordedSequence.map(n => n.startTime)); loopDuration = Math.ceil(maxTime + 0.2); if (loopDuration < 1) loopDuration = 1; runLoop(); }
    function runLoop() { if (!isPlayingBack) return; recordedSequence.forEach((note, index) => { const playTimeoutId = setTimeout(() => { if (!isPlayingBack) return; triggerDrum(note.key); updateSequenceDisplay(index); noteDisplay.textContent = `${drumDisplayNames[keyToDrumMap[note.key]]} (Seq)`; }, note.startTime * 1000); playbackTimeouts.push(playTimeoutId); }); const loopTimeoutId = setTimeout(runLoop, loopDuration * 1000); playbackTimeouts.push(loopTimeoutId); }
    function stopSequencePlayback(manualStop = true) { if (!isPlayingBack) return; isPlayingBack = false; playbackTimeouts.forEach(clearTimeout); playbackTimeouts = []; chokeOpenHiHat(); noteDisplay.textContent = "PLAY ⏹️"; updateSequencerControls(); updateSequenceDisplay(-1); setTimeout(() => { if (noteDisplay.textContent.endsWith("(Seq)") || noteDisplay.textContent === "PLAY ⏹️") noteDisplay.textContent = ' '; }, 1500); }
    clearSequenceBtn.addEventListener('click', () => { recordedSequence = []; updateSequenceDisplay(); updateSequencerControls(); noteDisplay.textContent = "Beat Cleared"; setTimeout(() => { if (noteDisplay.textContent === "Beat Cleared") noteDisplay.textContent = ' '; }, 1500); });
    function processLoadedSequenceData(notes) { recordedSequence = notes.map(n => ({ key: n.key, startTime: parseFloat(n.startTime || 0), duration: 0.1, volume: 1.0 })); recordedSequence.sort((a, b) => a.startTime - b.startTime); updateSequenceDisplay(); updateSequencerControls(); }
    exportBtn.addEventListener('click', () => { const dataToSave = recordedSequence.map(({ key, startTime }) => ({ key, startTime })); const jsonData = JSON.stringify(dataToSave, null, 2); const blob = new Blob([jsonData], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, ''); a.download = `drumbeast_beat_${timestamp}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); });
    importFileInput.addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { try { let fileContent = e.target.result; const contentWithoutComments = fileContent.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (match, group1) => group1 ? '' : match); const importedJson = JSON.parse(contentWithoutComments); if (Array.isArray(importedJson) && (importedJson.length === 0 || importedJson.every(n => n.key && n.startTime !== undefined))) { processLoadedSequenceData(importedJson); noteDisplay.textContent = "Beat Loaded"; setTimeout(() => { if (noteDisplay.textContent === "Beat Loaded") noteDisplay.textContent = ' '; }, 2000); } else { alert('Invalid beat file format.'); } } catch (err) { console.error('Error parsing beat file:', err); alert('Error parsing beat file.'); } finally { importFileInput.value = ''; } }; reader.readAsText(file); });
    copySequenceBtn.addEventListener('click', () => { if (recordedSequence.length === 0) return; const dataToSave = recordedSequence.map(({ key, startTime }) => ({ key, startTime })); const jsonSequence = JSON.stringify(dataToSave, null, 2); navigator.clipboard.writeText(jsonSequence).then(() => { noteDisplay.textContent = "Beat copied!"; setTimeout(() => { if (noteDisplay.textContent === "Beat copied!") noteDisplay.textContent = ' '; }, 1500); }).catch(err => { console.error('Copy failed: ', err); noteDisplay.textContent = "Copy failed!"; setTimeout(() => { if (noteDisplay.textContent === "Copy failed!") noteDisplay.textContent = ' '; }, 1500); }); });
    pasteSequenceBtn.addEventListener('click', async () => { if (isRecording) recordBtn.click(); if (isPlayingBack) stopSequencePlayback(true); try { if (!navigator.clipboard || !navigator.clipboard.readText) { noteDisplay.textContent = "Clipboard API not supported."; setTimeout(() => { if (noteDisplay.textContent.startsWith("Clipboard API")) noteDisplay.textContent = ' '; }, 3000); return; } const text = await navigator.clipboard.readText(); if (text.trim() === "") { noteDisplay.textContent = "Clipboard is empty."; setTimeout(() => { if (noteDisplay.textContent === "Clipboard is empty.") noteDisplay.textContent = ' '; }, 2000); return; } let jsonContentToParse = text.trim(); if (jsonContentToParse.includes('//')) { jsonContentToParse = jsonContentToParse.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (match, group1) => group1 ? '' : match); } const importedJson = JSON.parse(jsonContentToParse); if (Array.isArray(importedJson) && (importedJson.length === 0 || importedJson.every(n => n.key && n.startTime !== undefined))) { processLoadedSequenceData(importedJson); noteDisplay.textContent = "Beat Pasted!"; setTimeout(() => { if (noteDisplay.textContent === "Beat Pasted!") noteDisplay.textContent = ' '; }, 2000); } else { noteDisplay.textContent = "Pasted data is not a valid beat."; setTimeout(() => { if (noteDisplay.textContent.startsWith("Pasted data")) noteDisplay.textContent = ' '; }, 3000); } } catch (err) { console.error('Paste failed:', err); noteDisplay.textContent = "Paste failed or invalid format."; setTimeout(() => { if (noteDisplay.textContent.startsWith("Paste failed")) noteDisplay.textContent = ' '; }, 3000); } updateSequencerControls(); });
    updateSequencerControls();
    const initialUnlockHandler = () => { initializeAudio().then(() => { document.body.removeEventListener('click', initialUnlockHandler); document.body.removeEventListener('keydown', initialUnlockHandler); }); }; document.body.addEventListener('click', initialUnlockHandler); document.body.addEventListener('keydown', initialUnlockHandler);
});
