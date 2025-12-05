# 👻 Ghost

A Flask-based AI assistant server with local speech-to-text capabilities. Combines Groq's LLM with OpenAI's Whisper for privacy-focused audio transcription.

## Project Status

- ✅ Streaming chat with Groq's Llama 3.1
- ✅ Local speech transcription using Whisper
- ✅ Multiple AI personalities (concise, casual, formal, teacher)
- ✅ Quick actions (summarize, translate, explain, code analysis)
- ✅ Session-based conversation management
- ✅ GPU acceleration support
- 🚧 Web interface in development
- 📋 User authentication planned
- 📋 Database integration under consideration

## Getting Started

Prerequisites: Python 3.8+ and a Groq API key from [console.groq.com](https://console.groq.com/).

```bash
# Install dependencies
pip install flask flask-cors groq python-dotenv openai-whisper torch

# Configure environment (.env file)
GROQ_API_KEY=your_actual_key_here
PORT=5000

# Run the server
python server.py
```

Server will be available at `http://localhost:5000`.

## API Endpoints

### Streaming Chat

```http
POST /chat/stream
{
  "message": "Explain quantum computing",
  "session_id": "user123",
  "personality": "teacher"
}
```

Available personalities: `concise`, `casual`, `formal`, `teacher`

### Audio Transcription

```http
POST /transcribe
Content-Type: multipart/form-data
audio: your_file.webm
```

Returns transcribed text with language detection.

### Quick Actions

```http
POST /chat/quick
{
  "action": "summarize",
  "text": "Long text to process..."
}
```

Supported actions: `summarize`, `translate`, `explain`, `code`

### Utility Endpoints

- `GET /health` - Server status check
- `POST /history/clear` - Clear session history
- `POST /maintenance/cleanup` - Remove all sessions

## Usage Example

JavaScript client implementation:

```javascript
const response = await fetch('http://localhost:5000/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Explain machine learning',
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
  // Process streamed response
}
```

## Configuration

Environment variables in `.env`:

- `GROQ_API_KEY` - Required for AI chat functionality
- `PORT` - Server port (default: 5000)

Whisper model defaults to `base`. Change in `server.py` for different accuracy/speed tradeoffs:
- `tiny` - Fastest, lower accuracy
- `base` - Balanced (default)
- `small` - Better accuracy
- `large` - Highest accuracy, slower

## Technical Details

- Conversation history stored in memory (clears on restart)
- Session limit: 10 messages per conversation
- Temporary audio files auto-deleted after transcription
- Automatic language detection for audio input
- CUDA acceleration when compatible GPU detected

## Stack

- **Backend:** Flask, Python 3.8+
- **AI/LLM:** Groq (Llama 3.1)
- **Speech:** OpenAI Whisper
- **ML Framework:** PyTorch
