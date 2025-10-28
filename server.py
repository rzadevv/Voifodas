import os
import logging
from flask import Flask, request, Response, stream_with_context, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
import json
import whisper
import torch
from tempfile import NamedTemporaryFile

# ============================================
# LOGGING CONFIGURATION
# ============================================
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============================================
# ENVIRONMENT SETUP
# ============================================
load_dotenv()

# Get Groq API key
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    logger.error("GROQ_API_KEY not set")
    raise ValueError("GROQ_API_KEY not set. Create a .env file with your API key.")

if GROQ_API_KEY == "your_groq_api_key_here":
    logger.error("Replace placeholder API key")
    raise ValueError("Invalid API key. Update your .env file.")

# ============================================
# FLASK APP INITIALIZATION
# ============================================
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://localhost:*", "app://*"]}})

# ============================================
# GROQ CLIENT INITIALIZATION
# ============================================
try:
    client = Groq(api_key=GROQ_API_KEY)
    logger.info("✅ Groq client initialized successfully")
except Exception as e:
    logger.error(f"Failed to init Groq: {e}")
    raise

# ============================================
# WHISPER MODEL INITIALIZATION (NEW)
# ============================================
try:
    # Check if CUDA is available for GPU acceleration
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"🔧 Loading Whisper model on device: {DEVICE}")
    
    # Load the Whisper base model
    whisper_model = whisper.load_model("base", device=DEVICE)
    logger.info("✅ Whisper model loaded successfully")
    
    if DEVICE == "cuda":
        logger.info("🚀 GPU acceleration enabled for faster transcription")
    else:
        logger.info("💻 Using CPU for transcription (offline mode)")
        
except Exception as e:
    logger.error(f"❌ Failed to load Whisper model: {e}")
    logger.warning("⚠️ Speech-to-text features will be unavailable")
    whisper_model = None

# ============================================
# CONVERSATION HISTORY
# ============================================
conversations = {}

# ============================================
# HEALTH CHECK ENDPOINT
# ============================================
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint to verify server is running"""
    whisper_status = "available" if whisper_model else "unavailable"
    return {
        "status": "ok", 
        "message": "Voifodas Server Running",
        "whisper": whisper_status,
        "device": DEVICE if whisper_model else "N/A"
    }

# ============================================
# SPEECH-TO-TEXT ENDPOINT (NEW)
# ============================================
@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    """
    Transcribe audio file using Whisper model
    
    Expects:
        - 'audio' file in multipart/form-data
        - Audio should be in WebM format (from browser MediaRecorder)
    
    Returns:
        - JSON with transcribed text
        - Error message if transcription fails
    """
    try:
        # Check if Whisper model is loaded
        if not whisper_model:
            logger.error("Whisper model not available")
            return jsonify({
                "error": "Speech-to-text service unavailable. Please check server logs."
            }), 503
        
        # Check if audio file is in the request
        if 'audio' not in request.files:
            logger.warning("No audio file in request")
            return jsonify({"error": "No audio file provided"}), 400
        
        audio_file = request.files['audio']
        
        # Check if file is empty
        if audio_file.filename == '':
            logger.warning("Empty audio filename")
            return jsonify({"error": "No audio file selected"}), 400
        
        logger.info(f"📝 Transcribing audio file: {audio_file.filename}")
        
        # Create a temporary file to save the audio
        with NamedTemporaryFile(delete=False, suffix='.webm') as temp_audio:
            audio_file.save(temp_audio.name)
            temp_path = temp_audio.name
        
        try:
            # Transcribe the audio using Whisper
            logger.info("🎤 Starting transcription...")
            result = whisper_model.transcribe(
                temp_path,
                fp16=False,  # Disable FP16 for CPU compatibility
                language=None  # Auto-detect language
            )
            
            # Extract transcribed text
            transcribed_text = result['text'].strip()
            
            # Get detected language
            detected_language = result.get('language', 'unknown')
            
            logger.info(f"✅ Transcription successful: '{transcribed_text[:50]}...'")
            logger.info(f"🌍 Detected language: {detected_language}")
            
            # Return transcription result
            return jsonify({
                "text": transcribed_text,
                "language": detected_language,
                "status": "success"
            }), 200
            
        finally:
            # Clean up temporary file
            try:
                os.unlink(temp_path)
                logger.debug(f"🗑️ Cleaned up temporary file: {temp_path}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to delete temp file: {cleanup_error}")
    
    except Exception as e:
        logger.error(f"❌ Transcription error: {str(e)}")
        return jsonify({
            "error": f"Transcription failed: {str(e)}",
            "status": "error"
        }), 500

# ============================================
# STREAMING CHAT ENDPOINT
# ============================================
@app.route('/chat/stream', methods=['POST'])
def chat_stream():
    """Stream chat responses from Groq API"""
    data = request.json
    user_message = data.get('message', '')
    session_id = data.get('session_id', 'default')
    personality = data.get('personality', 'concise')

    if not user_message:
        return Response(
            stream_with_context((f"data: {json.dumps({'error': 'Empty message'})}\n\n" for _ in [])),
            mimetype='text/event-stream'
        )

    # Initialize conversation history
    if session_id not in conversations:
        conversations[session_id] = []

    # Add user message to history
    conversations[session_id].append({
        "role": "user",
        "content": user_message
    })

    # Keep only last 10 messages
    if len(conversations[session_id]) > 10:
        conversations[session_id] = conversations[session_id][-10:]

    # System prompts for different personalities
    system_prompts = {
        'concise': "You are a helpful AI assistant. Be concise and direct.",
        'casual': "You are a friendly AI assistant. Be casual and conversational.",
        'formal': "You are a professional AI assistant. Be formal and detailed.",
        'teacher': "You are a patient teacher. Explain concepts clearly with examples."
    }

    messages = [
        {"role": "system", "content": system_prompts.get(personality, system_prompts['concise'])}
    ] + conversations[session_id]

    def generate():
        try:
            logger.info(f"Request to Groq - session {session_id}")
            stream = client.chat.completions.create(
                messages=messages,
                model="llama-3.1-8b-instant",
                temperature=0.7,
                max_tokens=1024,
                top_p=1,
                stream=True
            )

            full_response = ""
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_response += content
                    yield f"data: {json.dumps({'content': content})}\n\n"

            # Save assistant response to history
            conversations[session_id].append({
                "role": "assistant",
                "content": full_response
            })

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            logger.error(f"Error in chat: {str(e)}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )

# ============================================
# QUICK ACTION ENDPOINT
# ============================================
@app.route('/chat/quick', methods=['POST'])
def quick_action():
    """Handle quick actions on clipboard text"""
    data = request.json
    action = data.get('action', 'summarize')
    text = data.get('text', '')

    if not text:
        return {"error": "No text provided"}, 400

    prompts = {
        'summarize': f"Summarize this text concisely:\n\n{text}",
        'translate': f"Translate this text to English:\n\n{text}",
        'explain': f"Explain this in simple terms:\n\n{text}",
        'code': f"Explain this code:\n\n{text}"
    }

    try:
        logger.info(f"Quick action: {action}")
        completion = client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompts.get(action, prompts['summarize'])}
            ],
            model="llama-3.1-8b-instant",
            temperature=0.5,
            max_tokens=512
        )

        return {"response": completion.choices[0].message.content}

    except Exception as e:
        logger.error(f"Quick action error: {str(e)}")
        return {"error": str(e)}, 500

# ============================================
# HISTORY MANAGEMENT ENDPOINTS
# ============================================
@app.route('/history/clear', methods=['POST'])
def clear_history():
    """Clear conversation history for a session"""
    data = request.json
    session_id = data.get('session_id', 'default')

    if session_id in conversations:
        conversations[session_id] = []
        logger.info(f"Cleared history for {session_id}")

    return {"status": "cleared"}

@app.route('/maintenance/cleanup', methods=['POST'])
def cleanup_sessions():
    """Clean up all conversation sessions"""
    count = len(conversations)
    conversations.clear()
    logger.info(f"Cleaned up {count} sessions")
    return {"status": "cleaned", "count": count}

# ============================================
# SERVER STARTUP
# ============================================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"🚀 Starting Voifodas server on port {port}")
    logger.info(f"🎤 Speech-to-text: {'✅ Enabled' if whisper_model else '❌ Disabled'}")
    app.run(host='0.0.0.0', port=port, debug=False)
