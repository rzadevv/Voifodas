import os
import logging
import json
import base64
from io import BytesIO
from flask import Flask, request, Response, stream_with_context, jsonify
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
from tempfile import NamedTemporaryFile
import whisper
import torch

# OCR
try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True

    import platform
    if platform.system() == 'Windows':
        tesseract_path = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
        if os.path.exists(tesseract_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
except ImportError:
    OCR_AVAILABLE = False


logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


load_dotenv()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    logger.error("GROQ_API_KEY not set")
    raise ValueError("GROQ_API_KEY not set. Create a .env file with your API key.")

if GROQ_API_KEY == "your_groq_api_key_here":
    logger.error("Replace placeholder API key")
    raise ValueError("Invalid API key. Update your .env file.")


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://localhost:*", "app://*"]}})


try:
    client = Groq(api_key=GROQ_API_KEY)
    logger.info("✅ Groq client initialized successfully")
except Exception as e:
    logger.error(f"Failed to init Groq: {e}")
    raise

# whisper
whisper_model = None
DEVICE = "cpu"

try:
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"🔧 Loading Whisper model on device: {DEVICE}")
    whisper_model = whisper.load_model("base", device=DEVICE)
    logger.info("✅ Whisper model loaded successfully")
    
    if DEVICE == "cuda":
        logger.info("🚀 GPU acceleration enabled")
    else:
        logger.info("💻 Using CPU for transcription")
        
except Exception as e:
    logger.error(f"❌ Failed to load Whisper model: {e}")
    logger.warning("⚠️ Speech-to-text features will be unavailable")
    whisper_model = None
    DEVICE = "N/A"


conversations = {}


@app.route('/health', methods=['GET'])
def health_check():
    """basic health check"""
    whisper_status = "available" if whisper_model else "unavailable"
    return {
        "status": "ok", 
        "message": "Voifodas Server Running",
        "whisper": whisper_status,
        "device": DEVICE if whisper_model else "N/A"
    }


@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    """transcribe audio using whisper"""
    try:
        if not whisper_model:
            logger.error("Whisper model not available")
            return jsonify({
                "error": "Speech-to-text service unavailable. Please check server logs."
            }), 503
        
        if 'audio' not in request.files:
            logger.warning("No audio file in request")
            return jsonify({"error": "No audio file provided"}), 400
        
        audio_file = request.files['audio']
        
        if audio_file.filename == '':
            logger.warning("Empty audio filename")
            return jsonify({"error": "No audio file selected"}), 400
        
        logger.info(f"📝 Transcribing audio file: {audio_file.filename}")
        
        # save to temp file
        with NamedTemporaryFile(delete=False, suffix='.webm') as temp_audio:
            audio_file.save(temp_audio.name)
            temp_path = temp_audio.name
        
        try:
            logger.info("🎤 Starting transcription...")
            result = whisper_model.transcribe(
                temp_path,
                fp16=False,
                language=None  # auto-detect
            )
            
            transcribed_text = result['text'].strip()
            detected_language = result.get('language', 'unknown')
            
            logger.info(f"✅ Transcription successful: '{transcribed_text[:50]}...'")
            logger.info(f"🌍 Detected language: {detected_language}")
            
            return jsonify({
                "text": transcribed_text,
                "language": detected_language,
                "status": "success"
            }), 200
            
        finally:
            # cleanup temp file
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


@app.route('/ocr', methods=['POST'])
def ocr_screen():
    """extract text from screenshot using OCR"""
    try:
        if not OCR_AVAILABLE:
            logger.error("OCR not available - pytesseract not installed")
            return jsonify({
                "error": "OCR service unavailable. Install pytesseract and Tesseract-OCR."
            }), 503
        
        data = request.json
        if not data or 'image' not in data:
            return jsonify({"error": "No image data provided"}), 400
        
        # decode base64 image
        image_data = data['image']
        if image_data.startswith('data:image'):
            # remove data URL prefix
            image_data = image_data.split(',')[1]
        
        try:
            image_bytes = base64.b64decode(image_data)
            image = Image.open(BytesIO(image_bytes))
        except Exception as e:
            logger.error(f"Failed to decode image: {e}")
            return jsonify({"error": "Invalid image data"}), 400
        
        logger.info(f"📷 Processing screenshot: {image.size[0]}x{image.size[1]}")
        
        # extract text with OCR
        extracted_text = pytesseract.image_to_string(image)
        extracted_text = extracted_text.strip()
        
        if not extracted_text:
            logger.info("No text detected in screenshot")
            return jsonify({
                "text": "",
                "message": "No text detected in the screenshot",
                "status": "success"
            }), 200
        
        logger.info(f"✅ OCR extracted {len(extracted_text)} characters")
        
        # optionally analyze with AI
        analyze = data.get('analyze', False)
        ai_response = None
        
        if analyze and extracted_text:
            try:
                prompt = data.get('prompt', 'Analyze this screen content and provide helpful context or answers:')
                logger.info("🤖 Sending to AI for analysis...")
                
                completion = client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": "You are a helpful AI assistant. The user is showing you text from their screen. Provide concise, actionable help based on what you see. If it looks like a question or problem, provide the answer directly."},
                        {"role": "user", "content": f"{prompt}\n\n---\nScreen content:\n{extracted_text}"}
                    ],
                    model="llama-3.1-8b-instant",
                    temperature=0.5,
                    max_tokens=1024
                )
                ai_response = completion.choices[0].message.content
                logger.info("✅ AI analysis complete")
            except Exception as e:
                logger.error(f"AI analysis failed: {e}")
                ai_response = f"Analysis failed: {str(e)}"
        
        return jsonify({
            "text": extracted_text,
            "analysis": ai_response,
            "status": "success"
        }), 200
        
    except Exception as e:
        logger.error(f"❌ OCR error: {str(e)}")
        return jsonify({
            "error": f"OCR failed: {str(e)}",
            "status": "error"
        }), 500


@app.route('/analyze-context', methods=['POST'])
def analyze_context():
    """analyze combined screen + audio context"""
    try:
        data = request.json
        screen_context = data.get('screen_context', '')
        transcript_context = data.get('transcript_context', '')
        user_question = data.get('question', '')
        
        # playbook settings (optional)
        playbook_name = data.get('playbook_name', 'General')
        playbook_system = data.get('playbook_system', 'You are a helpful AI assistant. Be concise and direct.')
        playbook_context = data.get('playbook_context', 'Provide helpful context based on what you see and hear.')
        
        if not screen_context and not transcript_context:
            return jsonify({"error": "No context provided"}), 400
        
        # build context-aware prompt
        context_parts = []
        
        if screen_context:
            context_parts.append(f"**Screen Content (OCR):**\n{screen_context[:2000]}")
        
        if transcript_context:
            context_parts.append(f"**Live Transcript (Audio):**\n{transcript_context[:2000]}")
        
        full_context = "\n\n".join(context_parts)
        
        # use playbook-specific prompting
        if user_question:
            prompt = f"""{playbook_context}

{full_context}

---
User's Question: {user_question}

Provide a helpful, concise answer based on the context above."""
        else:
            prompt = f"""{playbook_context}

{full_context}

---
Analyze this context and provide:
1. A brief summary of what's happening
2. Key insights or action items
3. Helpful suggestions based on the {playbook_name} scenario

Be concise and actionable."""

        logger.info(f"🧠 Analyzing context with playbook '{playbook_name}': {len(screen_context)} chars screen, {len(transcript_context)} chars audio")
        
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": playbook_system},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.1-8b-instant",
            temperature=0.5,
            max_tokens=1024
        )
        
        analysis = completion.choices[0].message.content
        logger.info("✅ Context analysis complete")
        
        return jsonify({
            "analysis": analysis,
            "status": "success"
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Context analysis error: {str(e)}")
        return jsonify({
            "error": f"Analysis failed: {str(e)}",
            "status": "error"
        }), 500


@app.route('/auto-suggest', methods=['POST'])
def auto_suggest():
    """passive AI mode - generate proactive suggestions"""
    try:
        data = request.json
        transcript = data.get('transcript', '')
        screen = data.get('screen', '')
        playbook_name = data.get('playbook_name', 'General')
        playbook_system = data.get('playbook_system', 'You are a helpful AI assistant.')
        playbook_context = data.get('playbook_context', '')
        
        if not transcript and not screen:
            return jsonify({"error": "No context provided"}), 400
        
        # combine context
        context = ""
        if screen:
            context += f"[SCREEN]: {screen[:1000]}\n\n"
        if transcript:
            context += f"[AUDIO]: {transcript[:1000]}"
        
        prompt = f"""{playbook_context}

Context:
{context}

Provide a SHORT, actionable suggestion (2-3 sentences max).
If there's a question, answer it directly.
If there's a problem, provide a solution.
Be extremely concise."""

        logger.info(f"🤖 Auto-suggest for {playbook_name}")
        
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": playbook_system + " Be extremely concise."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.1-8b-instant",
            temperature=0.3,
            max_tokens=150
        )
        
        response_text = completion.choices[0].message.content
        
        # detect type
        detected_type = "insight"
        lower_text = response_text.lower()[:100]
        if "?" in context or "question" in lower_text:
            detected_type = "question"
        elif "code" in lower_text or "error" in lower_text or "function" in lower_text:
            detected_type = "code"
        elif "action" in lower_text or "todo" in lower_text or "should" in lower_text:
            detected_type = "action"
        
        logger.info(f"✅ Auto-suggest: {detected_type}")
        
        return jsonify({
            "suggestion": response_text,
            "detected_type": detected_type,
            "status": "success"
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Auto-suggest error: {str(e)}")
        return jsonify({"error": str(e)}, 500)


@app.route('/chat/stream', methods=['POST'])
def chat_stream():
    """stream chat responses from groq"""
    data = request.json
    user_message = data.get('message', '')
    session_id = data.get('session_id', 'default')
    personality = data.get('personality', 'concise')

    if not user_message:
        return Response(
            stream_with_context((f"data: {json.dumps({'error': 'Empty message'})}\n\n" for _ in [])),
            mimetype='text/event-stream'
        )

    # init conversation history for this session
    if session_id not in conversations:
        conversations[session_id] = []

    conversations[session_id].append({
        "role": "user",
        "content": user_message
    })

    # keep only last 10 messages
    if len(conversations[session_id]) > 10:
        conversations[session_id] = conversations[session_id][-10:]

    # different personalities
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

            # save response to history
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


@app.route('/chat/quick', methods=['POST'])
def quick_action():
    """handle quick actions on clipboard text"""
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


@app.route('/history/clear', methods=['POST'])
def clear_history():
    """clear conversation history for a session"""
    data = request.json
    session_id = data.get('session_id', 'default')

    if session_id in conversations:
        conversations[session_id] = []
        logger.info(f"Cleared history for {session_id}")

    return {"status": "cleared"}


@app.route('/maintenance/cleanup', methods=['POST'])
def cleanup_sessions():
    """wipe all sessions"""
    count = len(conversations)
    conversations.clear()
    logger.info(f"Cleaned up {count} sessions")
    return {"status": "cleaned", "count": count}


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"🚀 Starting Voifodas server on port {port}")
    logger.info(f"🎤 Speech-to-text: {'✅ Enabled' if whisper_model else '❌ Disabled'}")
    app.run(host='0.0.0.0', port=port, debug=False)
