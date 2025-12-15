console.log('👻 Ghost loading...');

const API_URL = 'http://localhost:5000';
let sessionId = Date.now().toString();
let currentSettings = {};
let isStreaming = false;

// recording
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let audioStream = null;

// context
let lastScreenContext = '';
let lastTranscriptContext = '';
let contextTimestamp = null;

// playbooks
let activePlaybook = 'general';
const PLAYBOOKS = {
    general: {
        name: 'General',
        icon: '💬',
        description: 'General assistance',
        systemPrompt: 'You are a helpful AI assistant. Be concise and direct.',
        contextPrompt: 'Provide helpful context based on what you see and hear.'
    },
    interview: {
        name: 'Interview',
        icon: '👔',
        description: 'Job interview assistance',
        systemPrompt: 'You are an expert interview coach. Help the user ace their interview with confident, professional answers. Provide specific examples and STAR method responses when appropriate.',
        contextPrompt: 'This is a job interview. Listen to the questions and provide excellent, concise answers. Focus on demonstrating competence and experience.'
    },
    sales: {
        name: 'Sales Call',
        icon: '💼',
        description: 'Sales and negotiation',
        systemPrompt: 'You are a sales expert. Help close deals with persuasive responses, handle objections gracefully, and identify buying signals. Be confident but not pushy.',
        contextPrompt: 'This is a sales call. Help identify pain points, provide value propositions, and guide the conversation toward closing.'
    },
    meeting: {
        name: 'Meeting',
        icon: '📋',
        description: 'Meeting notes & insights',
        systemPrompt: 'You are a meeting assistant. Capture key points, action items, and decisions. Summarize discussions and highlight important takeaways.',
        contextPrompt: 'This is a meeting. Track key decisions, action items, and important discussion points. Provide summaries when asked.'
    },
    learning: {
        name: 'Learning',
        icon: '📚',
        description: 'Study & exam help',
        systemPrompt: 'You are a knowledgeable tutor. Explain concepts clearly, answer questions directly, and help with problem-solving. Provide step-by-step explanations.',
        contextPrompt: 'Help with studying and learning. Answer questions visible on screen, explain concepts, and provide solutions to problems.'
    },
    coding: {
        name: 'Coding',
        icon: '💻',
        description: 'Programming assistance',
        systemPrompt: 'You are an expert programmer. Help debug code, explain algorithms, and provide clean, efficient solutions. Use best practices.',
        contextPrompt: 'This is a coding session. Help debug errors, explain code, and suggest improvements. Provide working code solutions.'
    }
};

// passive mode
let autoAnalyzeInterval = null;
let lastAnalyzedContent = '';
let lastSuggestionTime = 0;
const AUTO_ANALYZE_DELAY = 15000;
const MIN_CONTENT_LENGTH = 100;


async function testConnection() {
    try {
        const response = await fetch(`${API_URL}/health`);
        const data = await response.json();
        console.log('✅ Server status:', data);

        if (data.whisper === 'available') {
            console.log('🎤 Speech-to-text available');
        } else {
            console.warn('⚠️ Speech-to-text unavailable');
        }

        setTimeout(() => {
            const welcome = document.querySelector('.welcome-message');
            if (welcome && document.querySelectorAll('.message').length === 0) {
                // keep welcome if no chat yet
            }
        }, 1000);
    } catch (error) {
        console.error('❌ Server connection failed:', error);
        addMessage('assistant', '⚠️ Cannot connect to AI server\n\nPlease run: python server.py');
    }
}


document.addEventListener('DOMContentLoaded', async () => {
    console.log('📄 DOM loaded');

    try {
        currentSettings = await window.electronAPI.getSettings();
        applySettings();
        setupEventListeners();
        testConnection();
        console.log('✅ Ready');
    } catch (error) {
        console.error('❌ Init error:', error);
    }
});


function setupEventListeners() {
    // Command bar - Cluely style (Ctrl+Enter to send)
    const commandInput = document.getElementById('commandInput');
    if (commandInput) {
        commandInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                sendCluelyMessage();
            }
        });
    }

    // Copy button
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyResponse);

    // Listen button
    const listenBtn = document.getElementById('listenBtn');
    if (listenBtn) listenBtn.addEventListener('click', toggleListeningMode);

    // Capture button
    const captureBtn = document.getElementById('captureBtn');
    if (captureBtn) captureBtn.addEventListener('click', captureAndAnalyze);

    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', toggleCluelySettings);

    const closeSettings = document.getElementById('closeSettings');
    if (closeSettings) closeSettings.addEventListener('click', toggleCluelySettings);

    // Playbook select
    const playbookSelect = document.getElementById('playbookSelect');
    if (playbookSelect) {
        playbookSelect.addEventListener('change', (e) => {
            activePlaybook = e.target.value;
            updateStatus(`Playbook: ${PLAYBOOKS[activePlaybook]?.name || 'General'}`);
        });
    }

    // Keyboard shortcuts
    window.electronAPI.onCaptureScreenMode(() => captureAndAnalyze());
    window.electronAPI.onListeningModeToggle(() => toggleListeningMode());

    // Auto-fade after idle
    setupAutoFade();
}

// Cluely-style send (single response mode)
async function sendCluelyMessage() {
    const input = document.getElementById('commandInput');
    const message = input.value.trim();
    if (!message || isStreaming) return;

    input.value = '';
    showLoading();
    isStreaming = true;

    try {
        const playbook = PLAYBOOKS[activePlaybook];
        const response = await fetch(`${API_URL}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                session_id: sessionId,
                personality: playbook.systemPrompt
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                            fullResponse += data.content;
                            showResponse(fullResponse);
                        }
                    } catch (e) { }
                }
            }
        }
    } catch (error) {
        showResponse(`❌ Error: ${error.message}`);
    } finally {
        isStreaming = false;
    }
}

// Show AI response (replaces previous, no chat history)
function showResponse(text) {
    const responseContent = document.getElementById('responseContent');
    if (!responseContent) return;

    responseContent.innerHTML = `<div class="ai-response">${escapeHtml(text)}</div>`;
    resetFadeTimer();
}

// Show loading state
function showLoading() {
    const responseContent = document.getElementById('responseContent');
    if (!responseContent) return;

    responseContent.innerHTML = `
        <div class="ai-response loading">
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
        </div>
    `;
}

// Copy current response
function copyResponse() {
    const response = document.querySelector('.ai-response');
    if (response && !response.classList.contains('loading')) {
        navigator.clipboard.writeText(response.textContent);
        updateStatus('Copied!');
        setTimeout(() => updateStatus('Ready'), 2000);
    }
}

// Toggle settings overlay
function toggleCluelySettings() {
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.toggle('hidden');
}

// Update status text
function updateStatus(text) {
    const statusText = document.getElementById('statusText');
    if (statusText) statusText.textContent = text;
}

// Auto-fade timer
let fadeTimer = null;
function setupAutoFade() {
    resetFadeTimer();
    document.addEventListener('mousemove', resetFadeTimer);
    document.addEventListener('keydown', resetFadeTimer);
}

function resetFadeTimer() {
    const container = document.getElementById('appContainer');
    if (container) container.classList.remove('faded');

    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
        if (container && !isStreaming) container.classList.add('faded');
    }, 15000); // fade after 15s idle
}

// Escape HTML
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// --- Voice Recording ---

async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        console.log('🎤 Requesting microphone access...');

        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('✅ Microphone access granted');

        const options = { mimeType: 'audio/webm' };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn('audio/webm not supported, using default');
            mediaRecorder = new MediaRecorder(audioStream);
        } else {
            mediaRecorder = new MediaRecorder(audioStream, options);
        }

        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
                console.log('📦 Audio chunk collected:', event.data.size, 'bytes');
            }
        };

        mediaRecorder.onstop = async () => {
            console.log('⏹️ Recording stopped, processing...');
            await processRecording();
        };

        mediaRecorder.onerror = (event) => {
            console.error('❌ MediaRecorder error:', event.error);
            addMessage('assistant', '❌ Recording error: ' + event.error.message);
            stopRecording();
        };

        mediaRecorder.start();
        isRecording = true;
        updateRecordingUI(true);
        console.log('🔴 Recording started');

    } catch (error) {
        console.error('❌ Microphone access error:', error);

        let errorMessage = '❌ Cannot access microphone\n\n';

        if (error.name === 'NotAllowedError') {
            errorMessage += 'Permission denied. Please allow microphone access.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No microphone found.';
        } else {
            errorMessage += 'Error: ' + error.message;
        }

        addMessage('assistant', errorMessage);
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        console.log('⏹️ Stopping recording...');
        mediaRecorder.stop();
        isRecording = false;

        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
        }

        updateRecordingUI(false);
    }
}

function updateRecordingUI(recording) {
    const micBtn = document.getElementById('micBtn');
    const micIcon = micBtn.querySelector('.mic-icon');

    if (recording) {
        micBtn.classList.add('recording');
        micIcon.textContent = '⏹️';
        micBtn.title = 'Stop recording';
    } else {
        micBtn.classList.remove('recording');
        micIcon.textContent = '🎤';
        micBtn.title = 'Start voice input';
    }
}

async function processRecording() {
    try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        console.log('📦 Audio blob created:', audioBlob.size, 'bytes');

        if (audioBlob.size === 0) {
            console.error('❌ Empty audio recording');
            addMessage('assistant', '⚠️ Recording is empty. Please try again.');
            return;
        }

        const loadingMsg = addLoadingMessage();
        loadingMsg.querySelector('.message-content').textContent = '🎤 Transcribing audio...';

        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        console.log('📤 Sending audio to server for transcription...');

        const response = await fetch(`${API_URL}/transcribe`, {
            method: 'POST',
            body: formData
        });

        loadingMsg.remove();

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ Transcription received:', data);

        const transcribedText = data.text;

        if (!transcribedText || transcribedText.trim() === '') {
            addMessage('assistant', '⚠️ No speech detected. Please try again.');
            return;
        }

        const messageInput = document.getElementById('messageInput');
        messageInput.value = transcribedText;
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        messageInput.focus();

        console.log('✅ Transcription complete:', transcribedText);
        showTranscriptionSuccess();

    } catch (error) {
        console.error('❌ Transcription error:', error);
        addMessage('assistant', `❌ Transcription failed: ${error.message}\n\nMake sure the Flask server is running.`);
    }
}

function showTranscriptionSuccess() {
    const micBtn = document.getElementById('micBtn');
    micBtn.classList.add('success');
    setTimeout(() => {
        micBtn.classList.remove('success');
    }, 1000);
}


// --- Screen Capture & OCR ---

let isCapturing = false;

async function captureAndAnalyze() {
    if (isCapturing) return;
    isCapturing = true;

    const captureBtn = document.getElementById('captureBtn');
    if (captureBtn) {
        captureBtn.classList.add('capturing');
    }

    try {
        console.log('📷 Capturing screen...');

        // capture screen via Electron
        const result = await window.electronAPI.captureScreen();

        if (result.error) {
            throw new Error(result.error);
        }

        console.log('✅ Screenshot captured:', result.name);

        // remove welcome message
        const welcome = document.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        addMessage('user', '📷 Analyzing screen...');
        const loadingMsg = addLoadingMessage();
        loadingMsg.querySelector('.message-content').textContent = '🔍 Reading screen content...';

        // send to OCR endpoint
        const response = await fetch(`${API_URL}/ocr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: result.image,
                analyze: true,
                prompt: 'Analyze what you see on screen and provide helpful context. If there are questions visible, answer them directly. If there is code, explain or help debug it.'
            })
        });

        loadingMsg.remove();

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ OCR complete:', data);

        if (data.text) {
            // store screen context for combined analysis
            lastScreenContext = data.text;
            contextTimestamp = new Date();

            const textPreview = data.text.length > 200
                ? data.text.substring(0, 200) + '...'
                : data.text;
            console.log('Extracted text:', textPreview);
        }

        if (data.analysis) {
            addMessage('assistant', data.analysis);
        } else if (data.text) {
            addMessage('assistant', `📄 **Screen text detected:**\n\n${data.text}`);
        } else {
            addMessage('assistant', '⚠️ No text detected on screen. Try capturing when text is visible.');
        }

        // show success
        if (captureBtn) {
            captureBtn.classList.add('success');
            setTimeout(() => captureBtn.classList.remove('success'), 1000);
        }

    } catch (error) {
        console.error('❌ Screen capture error:', error);
        addMessage('assistant', `❌ Screen capture failed: ${error.message}\n\nMake sure the server is running and Tesseract is installed.`);
    } finally {
        isCapturing = false;
        if (captureBtn) {
            captureBtn.classList.remove('capturing');
        }
    }
}


// --- System Audio Capture (Listening Mode) ---

let isListening = false;
let systemAudioStream = null;
let systemMediaRecorder = null;
let listeningChunks = [];
let transcriptionInterval = null;
let liveTranscript = ''; // accumulates full transcript

async function toggleListeningMode() {
    if (isListening) {
        stopListening();
    } else {
        await startListening();
    }
}

async function startListening() {
    try {
        console.log('🎧 Starting system audio capture...');

        // request display media with audio (triggers screen picker)
        systemAudioStream = await navigator.mediaDevices.getDisplayMedia({
            video: true, // required by browser API
            audio: true  // captures system audio via loopback
        });

        // check if audio track exists
        const audioTracks = systemAudioStream.getAudioTracks();
        if (audioTracks.length === 0) {
            throw new Error('No audio track found. Make sure to select a screen with audio enabled.');
        }

        console.log('✅ System audio stream obtained:', audioTracks[0].label);

        // stop video track - we only need audio
        systemAudioStream.getVideoTracks().forEach(track => track.stop());

        // create audio-only stream
        const audioOnlyStream = new MediaStream(audioTracks);

        // setup media recorder
        const options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            systemMediaRecorder = new MediaRecorder(audioOnlyStream);
        } else {
            systemMediaRecorder = new MediaRecorder(audioOnlyStream, options);
        }

        listeningChunks = [];

        systemMediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                listeningChunks.push(event.data);
            }
        };

        systemMediaRecorder.onstop = () => {
            console.log('⏹️ System audio recording stopped');
        };

        systemMediaRecorder.onerror = (event) => {
            console.error('❌ System audio error:', event.error);
            stopListening();
        };

        // start recording in 3-second chunks for faster transcription
        systemMediaRecorder.start(3000);
        isListening = true;
        updateListeningUI(true);

        // setup interval to process chunks
        transcriptionInterval = setInterval(processListeningChunks, 3000);

        // start passive AI mode (auto-suggestions)
        startAutoAnalyze();

        // remove welcome and show listening status
        const welcome = document.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        addMessage('assistant', '🎧 **Listening mode started**\n\n🤖 Passive AI is watching — suggestions will appear automatically.');

        console.log('🎧 Listening mode active with passive AI');

    } catch (error) {
        console.error('❌ Failed to start listening:', error);

        let errorMsg = '❌ Failed to start listening mode\n\n';
        if (error.name === 'NotAllowedError') {
            errorMsg += 'Screen share was cancelled or denied.';
        } else {
            errorMsg += error.message;
        }

        addMessage('assistant', errorMsg);
        stopListening();
    }
}

function stopListening() {
    console.log('⏹️ Stopping listening mode...');

    if (transcriptionInterval) {
        clearInterval(transcriptionInterval);
        transcriptionInterval = null;
    }

    if (systemMediaRecorder && systemMediaRecorder.state !== 'inactive') {
        systemMediaRecorder.stop();
    }

    if (systemAudioStream) {
        systemAudioStream.getTracks().forEach(track => track.stop());
        systemAudioStream = null;
    }

    systemMediaRecorder = null;
    isListening = false;
    listeningChunks = [];

    updateListeningUI(false);
    removeLiveTranscriptPanel();
    stopAutoAnalyze();

    addMessage('assistant', '⏹️ **Listening stopped**\n\nFull transcript saved.');

    console.log('✅ Listening mode stopped');
}

async function processListeningChunks() {
    if (listeningChunks.length === 0) return;

    // grab current chunks and clear for next batch
    const chunksToProcess = [...listeningChunks];
    listeningChunks = [];

    try {
        const audioBlob = new Blob(chunksToProcess, { type: 'audio/webm' });

        if (audioBlob.size < 1000) {
            console.log('⏭️ Chunk too small, skipping...');
            return;
        }

        console.log('📤 Sending audio chunk for transcription:', audioBlob.size, 'bytes');

        const formData = new FormData();
        formData.append('audio', audioBlob, 'system_audio.webm');

        const response = await fetch(`${API_URL}/transcribe`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Transcription error:', errorData.error);
            return;
        }

        const data = await response.json();
        const transcribedText = data.text?.trim();

        if (transcribedText && transcribedText.length > 2) {
            console.log('📝 Transcription:', transcribedText);

            // accumulate in live transcript
            liveTranscript += (liveTranscript ? ' ' : '') + transcribedText;

            // store for combined context analysis
            lastTranscriptContext += (lastTranscriptContext ? ' ' : '') + transcribedText;
            contextTimestamp = new Date();

            // update live transcript panel if visible
            updateLiveTranscriptPanel(transcribedText);
        }

    } catch (error) {
        console.error('❌ Chunk transcription error:', error);
    }
}

function updateLiveTranscriptPanel(newText) {
    let panel = document.getElementById('liveTranscriptPanel');

    if (!panel) {
        // create panel if it doesn't exist
        panel = document.createElement('div');
        panel.id = 'liveTranscriptPanel';
        panel.className = 'live-transcript-panel';
        panel.innerHTML = `
            <div class="transcript-header">
                <span class="transcript-indicator"></span>
                <span>Live Transcription</span>
            </div>
            <div class="transcript-content" id="transcriptContent"></div>
        `;

        // insert before chat wrapper
        const chatWrapper = document.querySelector('.chat-wrapper');
        if (chatWrapper) {
            chatWrapper.parentNode.insertBefore(panel, chatWrapper);
        }
    }

    const content = document.getElementById('transcriptContent');
    if (content) {
        // add new text with fade-in
        const span = document.createElement('span');
        span.className = 'transcript-new';
        span.textContent = newText + ' ';
        content.appendChild(span);

        // limit to last 500 characters
        while (content.textContent.length > 500) {
            if (content.firstChild) {
                content.removeChild(content.firstChild);
            }
        }

        // scroll to end
        content.scrollLeft = content.scrollWidth;
    }
}

function removeLiveTranscriptPanel() {
    const panel = document.getElementById('liveTranscriptPanel');
    if (panel) {
        panel.remove();
    }
    liveTranscript = '';
}

function updateListeningUI(listening) {
    const listenBtn = document.getElementById('listenBtn');
    if (!listenBtn) return;

    const listenIcon = listenBtn.querySelector('.listen-icon');

    if (listening) {
        listenBtn.classList.add('listening');
        if (listenIcon) listenIcon.textContent = '■';
        listenBtn.title = 'Stop listening';
    } else {
        listenBtn.classList.remove('listening');
        if (listenIcon) listenIcon.textContent = '🎧';
        listenBtn.title = 'Start listening (Ctrl+Shift+L)';
    }
}


// --- Context-Aware Analysis ---

async function analyzeContext(userQuestion = '') {
    if (!lastScreenContext && !lastTranscriptContext) {
        addMessage('assistant', '⚠️ **No context available**\n\nCapture a screen (Ctrl+Shift+S) or start listening (Ctrl+Shift+L) first to build context.');
        return;
    }

    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    // show what context we have
    const contextInfo = [];
    if (lastScreenContext) contextInfo.push(`📷 Screen: ${lastScreenContext.length} chars`);
    if (lastTranscriptContext) contextInfo.push(`🎧 Audio: ${lastTranscriptContext.length} chars`);

    addMessage('user', userQuestion || `🧠 Analyze context (${contextInfo.join(', ')})`);
    const loadingMsg = addLoadingMessage();
    loadingMsg.querySelector('.message-content').textContent = '🧠 Analyzing context...';

    try {
        const playbook = PLAYBOOKS[activePlaybook];
        const response = await fetch(`${API_URL}/analyze-context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                screen_context: lastScreenContext,
                transcript_context: lastTranscriptContext,
                question: userQuestion,
                playbook_name: playbook.name,
                playbook_system: playbook.systemPrompt,
                playbook_context: playbook.contextPrompt
            })
        });

        loadingMsg.remove();

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.analysis) {
            addMessage('assistant', data.analysis);
        } else {
            addMessage('assistant', '⚠️ No analysis generated.');
        }

    } catch (error) {
        console.error('❌ Context analysis error:', error);
        loadingMsg.remove();
        addMessage('assistant', `❌ Analysis failed: ${error.message}`);
    }
}

function hasContext() {
    return !!(lastScreenContext || lastTranscriptContext);
}

function clearContext() {
    lastScreenContext = '';
    lastTranscriptContext = '';
    contextTimestamp = null;
    console.log('🗑️ Context cleared');
}


// --- Playbook Selector ---

function togglePlaybookSelector() {
    let panel = document.getElementById('playbookPanel');

    if (panel) {
        panel.remove();
        return;
    }

    // create playbook selector panel
    panel = document.createElement('div');
    panel.id = 'playbookPanel';
    panel.className = 'playbook-panel';

    let buttonsHtml = '';
    for (const [key, pb] of Object.entries(PLAYBOOKS)) {
        const isActive = key === activePlaybook ? 'active' : '';
        buttonsHtml += `
            <button class="playbook-item ${isActive}" data-playbook="${key}">
                <span class="playbook-icon">${pb.icon}</span>
                <div class="playbook-info">
                    <span class="playbook-name">${pb.name}</span>
                    <span class="playbook-desc">${pb.description}</span>
                </div>
            </button>
        `;
    }

    panel.innerHTML = `
        <div class="playbook-header">
            <span>Select Playbook</span>
            <button class="playbook-close" onclick="document.getElementById('playbookPanel').remove()">×</button>
        </div>
        <div class="playbook-list">
            ${buttonsHtml}
        </div>
    `;

    // insert after header
    const header = document.querySelector('.header');
    if (header) {
        header.parentNode.insertBefore(panel, header.nextSibling);
    }

    // add click handlers
    panel.querySelectorAll('.playbook-item').forEach(btn => {
        btn.addEventListener('click', () => {
            setPlaybook(btn.dataset.playbook);
            panel.remove();
        });
    });
}

function setPlaybook(playbookKey) {
    if (!PLAYBOOKS[playbookKey]) return;

    activePlaybook = playbookKey;
    const pb = PLAYBOOKS[playbookKey];

    // update button icon
    const playbookBtn = document.getElementById('playbookBtn');
    if (playbookBtn) {
        const icon = playbookBtn.querySelector('.playbook-btn-icon');
        if (icon) icon.textContent = pb.icon;
        playbookBtn.title = `Playbook: ${pb.name}`;
    }

    // show notification
    addMessage('assistant', `📋 **Playbook changed to: ${pb.name}**\n\n${pb.description}`);

    console.log(`📋 Active playbook: ${pb.name}`);
}

function getActivePlaybook() {
    return PLAYBOOKS[activePlaybook];
}


// --- Passive AI Mode (Auto-Suggest) ---

function startAutoAnalyze() {
    if (autoAnalyzeInterval) return;

    console.log('🤖 Starting passive AI mode...');

    autoAnalyzeInterval = setInterval(() => {
        runAutoAnalysis();
    }, AUTO_ANALYZE_DELAY);
}

function stopAutoAnalyze() {
    if (autoAnalyzeInterval) {
        clearInterval(autoAnalyzeInterval);
        autoAnalyzeInterval = null;
        console.log('🛑 Stopped passive AI mode');
    }
    hideSuggestionCard();
}

async function runAutoAnalysis() {
    // check if we have enough new content
    const currentContent = lastTranscriptContext + lastScreenContext;

    if (currentContent.length < MIN_CONTENT_LENGTH) {
        return; // not enough content
    }

    if (currentContent === lastAnalyzedContent) {
        return; // no new content
    }

    // debounce - don't suggest too frequently
    const now = Date.now();
    if (now - lastSuggestionTime < AUTO_ANALYZE_DELAY) {
        return;
    }

    console.log('🤖 Running auto-analysis...');
    lastAnalyzedContent = currentContent;
    lastSuggestionTime = now;

    try {
        const playbook = PLAYBOOKS[activePlaybook];
        const response = await fetch(`${API_URL}/auto-suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: lastTranscriptContext,
                screen: lastScreenContext,
                playbook_name: playbook.name,
                playbook_system: playbook.systemPrompt,
                playbook_context: playbook.contextPrompt
            })
        });

        if (!response.ok) {
            console.error('Auto-suggest failed:', response.status);
            return;
        }

        const data = await response.json();

        if (data.suggestion && data.suggestion.length > 10) {
            showSuggestionCard(data);
        }

    } catch (error) {
        console.error('❌ Auto-analysis error:', error);
    }
}

function showSuggestionCard(data) {
    hideSuggestionCard(); // remove existing

    const card = document.createElement('div');
    card.id = 'suggestionCard';
    card.className = 'suggestion-card';

    const typeIcon = data.detected_type === 'question' ? '❓'
        : data.detected_type === 'code' ? '💻'
            : data.detected_type === 'action' ? '✅'
                : '💡';

    card.innerHTML = `
        <div class="suggestion-header">
            <span class="suggestion-type">${typeIcon} ${data.detected_type || 'Suggestion'}</span>
            <button class="suggestion-close" onclick="hideSuggestionCard()">×</button>
        </div>
        <div class="suggestion-content">${data.suggestion}</div>
        <div class="suggestion-actions">
            <button class="suggestion-btn copy-btn" onclick="copySuggestion()">📋 Copy</button>
            <button class="suggestion-btn dismiss-btn" onclick="hideSuggestionCard()">Dismiss</button>
        </div>
    `;

    // insert after header
    const appContainer = document.querySelector('.app-container');
    const header = document.querySelector('.header');
    if (appContainer && header) {
        appContainer.insertBefore(card, header.nextSibling);
    }

    // auto-dismiss after 30 seconds
    setTimeout(() => {
        const existing = document.getElementById('suggestionCard');
        if (existing) existing.classList.add('fading');
        setTimeout(hideSuggestionCard, 500);
    }, 30000);

    console.log('💡 Showing suggestion:', data.detected_type);
}

function hideSuggestionCard() {
    const card = document.getElementById('suggestionCard');
    if (card) card.remove();
}

function copySuggestion() {
    const content = document.querySelector('.suggestion-content');
    if (content) {
        navigator.clipboard.writeText(content.textContent);
        const copyBtn = document.querySelector('.copy-btn');
        if (copyBtn) {
            copyBtn.textContent = '✓ Copied';
            setTimeout(() => copyBtn.textContent = '📋 Copy', 2000);
        }
    }
}


// --- Chat ---

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message || isStreaming) return;

    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    addMessage('user', message);
    input.value = '';
    input.style.height = 'auto';

    const loadingMsg = addLoadingMessage();
    isStreaming = true;

    try {
        const response = await fetch(`${API_URL}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                session_id: sessionId,
                personality: currentSettings.personality || 'concise'
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        loadingMsg.remove();

        const assistantMsg = addMessage('assistant', '');
        const contentDiv = assistantMsg.querySelector('.message-content');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.error) {
                            contentDiv.textContent = `❌ ${data.error}`;
                        } else if (data.content) {
                            contentDiv.textContent += data.content;
                            scrollToBottom();
                        }
                    } catch (e) {
                        console.error('Parse error:', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error:', error);
        loadingMsg.remove();
        addMessage('assistant', `❌ Connection error: ${error.message}\n\nMake sure Flask server is running:\npython server.py`);
    } finally {
        isStreaming = false;
    }
}

async function handleQuickAction(action) {
    try {
        const text = await window.electronAPI.getClipboard();

        if (!text) {
            addMessage('assistant', '⚠️ Clipboard is empty');
            return;
        }

        const welcome = document.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        addMessage('user', `Quick: ${action}`);
        const loadingMsg = addLoadingMessage();

        const response = await fetch(`${API_URL}/chat/quick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, text })
        });

        const data = await response.json();
        loadingMsg.remove();

        if (data.error) {
            addMessage('assistant', `❌ ${data.error}`);
        } else {
            addMessage('assistant', data.response);
        }
    } catch (error) {
        addMessage('assistant', `❌ ${error.message}`);
    }
}


// --- UI Helpers ---

function addMessage(sender, text) {
    const container = document.getElementById('chatContainer');

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = sender === 'user' ? '👤' : '👻';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    container.appendChild(messageDiv);

    scrollToBottom();
    return messageDiv;
}

function addLoadingMessage() {
    const container = document.getElementById('chatContainer');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant-message loading';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '👻';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = '<div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div>';

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    container.appendChild(messageDiv);

    scrollToBottom();
    return messageDiv;
}

function scrollToBottom() {
    const container = document.getElementById('chatContainer');
    container.scrollTop = container.scrollHeight;
}

async function clearChat() {
    const container = document.getElementById('chatContainer');
    container.innerHTML = '<div class="welcome-message"><div class="welcome-icon">👻</div><h2>Voifodas</h2><p>Your invisible AI assistant</p><div class="shortcuts"><div class="shortcut-item"><kbd>Ctrl</kbd> + <kbd>Space</kbd> Toggle window</div><div class="shortcut-item"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Q</kbd> Quick actions</div></div></div>';

    try {
        await fetch(`${API_URL}/history/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
        });
    } catch (error) {
        console.error('Clear error:', error);
    }
}


// --- Settings ---

function toggleSettings() {
    const panel = document.getElementById('settingsPanel');
    panel.classList.toggle('hidden');

    if (!panel.classList.contains('hidden')) {
        document.getElementById('personalitySelect').value = currentSettings.personality || 'concise';
        document.getElementById('opacitySlider').value = (currentSettings.opacity || 0.95) * 100;
        document.getElementById('opacityValue').textContent = Math.round((currentSettings.opacity || 0.95) * 100) + '%';
        document.getElementById('hideOnBlurCheck').checked = currentSettings.hideOnBlur !== false;
    }
}

async function saveSettings() {
    const settings = {
        personality: document.getElementById('personalitySelect').value,
        opacity: parseInt(document.getElementById('opacitySlider').value) / 100,
        hideOnBlur: document.getElementById('hideOnBlurCheck').checked
    };

    currentSettings = settings;
    await window.electronAPI.saveSettings(settings);
    applySettings();
}

function applySettings() {
    const container = document.querySelector('.app-container');
    if (container && currentSettings.opacity) {
        container.style.opacity = currentSettings.opacity;
    }
}

// auto-save settings on change
document.addEventListener('change', (e) => {
    if (e.target.closest('.settings-content')) {
        saveSettings();
    }
});
