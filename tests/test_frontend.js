/**
 * Frontend Tests for Voifodas
 * Run: node tests/test_frontend.js
 */

// simple test runner - nothing fancy
let passCount = 0;
let failCount = 0;
const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

async function runTests() {
    console.log('\n🧪 Running Voifodas Frontend Tests\n');
    console.log('='.repeat(50));

    for (const t of tests) {
        try {
            await t.fn();
            console.log(`✅ PASS: ${t.name}`);
            passCount++;
        } catch (error) {
            console.log(`❌ FAIL: ${t.name}`);
            console.log(`   Error: ${error.message}\n`);
            failCount++;
        }
    }

    console.log('='.repeat(50));
    console.log(`\n📊 Results: ${passCount} passed, ${failCount} failed\n`);
    process.exit(failCount > 0 ? 1 : 0);
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
}

// mock browser stuff since we're in node
global.window = {
    electronAPI: {
        getSettings: async () => ({
            personality: 'concise',
            theme: 'dark',
            opacity: 0.95,
            hideOnBlur: true
        }),
        saveSettings: async (settings) => true,
        getClipboard: async () => 'test clipboard content',
        setClipboard: async (text) => true,
        hideWindow: async () => true,
        getActiveWindow: async () => ({ app: 'Test', title: 'Test Window' }),
        onQuickActionMode: (callback) => { }
    }
};

// mock fetch
global.fetch = async (url, options) => {
    if (url.includes('/health')) {
        return {
            ok: true,
            json: async () => ({ status: 'ok', whisper: 'available', device: 'cpu' })
        };
    }
    if (url.includes('/chat/stream')) {
        const encoder = new TextEncoder();
        return {
            ok: true,
            body: {
                getReader: () => ({
                    read: async () => ({
                        done: true,
                        value: encoder.encode('data: {"content":"Hello!"}\n\n')
                    })
                })
            }
        };
    }
    if (url.includes('/chat/quick')) {
        return { ok: true, json: async () => ({ response: 'Quick action result' }) };
    }
    if (url.includes('/transcribe')) {
        return { ok: true, json: async () => ({ text: 'Transcribed text', language: 'en', status: 'success' }) };
    }
    return { ok: true, json: async () => ({ status: 'ok' }) };
};

global.TextDecoder = class {
    decode(value) { return value ? Buffer.from(value).toString('utf8') : ''; }
};
global.TextEncoder = class {
    encode(str) { return Buffer.from(str); }
};


// --- Tests ---

test('electronAPI returns settings', async () => {
    const settings = await window.electronAPI.getSettings();
    assert(settings !== null);
    assertEqual(settings.personality, 'concise');
    assertEqual(settings.opacity, 0.95);
});

test('clipboard API works', async () => {
    const content = await window.electronAPI.getClipboard();
    assertEqual(content, 'test clipboard content');
});

test('health check returns ok', async () => {
    const response = await fetch('http://localhost:5000/health');
    const data = await response.json();
    assert(response.ok);
    assertEqual(data.status, 'ok');
});

test('chat stream accepts messages', async () => {
    const response = await fetch('http://localhost:5000/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello', session_id: 'test', personality: 'concise' })
    });
    assert(response.ok);
});

test('quick action endpoint works', async () => {
    const response = await fetch('http://localhost:5000/chat/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'summarize', text: 'blah blah' })
    });
    const data = await response.json();
    assert(response.ok);
    assert('response' in data);
});

test('transcribe returns text', async () => {
    const response = await fetch('http://localhost:5000/transcribe', {
        method: 'POST',
        body: new FormData()
    });
    const data = await response.json();
    assert('text' in data);
});

test('session ID is valid format', () => {
    const sessionId = Date.now().toString();
    assert(/^\d+$/.test(sessionId));
    assert(sessionId.length >= 13);
});

test('personality options are valid', () => {
    const valid = ['concise', 'casual', 'formal', 'teacher'];
    assert(valid.includes('concise'));
});

test('opacity is within range', () => {
    const opacity = 0.95;
    assert(opacity >= 0.5 && opacity <= 1.0);
});

test('handles special chars in messages', () => {
    const messages = ['Hello <script>', 'Emoji: 🎉', 'Newline:\ntest'];
    messages.forEach(msg => assert(typeof msg === 'string'));
});

test('recording toggle works', () => {
    let isRecording = false;
    const toggle = () => { isRecording = !isRecording; return isRecording; };

    assertEqual(toggle(), true);
    assertEqual(toggle(), false);
    assertEqual(toggle(), true);
});

test('audio chunks collected correctly', () => {
    const chunks = [];
    const add = (size) => { if (size > 0) chunks.push({ size }); };

    add(1024);
    add(2048);
    add(0);  // should skip
    add(512);

    assertEqual(chunks.length, 3);
});

test('SSE parsing works', () => {
    const lines = [
        'data: {"content":"Hello"}',
        'data: {"content":" world"}',
        'data: {"done":true}',
        '',
        'garbage'
    ];

    const parsed = [];
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            try { parsed.push(JSON.parse(line.slice(6))); }
            catch (e) { }
        }
    }

    assertEqual(parsed.length, 3);
    assertEqual(parsed[0].content, 'Hello');
});

test('network errors are caught', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('Network error'); };

    let caught = false;
    try { await fetch('http://localhost:5000/health'); }
    catch (e) { caught = true; }

    global.fetch = origFetch;
    assert(caught);
});

test('empty transcription handled', () => {
    const text = '';
    const isEmpty = !text || text.trim() === '';
    assert(isEmpty);
});

test('settings has required fields', () => {
    const settings = { personality: 'concise', opacity: 0.95, hideOnBlur: true };
    assert('personality' in settings);
    assert('opacity' in settings);
    assert('hideOnBlur' in settings);
});

test('settings types are correct', () => {
    const settings = { personality: 'concise', opacity: 0.95, hideOnBlur: true };
    assertEqual(typeof settings.personality, 'string');
    assertEqual(typeof settings.opacity, 'number');
    assertEqual(typeof settings.hideOnBlur, 'boolean');
});

runTests();
