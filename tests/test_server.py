"""
Tests for Voifodas Flask Server

Run: pytest tests/test_server.py -v
"""

import pytest
import json
import os
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# --- Fixtures ---

@pytest.fixture
def mock_env():
    """Fake env vars so we don't need real API keys"""
    with patch.dict(os.environ, {
        'GROQ_API_KEY': 'test_api_key_12345',
        'PORT': '5000'
    }):
        yield


@pytest.fixture
def mock_groq():
    """Mock Groq so we don't burn API credits during tests"""
    import sys
    mock_groq_module = MagicMock()
    mock_client = MagicMock()
    mock_groq_module.Groq.return_value = mock_client
    sys.modules['groq'] = mock_groq_module
    yield mock_client
    mock_client.reset_mock()


@pytest.fixture
def mock_whisper():
    """Fake whisper - loading the real model takes ages"""
    mock_whisper_module = MagicMock()
    mock_model = MagicMock()
    mock_model.transcribe.return_value = {
        'text': 'Hello, this is a test transcription.',
        'language': 'en'
    }
    mock_whisper_module.load_model.return_value = mock_model
    sys.modules['whisper'] = mock_whisper_module
    yield mock_model


@pytest.fixture
def client(mock_env, mock_groq, mock_whisper):
    """Flask test client"""
    mock_torch = MagicMock()
    mock_torch.cuda.is_available.return_value = False
    sys.modules['torch'] = mock_torch
    
    from server import app
    app.config['TESTING'] = True
    with app.test_client() as test_client:
        yield test_client


# --- Health Check ---

class TestHealthEndpoint:
    
    def test_health_returns_200(self, client):
        response = client.get('/health')
        assert response.status_code == 200
    
    def test_health_returns_json(self, client):
        response = client.get('/health')
        data = json.loads(response.data)
        assert 'status' in data
        assert data['status'] == 'ok'
    
    def test_health_includes_whisper_status(self, client):
        response = client.get('/health')
        data = json.loads(response.data)
        assert 'whisper' in data
        assert data['whisper'] in ['available', 'unavailable']


# --- Chat ---

class TestChatEndpoint:
    
    def test_chat_requires_message(self, client):
        """empty message shouldn't crash"""
        response = client.post('/chat/stream',
            data=json.dumps({'session_id': 'test'}),
            content_type='application/json'
        )
        assert response.status_code == 200
    
    def test_chat_accepts_valid_request(self, client, mock_groq):
        mock_chunk = MagicMock()
        mock_chunk.choices = [MagicMock()]
        mock_chunk.choices[0].delta.content = "Hello!"
        mock_groq.chat.completions.create.return_value = iter([mock_chunk])
        
        response = client.post('/chat/stream',
            data=json.dumps({
                'message': 'Hello, AI!',
                'session_id': 'test_session',
                'personality': 'concise'
            }),
            content_type='application/json'
        )
        
        assert response.status_code == 200
        assert 'text/event-stream' in response.content_type
    
    def test_chat_supports_concise_personality(self, client, mock_groq):
        mock_chunk = MagicMock()
        mock_chunk.choices = [MagicMock()]
        mock_chunk.choices[0].delta.content = "Response"
        mock_groq.chat.completions.create.return_value = iter([mock_chunk])
        
        response = client.post('/chat/stream',
            data=json.dumps({
                'message': 'Test message',
                'session_id': 'test_concise',
                'personality': 'concise'
            }),
            content_type='application/json'
        )
        assert response.status_code == 200


# --- Quick Actions ---

class TestQuickActionEndpoint:
    
    def test_quick_action_requires_text(self, client):
        """can't summarize nothing lol"""
        response = client.post('/chat/quick',
            data=json.dumps({'action': 'summarize'}),
            content_type='application/json'
        )
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    @pytest.mark.skip(reason="needs module reload to mock groq properly")
    def test_quick_action_summarize(self, client, mock_groq):
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.content = "Processed result"
        mock_groq.chat.completions.create.return_value = mock_completion
        
        response = client.post('/chat/quick',
            data=json.dumps({
                'action': 'summarize',
                'text': 'Some text to process'
            }),
            content_type='application/json'
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'response' in data


# --- Transcription ---

class TestTranscriptionEndpoint:
    
    def test_transcribe_requires_audio_file(self, client):
        response = client.post('/transcribe')
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    def test_transcribe_with_valid_audio(self, client, mock_whisper):
        from io import BytesIO
        fake_audio = BytesIO(b'fake audio data for testing')
        fake_audio.name = 'test.webm'
        
        response = client.post('/transcribe',
            data={'audio': (fake_audio, 'recording.webm')},
            content_type='multipart/form-data'
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'text' in data
        assert data['status'] == 'success'


# --- Session Management ---

class TestSessionManagement:
    
    def test_clear_history(self, client):
        response = client.post('/history/clear',
            data=json.dumps({'session_id': 'test_session'}),
            content_type='application/json'
        )
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['status'] == 'cleared'
    
    def test_cleanup_all_sessions(self, client):
        response = client.post('/maintenance/cleanup',
            content_type='application/json'
        )
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['status'] == 'cleaned'
        assert 'count' in data


# --- Conversation Flow ---

class TestConversationFlow:
    
    @pytest.mark.skip(reason="needs module reload to mock groq properly")
    def test_single_message_session(self, client, mock_groq):
        mock_chunk = MagicMock()
        mock_chunk.choices = [MagicMock()]
        mock_chunk.choices[0].delta.content = "Response"
        mock_groq.chat.completions.create.return_value = iter([mock_chunk])
        
        response = client.post('/chat/stream',
            data=json.dumps({
                'message': 'Hello there',
                'session_id': 'simple_session_test'
            }),
            content_type='application/json'
        )
        assert response.status_code == 200
        assert mock_groq.chat.completions.create.called


# --- Error Handling ---

class TestErrorHandling:
    
    def test_invalid_json_body(self, client):
        """bad json shouldn't give 500"""
        response = client.post('/chat/stream',
            data='not valid json {{{',
            content_type='application/json'
        )
        assert response.status_code in [400, 415]
    
    def test_api_error_is_handled(self, client, mock_groq):
        mock_groq.chat.completions.create.side_effect = Exception("API rate limit exceeded")
        
        response = client.post('/chat/stream',
            data=json.dumps({
                'message': 'This should fail gracefully',
                'session_id': 'error_test'
            }),
            content_type='application/json'
        )
        # SSE returns 200 even on error, error is in the stream
        assert response.status_code == 200


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
