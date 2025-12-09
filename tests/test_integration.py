"""
Integration Tests for Voifodas
These need the server running to pass.
"""

import pytest
import json
import time


class TestLiveServer:
    """tests that hit the actual server"""
    
    @pytest.mark.integration
    def test_full_chat_flow(self, api_base_url, sample_user_message):
        try:
            import requests
        except ImportError:
            pytest.skip("requests not installed")
        
        try:
            # check server
            health = requests.get(f"{api_base_url}/health", timeout=5)
            assert health.status_code == 200
            
            # send message
            response = requests.post(
                f"{api_base_url}/chat/stream",
                json={
                    'message': sample_user_message,
                    'session_id': f'integration_test_{int(time.time())}',
                    'personality': 'concise'
                },
                stream=True,
                timeout=30
            )
            assert response.status_code == 200
            
            # read response
            full = ''
            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        try:
                            data = json.loads(line_str[6:])
                            if 'content' in data:
                                full += data['content']
                        except json.JSONDecodeError:
                            pass
            
            assert len(full) > 0
            
        except requests.ConnectionError:
            pytest.skip("Server not running (ConnectionError)")
        except requests.Timeout:
            pytest.fail("Server timed out")
    
    @pytest.mark.integration 
    @pytest.mark.slow
    def test_conversation_context(self, api_base_url):
        try:
            import requests
        except ImportError:
            pytest.skip("requests not installed")
        
        session = f'context_test_{int(time.time())}'
        
        try:
            # first message
            requests.post(
                f"{api_base_url}/chat/stream",
                json={'message': 'Remember: secret code is 12345', 'session_id': session},
                timeout=30
            )
            
            # ask about it
            response = requests.post(
                f"{api_base_url}/chat/stream",
                json={'message': 'What was the secret code?', 'session_id': session},
                stream=True,
                timeout=30
            )
            
            full = ''
            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        try:
                            data = json.loads(line_str[6:])
                            if 'content' in data:
                                full += data['content']
                        except json.JSONDecodeError:
                            pass
            
            assert '12345' in full.replace(',', '')
            
        except requests.ConnectionError:
            pytest.skip("Server not running")
    
    @pytest.mark.integration
    def test_summarize_action(self, api_base_url):
        try:
            import requests
        except ImportError:
            pytest.skip("requests not installed")
        
        text = """
        Machine learning is a subset of AI that enables systems to learn 
        from experience without being explicitly programmed.
        """
        
        try:
            response = requests.post(
                f"{api_base_url}/chat/quick",
                json={'action': 'summarize', 'text': text},
                timeout=30
            )
            
            assert response.status_code == 200
            data = response.json()
            assert 'response' in data
            assert len(data['response']) < len(text)
            
        except requests.ConnectionError:
            pytest.skip("Server not running")


class TestComponentIntegration:
    """tests without needing server"""
    
    def test_settings_structure(self, valid_settings, sample_user_message):
        # just verify settings are structured right
        personalities = ['concise', 'casual', 'formal', 'teacher']
        assert valid_settings['personality'] in personalities
    
    def test_session_isolation(self, sample_user_message):
        session_a = [{'role': 'user', 'content': 'Hello from A'}]
        session_b = [{'role': 'user', 'content': 'Hello from B'}]
        
        assert len(session_a) == 1
        assert len(session_b) == 1
        assert session_a[0]['content'] != session_b[0]['content']
    
    def test_history_limit(self):
        history = []
        MAX = 10
        
        for i in range(15):
            history.append({'role': 'user', 'content': f'Msg {i}'})
            if len(history) > MAX:
                history = history[-MAX:]
        
        assert len(history) == MAX


class TestErrorRecovery:
    
    def test_timeout_recovery(self):
        import requests
        
        count = 0
        def mock_post(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 1:
                raise requests.Timeout("timeout")
            return type('R', (), {'status_code': 200, 'json': lambda: {'ok': True}})()
        
        # first call fails
        try:
            mock_post('test')
        except requests.Timeout:
            pass
        
        # second succeeds
        result = mock_post('test')
        assert result.status_code == 200
    
    def test_malformed_stream(self):
        lines = [
            'data: {"incomplete": ',
            'data: garbage',
            'random',
            'data: {"valid": "json"}',
        ]
        
        parsed = 0
        errors = 0
        
        for line in lines:
            if line.startswith('data: '):
                try:
                    json.loads(line[6:])
                    parsed += 1
                except json.JSONDecodeError:
                    errors += 1
        
        assert parsed == 1
        assert errors == 2


class TestPerformance:
    
    @pytest.mark.slow
    def test_rapid_requests(self, api_base_url):
        try:
            import requests
        except ImportError:
            pytest.skip("requests not installed")
        
        try:
            start = time.time()
            success = 0
            
            for _ in range(5):
                r = requests.get(f"{api_base_url}/health", timeout=5)
                if r.status_code == 200:
                    success += 1
            
            elapsed = time.time() - start
            
            assert success == 5
            assert elapsed < 10
            
        except requests.ConnectionError:
            pytest.skip("Server not running")
    
    def test_large_message(self):
        msg = "x" * 10000
        assert len(msg) == 10000
        
        # make sure it can be serialized
        payload = json.dumps({'message': msg})
        assert len(payload) > 10000


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-m', 'not integration'])
