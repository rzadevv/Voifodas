# Ghost

AI assistant with local speech-to-text. Uses Groq's LLM and Whisper for transcription.

## Setup

Requires Python 3.8+ and a Groq API key from [console.groq.com](https://console.groq.com/).

```bash
pip install flask flask-cors groq python-dotenv openai-whisper torch
```

Create `.env`:
```
GROQ_API_KEY=key_here
PORT=5000
```

Run:
```bash
python server.py
```

## API

### Chat (streaming)
```http
POST /chat/stream
{"message": "your question", "session_id": "user123", "personality": "concise"}
```
Personalities: `concise`, `casual`, `formal`, `teacher`

### Transcription
```http
POST /transcribe
Content-Type: multipart/form-data
audio: file.webm
```

### Quick Actions
```http
POST /chat/quick
{"action": "summarize", "text": "..."}
```
Actions: `summarize`, `translate`, `explain`, `code`

### Other
- `GET /health` - status check
- `POST /history/clear` - clear session
- `POST /maintenance/cleanup` - wipe all sessions

## Notes

- Conversation history is in-memory only
- Max 10 messages per session
- Uses CUDA if available
- Whisper model can be changed in `server.py` (tiny/base/small/large)
