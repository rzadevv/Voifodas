"""
Pytest fixtures - shared across all tests
"""

import pytest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope='session')
def api_base_url():
    return os.environ.get('API_URL', 'http://localhost:5000')


@pytest.fixture
def sample_user_message():
    return "What is the meaning of life?"


@pytest.fixture
def sample_session_id():
    import time
    return f"test_session_{int(time.time() * 1000)}"


@pytest.fixture
def valid_settings():
    return {
        'personality': 'concise',
        'theme': 'dark',
        'opacity': 0.95,
        'hideOnBlur': True
    }


@pytest.fixture
def sample_audio_data():
    return b'webm' + os.urandom(1000)


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: slow tests")
    config.addinivalue_line("markers", "integration: needs running server")


def pytest_collection_modifyitems(config, items):
    for item in items:
        if 'integration' in item.nodeid.lower():
            item.add_marker(pytest.mark.integration)
        if 'slow' in item.nodeid.lower():
            item.add_marker(pytest.mark.slow)


@pytest.fixture(autouse=True)
def reset_test_environment():
    os.environ['TESTING'] = 'true'
    yield
    if 'TESTING' in os.environ:
        del os.environ['TESTING']
