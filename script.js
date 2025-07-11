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
    let globalGain = 1.0;
    let limiter;
    let openHiHatGains = [];

    const statusDiv = document.getElementById('audio-status');
    const noteDisplay = document.getElementById('note-display');
    const gainSlider = document.getElementById('gain-slider');
    const volumeSlider = document.getElementById('volume-slider');

    if (gainSlider) {
        gainSlider.value = globalGain;
        gainSlider.addEventListener('input', (e) => {
            globalGain = parseFloat(e.target.value);
        });
    }
    if (volumeSlider) {
        volumeSlider.value = globalVolume;
        volumeSlider.addEventListener('input', (e) => {
            globalVolume = parseFloat(e.target.value);
        });
    }

    // --- Metronome and Turbo State ---
    let isMetronomeOn = false;
    let isTurboOn = false;
    let bpm = 120;
    let turboDivision = 16;
    let schedulerIntervalId = null;
    let nextNoteTime = 0.0;
    let scheduleBeatCounter = 0;
    let turboKeyDown = null;

    const metronomeToggle = document.getElementById('metronome-toggle');
    const bpmSlider = document.getElementById('bpm-slider');
    const bpmDisplay = document.getElementById('bpm-display');
    const turboToggle = document.getElementById('turbo-toggle');
    const turboDivisionSelect = document.getElementById('turbo-division');

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
    
    // --- MODIFIED SECTION ---
    // Global flag to track mouse button state for hover-to-play functionality.
    let isMouseDown = false;
    window.addEventListener('mousedown', () => { isMouseDown = true; });
    window.addEventListener('mouseup', () => { isMouseDown = false; });
    // Handle case where user releases mouse button outside the window
    window.addEventListener('mouseleave', () => { isMouseDown = false; });
    // --- END MODIFIED SECTION ---

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
        sidePanel.classList.toggle('visible');
        body.classList.toggle('panel-open-main-adjust');
        togglePanelBtn.textContent = sidePanel.classList.contains('visible') ? '➡️ Close Sequencer' : '🎹 Beat Sequencer';
        togglePanelBtn.blur();
    });

    function createLimiter(ctx) {
        const limiterNode = ctx.createDynamicsCompressor();
        limiterNode.threshold.setValueAtTime(-1.0, ctx.currentTime);
        limiterNode.knee.setValueAtTime(0, ctx.currentTime);
        limiterNode.ratio.setValueAtTime(20.0, ctx.currentTime);
        limiterNode.attack.setValueAtTime(0.002, ctx.currentTime);
        limiterNode.release.setValueAtTime(0.1, ctx.currentTime);
        limiterNode.connect(ctx.destination);
        return limiterNode;
    }

    function initializeAudio() {
        return new Promise((resolve, reject) => {
            if (audioContext && audioContext.state === 'running') {
                resolve(); return;
            }
            try {
                if (!audioContext) {
                    audioContext = new(window.AudioContext || window.webkitAudioContext)();
                    limiter = createLimiter(audioContext);
                    const bufferSize = 2 * audioContext.sampleRate;
                    noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
                    const output = noiseBuffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) { output[i] = Math.random() * 2 - 1; }
                }
                audioContext.resume().then(() => {
                    updateAudioStatus("Audio Ready", "ready");
                    resolve();
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
    const finalVolume = () => globalGain * globalVolume;
    function playKick() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); osc.connect(gain); gain.connect(limiter); osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.5); gain.gain.setValueAtTime(1 * finalVolume(), now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5); osc.start(now); osc.stop(now + 0.5); }
    function playSnare() { const now = audioContext.currentTime; const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const noiseFilter = audioContext.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1500; noiseFilter.Q.value = 0.5; const noiseGain = audioContext.createGain(); noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(limiter); const osc = audioContext.createOscillator(); osc.type = 'triangle'; const oscGain = audioContext.createGain(); osc.connect(oscGain); oscGain.connect(limiter); noiseGain.gain.setValueAtTime(1 * finalVolume(), now); noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2); osc.frequency.setValueAtTime(100, now); oscGain.gain.setValueAtTime(0.7 * finalVolume(), now); oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1); noise.start(now); osc.start(now); noise.stop(now + 0.2); osc.stop(now + 0.1); }
    function chokeOpenHiHat() { openHiHatGains.forEach(gainNode => { const now = audioContext.currentTime; gainNode.gain.cancelScheduledValues(now); gainNode.gain.setValueAtTime(gainNode.gain.value, now); gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.03); }); openHiHatGains = []; }
    function playHat(isOpen) { chokeOpenHiHat(); const now = audioContext.currentTime; const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const bandpass = audioContext.createBiquadFilter(); bandpass.type = 'bandpass'; bandpass.frequency.value = 10000; bandpass.Q.value = 1.5; const highpass = audioContext.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 7000; const gain = audioContext.createGain(); noise.connect(highpass); highpass.connect(bandpass); bandpass.connect(gain); gain.connect(limiter); const decayTime = isOpen ? 0.5 : 0.05; gain.gain.setValueAtTime(0.9 * finalVolume(), now); gain.gain.exponentialRampToValueAtTime(0.001, now + decayTime); noise.start(now); noise.stop(now + decayTime); if (isOpen) { openHiHatGains.push(gain); setTimeout(() => { const index = openHiHatGains.indexOf(gain); if (index > -1) { openHiHatGains.splice(index, 1); } }, decayTime * 1000 + 50); } }
    function playTom(pitch) { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); osc.connect(gain); gain.connect(limiter); osc.frequency.setValueAtTime(pitch, now); osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.4); gain.gain.setValueAtTime(1.2 * finalVolume(), now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4); osc.start(now); osc.stop(now + 0.4); }
    function playCrash() { const now = audioContext.currentTime; const gain = audioContext.createGain(); gain.gain.setValueAtTime(0.4 * finalVolume(), now); gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2); gain.connect(limiter); const bandpass = audioContext.createBiquadFilter(); bandpass.type = 'bandpass'; bandpass.frequency.value = 4000; bandpass.Q.value = 0.5; bandpass.connect(gain); const highpass = audioContext.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 2000; highpass.connect(bandpass); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(highpass); noise.start(now); noise.stop(now + 1.2); }
    function playClap() { const now = audioContext.currentTime; const gain = audioContext.createGain(); const filter = audioContext.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1000; filter.Q.value = 0.5; gain.connect(filter); filter.connect(limiter); gain.gain.setValueAtTime(1 * finalVolume(), now); gain.gain.setValueAtTime(0, now + 0.01); gain.gain.setValueAtTime(1 * finalVolume(), now + 0.02); gain.gain.setValueAtTime(0, now + 0.03); gain.gain.setValueAtTime(1 * finalVolume(), now + 0.04); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(gain); noise.start(now); noise.stop(now + 0.2); }
    function playRimshot() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); osc.type = 'sine'; osc.frequency.value = 1500; const gain = audioContext.createGain(); gain.gain.setValueAtTime(1.5 * finalVolume(), now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05); osc.connect(gain); gain.connect(limiter); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const noiseGain = audioContext.createGain(); noiseGain.gain.setValueAtTime(0.3 * finalVolume(), now); noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02); noise.connect(noiseGain); noiseGain.connect(limiter); osc.start(now); osc.stop(now + 0.05); noise.start(now); noise.stop(now + 0.02); }
    function playRide() { const now = audioContext.currentTime; const gain = audioContext.createGain(); gain.gain.setValueAtTime(0.3 * finalVolume(), now); gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5); gain.connect(limiter); const filter1 = audioContext.createBiquadFilter(); filter1.type = 'bandpass'; filter1.frequency.value = 5000; filter1.Q.value = 0.5; const filter2 = audioContext.createBiquadFilter(); filter2.type = 'bandpass'; filter2.frequency.value = 8000; filter2.Q.value = 0.4; filter1.connect(gain); filter2.connect(gain); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(filter1); noise.connect(filter2); noise.start(now); noise.stop(now + 2.5); }
    function playTambourine() { const now = audioContext.currentTime; const gain = audioContext.createGain(); gain.gain.setValueAtTime(0.5 * finalVolume(), now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3); gain.connect(limiter); const filter = audioContext.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 8000; filter.connect(gain); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; noise.connect(filter); noise.start(now); noise.stop(now + 0.3); } // MODIFIED: Reverted gain from 0.9 to 0.5
    function play808Kick() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); osc.type = 'sine'; const gain = audioContext.createGain(); osc.connect(gain); gain.connect(limiter); osc.frequency.setValueAtTime(120, now); osc.frequency.exponentialRampToValueAtTime(30, now + 0.5); gain.gain.setValueAtTime(1 * finalVolume(), now); gain.gain.linearRampToValueAtTime(0.001, now + 0.9); osc.start(now); osc.stop(now + 1); const clickOsc = audioContext.createOscillator(); clickOsc.type = 'triangle'; const clickGain = audioContext.createGain(); clickOsc.connect(clickGain); clickGain.connect(limiter); clickOsc.frequency.value = 1000; clickGain.gain.setValueAtTime(0.3 * finalVolume(), now); clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02); clickOsc.start(now); clickOsc.stop(now + 0.02); }
    function play808Snare() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 180; const oscGain = audioContext.createGain(); oscGain.gain.setValueAtTime(0.5 * finalVolume(), now); oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2); osc.connect(oscGain); oscGain.connect(limiter); const noise = audioContext.createBufferSource(); noise.buffer = noiseBuffer; const noiseFilter = audioContext.createBiquadFilter(); noiseFilter.type = 'highpass'; noiseFilter.frequency.value = 1000; const noiseGain = audioContext.createGain(); noiseGain.gain.setValueAtTime(1 * finalVolume(), now); noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15); noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(limiter); osc.start(now); osc.stop(now + 0.2); noise.start(now); noise.stop(now + 0.15); }
    function playMetronomeTick() { const now = audioContext.currentTime; const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); osc.type = 'sine'; osc.frequency.setValueAtTime(1000, now); osc.connect(gain); gain.connect(limiter); gain.gain.setValueAtTime(0.3 * globalVolume, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05); osc.start(now); osc.stop(now + 0.05); }

    const soundBank = {
        'kick': playKick, 'snare': playSnare, 'hatClosed': () => playHat(false),
        'hatOpen': () => playHat(true), 'tom1': () => playTom(250), 'tom2': () => playTom(180),
        'tom3': () => playTom(120), 'crash': playCrash,
        'clap': playClap, 'rimshot': playRimshot, 'ride': playRide, 'tambourine': playTambourine,
        'kick808': play808Kick, 'snare808': play808Snare
    };

    function triggerDrum(key, fromTurbo = false) {
        initializeAudio().then(() => {
            const drumType = keyToDrumMap[key];
            if (!drumType || !soundBank[drumType]) return;
            soundBank[drumType]();
            if (kbdElements[key]) {
                kbdElements[key].classList.add('active');
                setTimeout(() => kbdElements[key].classList.remove('active'), 100);
            }
            if (!fromTurbo) noteDisplay.textContent = drumDisplayNames[drumType];
            if (isRecording) {
                const now = audioContext.currentTime;
                const startTimeOffset = now - recordingStartTime;
                recordedSequence.push({ key, startTime: startTimeOffset, duration: 0.1, volume: 1.0 });
                updateSequenceDisplay();
                updateSequencerControls();
            }
        }).catch(err => console.error("Could not trigger drum:", err));
    }

    // --- Metronome and Turbo Logic ---
    function scheduler() {
        while (nextNoteTime < audioContext.currentTime + 0.1) {
            const noteDivisionValue = isTurboOn ? turboDivision : 4;
            if (isMetronomeOn) {
                const ticksPerQuarterNote = noteDivisionValue / 4;
                if (scheduleBeatCounter % ticksPerQuarterNote === 0) {
                    playMetronomeTick();
                }
            }
            if (isTurboOn && turboKeyDown) {
                triggerDrum(turboKeyDown, true);
            }
            const secondsPerBeat = 60.0 / bpm;
            const noteDuration = (4.0 / noteDivisionValue) * secondsPerBeat;
            nextNoteTime += noteDuration;
            scheduleBeatCounter++;
        }
    }

    function startScheduler() {
        if (schedulerIntervalId) clearInterval(schedulerIntervalId);
        if (audioContext && (isMetronomeOn || isTurboOn)) {
            nextNoteTime = audioContext.currentTime;
            schedulerIntervalId = setInterval(scheduler, 25);
        }
    }

    function stopScheduler() {
        if (schedulerIntervalId) clearInterval(schedulerIntervalId);
        schedulerIntervalId = null;
    }

    metronomeToggle.addEventListener('change', () => {
        isMetronomeOn = metronomeToggle.checked;
        if (isMetronomeOn || isTurboOn) initializeAudio().then(startScheduler);
        else stopScheduler();
    });

    turboToggle.addEventListener('change', () => {
        isTurboOn = turboToggle.checked;
        if (!isTurboOn) turboKeyDown = null;
        if (isMetronomeOn || isTurboOn) initializeAudio().then(startScheduler);
        else stopScheduler();
    });

    bpmSlider.addEventListener('input', () => {
        bpm = parseInt(bpmSlider.value, 10);
        bpmDisplay.textContent = bpm;
    });

    turboDivisionSelect.addEventListener('change', () => {
        turboDivision = parseInt(turboDivisionSelect.value, 10);
    });

    // --- Event Listeners and Sequencer Logic ---
    document.querySelectorAll('kbd[data-key]').forEach(kbd => {
        const key = kbd.dataset.key;
        if (!key) return;
        const startTrigger = (e) => {
            e.preventDefault();
            if (isPlayingBack) return;
            if (isTurboOn) {
                if (turboKeyDown === null) {
                    turboKeyDown = key;
                    nextNoteTime = audioContext.currentTime;
                    scheduleBeatCounter = 0;
                    scheduler();
                }
            } else {
                triggerDrum(key);
            }
        };
        const endTrigger = (e) => {
            e.preventDefault();
            if (isTurboOn && turboKeyDown === key) {
                turboKeyDown = null;
            }
        };
        kbd.addEventListener('mousedown', startTrigger);
        kbd.addEventListener('touchstart', startTrigger, { passive: false });
        kbd.addEventListener('mouseup', endTrigger);
        kbd.addEventListener('mouseleave', endTrigger);
        kbd.addEventListener('touchend', endTrigger);

        // --- MODIFIED SECTION ---
        // Add listener to play sound on hover if the mouse button is held down.
        kbd.addEventListener('mouseenter', () => {
            if (isMouseDown && !isPlayingBack) {
                triggerDrum(key);
            }
        });
        // --- END MODIFIED SECTION ---
    });

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'TEXTAREA' || e.repeat || isPlayingBack) return;
        const key = e.key.toLowerCase();
        if (keyToDrumMap[key]) {
            e.preventDefault();
            if (isTurboOn) {
                if (turboKeyDown === null) {
                    turboKeyDown = key;
                    nextNoteTime = audioContext.currentTime;
                    scheduleBeatCounter = 0;
                    scheduler();
                }
            } else {
                triggerDrum(key);
            }
        }
        if (e.key === "Escape") { e.preventDefault(); if (isPlayingBack) stopSequencePlayback(true); }
    });
    
    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (isTurboOn && turboKeyDown === key) {
            turboKeyDown = null;
        }
    });

    // --- UNCHANGED Sequencer Logic from here ---
    function updateSequencerControls() { const hasSequence = recordedSequence.length > 0; const activityLock = isRecording || isPlayingBack; playBtn.disabled = !hasSequence || activityLock; exportBtn.disabled = !hasSequence || activityLock; copySequenceBtn.disabled = !hasSequence || activityLock; pasteSequenceBtn.disabled = activityLock; clearSequenceBtn.disabled = !hasSequence || activityLock; recordBtn.disabled = isPlayingBack; stopPlaybackBtn.disabled = !isPlayingBack; if (importLabel) { importFileInput.disabled = activityLock; importLabel.classList.toggle('disabled-label', activityLock); } }
    function updateSequenceDisplay(highlightIndex = -1) { let text = recordedSequence.map((note, index) => { const drumName = drumDisplayNames[keyToDrumMap[note.key]] || 'Unknown'; return `${String(index + 1).padStart(3, '0')}: ${drumName.padEnd(10)} @ ${note.startTime.toFixed(2)}s`; }).join('\n'); sequenceDisplay.value = text;}
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
    pasteSequenceBtn.addEventListener('click', async () => { if (isRecording) recordBtn.click(); if (isPlayingBack) stopSequencePlayback(true); try { const text = await navigator.clipboard.readText(); const importedJson = JSON.parse(text); if (Array.isArray(importedJson) && (importedJson.length === 0 || importedJson.every(n => n.key && n.startTime !== undefined))) { processLoadedSequenceData(importedJson); noteDisplay.textContent = "Beat Pasted!"; setTimeout(() => { if (noteDisplay.textContent === "Beat Pasted!") noteDisplay.textContent = ' '; }, 2000); } else { noteDisplay.textContent = "Pasted data is not a valid beat."; setTimeout(() => { if (noteDisplay.textContent.startsWith("Pasted data")) noteDisplay.textContent = ' '; }, 3000); } } catch (err) { console.error('Paste failed:', err); noteDisplay.textContent = "Paste failed or invalid format."; setTimeout(() => { if (noteDisplay.textContent.startsWith("Paste failed")) noteDisplay.textContent = ' '; }, 3000); } updateSequencerControls(); });
    updateSequencerControls();
    const initialUnlockHandler = () => { initializeAudio().then(() => { document.body.removeEventListener('click', initialUnlockHandler); document.body.removeEventListener('keydown', initialUnlockHandler); }); }; document.body.addEventListener('click', initialUnlockHandler); document.body.addEventListener('keydown', initialUnlockHandler);
});
