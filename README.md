# 👻 Ghost - AI Assistant Server

> A lightweight Flask-based AI assistant with speech-to-text capabilities, powered by Groq's LLM and OpenAI's Whisper.

## 🚧 Project Status

| Feature | Status |
|---------|--------|
| AI Chat Streaming | ✅ Complete |
| Speech-to-Text | ✅ Complete |
| Multiple Personalities | ✅ Complete |
| Quick Actions | ✅ Complete |
| Session Management | ✅ Complete |
| GPU Acceleration | ✅ Complete |
| Web Interface | 🚧 In Progress |
| User Authentication | 📋 Planned |
| Database Integration | 📋 Planned |

## ✨ Features

- 🤖 **AI Chat** - Streaming responses with Groq's Llama 3.1
- 🎤 **Speech-to-Text** - Local Whisper transcription
- 🎭 **Personalities** - Concise, casual, formal, or teacher modes
- ⚡ **Quick Actions** - Summarize, translate, explain, analyze code
- 💾 **Sessions** - Maintains conversation history
- 🚀 **GPU Support** - Auto CUDA acceleration

## 🚀 Quick Start

```bash
# Install dependencies
pip install flask flask-cors groq python-dotenv openai-whisper torch

# Configure .env
GROQ_API_KEY=your_key_here
PORT=5000

# Run server
python server.py
```

Get your Groq API key at [console.groq.com](https://console.groq.com/)

## 📡 API Endpoints

### Chat Stream
```http
POST /chat/stream
{
  "message": "Hello!",
  "session_id": "user123",
  "personality": "casual"  // concise|casual|formal|teacher
}
```

### Transcribe Audio
```http
POST /transcribe
Content-Type: multipart/form-data
audio: <file.webm>
```

### Quick Actions
```http
POST /chat/quick
{
  "action": "summarize",  // summarize|translate|explain|code
  "text": "Your text here"
}
```

### Other Endpoints
- `GET /health` - Server status
- `POST /history/clear` - Clear session history
- `POST /maintenance/cleanup` - Clear all sessions

## 💡 Usage Example

```javascript
// Streaming chat
const response = await fetch('http://localhost:5000/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Explain AI',
    session_id: 'user123',
    personality: 'teacher'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  // Process SSE data
}
```

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | Required | Your Groq API key |
| `PORT` | 5000 | Server port |

**Whisper Models:** `tiny`, `base` (default), `small`, `medium`, `large`

## 🛠️ Tech Stack

- **Backend:** Flask, Python 3.8+
- **AI:** Groq (Llama 3.1), OpenAI Whisper
- **ML:** PyTorch (CUDA support)

## 📝 Notes

- Conversations stored in memory (cleared on restart)
- Max 10 messages per session
- Audio files auto-cleanup
- Auto language detection

