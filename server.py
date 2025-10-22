import os
import logging
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
import json

# Set up logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Get API key and validate
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    logger.error("GROQ_API_KEY environment variable is not set")
    raise ValueError("GROQ_API_KEY environment variable is not set")

app = Flask(__name__)
# Configure CORS for security - restrict to your frontend origin
CORS(app, resources={r"/*": {"origins": ["http://localhost:*", "app://*"]}})

# Initialize Groq client with error handling
try:
    client = Groq(api_key=GROQ_API_KEY)
except Exception as e:
    logger.error(f"Failed to initialize Groq client: {e}")
    raise

# Store conversation history in memory
conversations = {}

@app.route('/health', methods=['GET'])
def health_check():
    return {"status": "ok", "message": "GhostAI Server Running"}

@app.route('/chat/stream', methods=['POST'])
def chat_stream():
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
    
    # Limit history to last 10 messages
    if len(conversations[session_id]) > 10:
        conversations[session_id] = conversations[session_id][-10:]
    
    # System prompts based on personality
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
            logger.info(f"Sending request to Groq API with session {session_id}")
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
            
            # Save assistant response
            conversations[session_id].append({
                "role": "assistant",
                "content": full_response
            })
            
            yield f"data: {json.dumps({'done': True})}\n\n"
            
        except Exception as e:
            logger.error(f"Error in chat stream: {str(e)}")
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
        logger.info(f"Processing quick action: {action}")
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
        logger.error(f"Error in quick action: {str(e)}")
        return {"error": str(e)}, 500

@app.route('/history/clear', methods=['POST'])
def clear_history():
    data = request.json
    session_id = data.get('session_id', 'default')
    
    if session_id in conversations:
        conversations[session_id] = []
        logger.info(f"Cleared history for session {session_id}")
    
    return {"status": "cleared"}

# Session cleanup - add a route to clean old sessions
@app.route('/maintenance/cleanup', methods=['POST'])
def cleanup_sessions():
    # This would be better with authentication
    count = len(conversations)
    conversations.clear()
    logger.info(f"Cleaned up {count} conversation sessions")
    return {"status": "cleaned", "count": count}

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"Starting GhostAI server on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
