// Debug logging
console.log('🚀 GhostAI renderer.js loading...');

const API_URL = 'http://localhost:5000';
let sessionId = Date.now().toString();
let currentSettings = {};
let isStreaming = false;

// Test connection
async function testConnection() {
    try {
        const response = await fetch(`${API_URL}/health`);
        const data = await response.json();
        console.log('✅ Server status:', data);
        
        // Remove welcome message after connection
        setTimeout(() => {
            const welcome = document.querySelector('.welcome-message');
            if (welcome && document.querySelectorAll('.message').length === 0) {
                // Keep welcome message if no chat yet
            }
        }, 1000);
    } catch (error) {
        console.error('❌ Server connection failed:', error);
        addMessage('assistant', '⚠️ Cannot connect to AI server\n\nPlease run: python server.py');
    }
}

// Initialize
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
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    
    // Send message
    sendBtn.addEventListener('click', () => sendMessage());
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

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

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message || isStreaming) return;
    
    // Remove welcome message
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
    container.innerHTML = '<div class="welcome-message"><div class="welcome-icon">👻</div><h2>Chat Cleared</h2><p>Start a new conversation</p></div>';
    
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

// Auto-save settings when changed
document.addEventListener('change', (e) => {
    if (e.target.closest('.settings-content')) {
        saveSettings();
    }
});
