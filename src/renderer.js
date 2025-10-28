// ============================================
// DEBUG AND CONFIGURATION
// ============================================
console.log('🚀 Voifodas renderer.js loading...');

const API_URL = 'http://localhost:5000';
let sessionId = Date.now().toString();
let currentSettings = {};
let isStreaming = false;

// ============================================
// SPEECH-TO-TEXT STATE MANAGEMENT (NEW)
// ============================================
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let audioStream = null;

// ============================================
// CONNECTION TEST
// ============================================
async function testConnection() {
    try {
        const response = await fetch(`${API_URL}/health`);
        const data = await response.json();
        console.log('✅ Server status:', data);
        
        // Check if Whisper is available
        if (data.whisper === 'available') {
            console.log('🎤 Speech-to-text available');
        } else {
            console.warn('⚠️ Speech-to-text unavailable');
        }
        
        setTimeout(() => {
            const welcome = document.querySelector('.welcome-message');
            if (welcome && document.querySelectorAll('.message').length === 0) {
                // Keep welcome if no chat yet
            }
        }, 1000);
    } catch (error) {
        console.error('❌ Server connection failed:', error);
        addMessage('assistant', '⚠️ Cannot connect to AI server\n\nPlease run: python server.py');
    }
}

// ============================================
// INITIALIZATION
// ============================================
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

// ============================================
// EVENT LISTENERS SETUP
// ============================================
function setupEventListeners() {
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const micBtn = document.getElementById('micBtn'); // NEW
    
    // Send message
    sendBtn.addEventListener('click', () => sendMessage());
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // NEW: Microphone button click handler
    micBtn.addEventListener('click', toggleRecording);
    
    // Auto-resize textarea
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    
    // Controls
    document.getElementById('closeBtn').addEventListener('click', () => {
        window.electronAPI.hideWindow();
    });
    
    document.getElementById('clearBtn').addEventListener('click', clearChat);
    document.getElementById('settingsBtn').addEventListener('click', toggleSettings);
    document.getElementById('closeSettingsBtn').addEventListener('click', toggleSettings);
    
    // Quick actions
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handleQuickAction(btn.dataset.action);
        });
    });
    
    // Quick action shortcut
    window.electronAPI.onQuickActionMode(() => {
        document.getElementById('quickActions').classList.toggle('hidden');
    });
    
    // Settings
    document.getElementById('opacitySlider').addEventListener('input', (e) => {
        document.getElementById('opacityValue').textContent = e.target.value + '%';
    });
}

// ============================================
// SPEECH-TO-TEXT FUNCTIONS (NEW)
// ============================================

/**
 * Toggle audio recording on/off
 */
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

/**
 * Start recording audio from microphone
 */
async function startRecording() {
    try {
        console.log('🎤 Requesting microphone access...');
        
        // Request microphone permission and get audio stream
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true 
        });
        
        console.log('✅ Microphone access granted');
        
        // Create MediaRecorder with WebM format
        const options = { mimeType: 'audio/webm' };
        
        // Fallback for browsers that don't support audio/webm
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn('audio/webm not supported, using default');
            mediaRecorder = new MediaRecorder(audioStream);
        } else {
            mediaRecorder = new MediaRecorder(audioStream, options);
        }
        
        // Reset audio chunks
        audioChunks = [];
        
        // Collect audio data as it's recorded
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
                console.log('📦 Audio chunk collected:', event.data.size, 'bytes');
            }
        };
        
        // Handle recording stop event
        mediaRecorder.onstop = async () => {
            console.log('⏹️ Recording stopped, processing...');
            await processRecording();
        };
        
        // Handle errors
        mediaRecorder.onerror = (event) => {
            console.error('❌ MediaRecorder error:', event.error);
            addMessage('assistant', '❌ Recording error: ' + event.error.message);
            stopRecording();
        };
        
        // Start recording
        mediaRecorder.start();
        isRecording = true;
        
        // Update UI to show recording state
        updateRecordingUI(true);
        
        console.log('🔴 Recording started');
        
    } catch (error) {
        console.error('❌ Microphone access error:', error);
        
        // Show user-friendly error message
        let errorMessage = '❌ Cannot access microphone\n\n';
        
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Permission denied. Please allow microphone access in your browser settings.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No microphone found. Please connect a microphone and try again.';
        } else {
            errorMessage += 'Error: ' + error.message;
        }
        
        addMessage('assistant', errorMessage);
    }
}

/**
 * Stop recording audio
 */
function stopRecording() {
    if (mediaRecorder && isRecording) {
        console.log('⏹️ Stopping recording...');
        mediaRecorder.stop();
        isRecording = false;
        
        // Stop all audio tracks
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
        }
        
        // Update UI to show non-recording state
        updateRecordingUI(false);
    }
}

/**
 * Update UI to show recording state
 */
function updateRecordingUI(recording) {
    const micBtn = document.getElementById('micBtn');
    const micIcon = micBtn.querySelector('.mic-icon');
    
    if (recording) {
        micBtn.classList.add('recording');
        micIcon.textContent = '⏹️'; // Stop icon
        micBtn.title = 'Stop recording';
    } else {
        micBtn.classList.remove('recording');
        micIcon.textContent = '🎤'; // Microphone icon
        micBtn.title = 'Start voice input';
    }
}

/**
 * Process recorded audio and send to backend for transcription
 */
async function processRecording() {
    try {
        // Create blob from recorded chunks
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        console.log('📦 Audio blob created:', audioBlob.size, 'bytes');
        
        if (audioBlob.size === 0) {
            console.error('❌ Empty audio recording');
            addMessage('assistant', '⚠️ Recording is empty. Please try again.');
            return;
        }
        
        // Show loading message
        const loadingMsg = addLoadingMessage();
        loadingMsg.querySelector('.message-content').textContent = '🎤 Transcribing audio...';
        
        // Create FormData to send audio file
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        
        console.log('📤 Sending audio to server for transcription...');
        
        // Send to backend
        const response = await fetch(`${API_URL}/transcribe`, {
            method: 'POST',
            body: formData
        });
        
        // Remove loading message
        loadingMsg.remove();
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Transcription received:', data);
        
        // Get transcribed text
        const transcribedText = data.text;
        
        if (!transcribedText || transcribedText.trim() === '') {
            addMessage('assistant', '⚠️ No speech detected. Please try again.');
            return;
        }
        
        // Populate the input field with transcribed text
        const messageInput = document.getElementById('messageInput');
        messageInput.value = transcribedText;
        
        // Auto-resize textarea
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        
        // Focus on input field
        messageInput.focus();
        
        console.log('✅ Transcription complete:', transcribedText);
        
        // Optional: Show a temporary success message
        showTranscriptionSuccess();
        
    } catch (error) {
        console.error('❌ Transcription error:', error);
        addMessage('assistant', `❌ Transcription failed: ${error.message}\n\nPlease make sure the Flask server is running with Whisper support.`);
    }
}

/**
 * Show temporary success indicator after transcription
 */
function showTranscriptionSuccess() {
    const micBtn = document.getElementById('micBtn');
    micBtn.classList.add('success');
    
    setTimeout(() => {
        micBtn.classList.remove('success');
    }, 1000);
}

// ============================================
// CHAT FUNCTIONS
// ============================================

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message || isStreaming) return;
    
    // Remove welcome
    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.remove();
    
    // Add user message
    addMessage('user', message);
    input.value = '';
    input.style.height = 'auto';
    
    // Add loading
    const loadingMsg = addLoadingMessage();
    isStreaming = true;
    
    try {
        const response = await fetch(`${API_URL}/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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
            headers: {
                'Content-Type': 'application/json'
            },
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

// ============================================
// UI HELPER FUNCTIONS
// ============================================

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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ session_id: sessionId })
        });
    } catch (error) {
        console.error('Clear error:', error);
    }
}

// ============================================
// SETTINGS MANAGEMENT
// ============================================

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

// Auto-save when settings change
document.addEventListener('change', (e) => {
    if (e.target.closest('.settings-content')) {
        saveSettings();
    }
});
