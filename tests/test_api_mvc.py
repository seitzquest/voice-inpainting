"""
Tests for MVC API endpoints
"""

import pytest
import io
from unittest.mock import patch, Mock

try:
    from fastapi.testclient import TestClient
    from src.api_mvc import router
    from src.session_manager import get_session_manager
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False
    TestClient = None


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="FastAPI dependencies not available")
class TestMVCAPI:
    """Test MVC API endpoints"""
    
    def test_create_session_endpoint(self, test_client, mock_audio_bytes, mock_session_state):
        """Test creating a new session via API"""
        # Mock session manager
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.create_session.return_value = "test-session-123"
            
            # Create form data with audio file
            files = {"audio": ("test.wav", io.BytesIO(mock_audio_bytes), "audio/wav")}
            data = {"device": "cpu"}
            
            response = test_client.post("/api/v2/sessions", files=files, data=data)
            
            assert response.status_code == 200
            result = response.json()
            assert result["session_id"] == "test-session-123"
            assert result["status"] == "created"
            
            # Verify session manager was called
            mock_manager.create_session.assert_called_once()
    
    def test_get_session_state(self, test_client, mock_session_state):
        """Test getting session state"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.get_session_state.return_value = mock_session_state
            
            response = test_client.get("/api/v2/sessions/test-session-123/state")
            
            assert response.status_code == 200
            result = response.json()
            assert result["session_id"] == "test-session-123"
            assert result["text"] == "hello world test"
            assert len(result["tokens"]) == 3
            assert result["can_undo"] == False
            assert result["can_redo"] == False
    
    def test_apply_edit(self, test_client, mock_session_state):
        """Test applying a single edit"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            # Mock updated state after edit
            updated_state = mock_session_state.copy()
            updated_state["text"] = "hello universe test"
            updated_state["can_undo"] = True
            updated_state["current_version_index"] = 1
            mock_manager.apply_edit.return_value = updated_state
            
            edit_data = {
                "start_token_idx": 1,
                "end_token_idx": 2,
                "new_text": "universe"
            }
            
            response = test_client.post(
                "/api/v2/sessions/test-session-123/edit",
                json=edit_data
            )
            
            assert response.status_code == 200
            result = response.json()
            assert result["text"] == "hello universe test"
            assert result["can_undo"] == True
            assert result["current_version_index"] == 1
            
            # Verify session manager was called
            mock_manager.apply_edit.assert_called_once_with(
                session_id="test-session-123",
                start_token_idx=1,
                end_token_idx=2,
                new_text="universe"
            )
    
    def test_apply_multiple_edits(self, test_client, mock_session_state):
        """Test applying multiple edits"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            # Mock updated state after edits
            updated_state = mock_session_state.copy()
            updated_state["text"] = "hi universe example"
            updated_state["can_undo"] = True
            updated_state["current_version_index"] = 1
            mock_manager.apply_multiple_edits.return_value = updated_state
            
            edit_data = {
                "edit_operations": [
                    {
                        "original_text": "hello",
                        "edited_text": "hi",
                        "start_token_idx": 0,
                        "end_token_idx": 1
                    },
                    {
                        "original_text": "world",
                        "edited_text": "universe",
                        "start_token_idx": 1,
                        "end_token_idx": 2
                    }
                ]
            }
            
            response = test_client.post(
                "/api/v2/sessions/test-session-123/multi-edit",
                json=edit_data
            )
            
            assert response.status_code == 200
            result = response.json()
            assert result["text"] == "hi universe example"
            assert result["can_undo"] == True
            
            # Verify session manager was called
            mock_manager.apply_multiple_edits.assert_called_once()
    
    def test_undo_edit(self, test_client, mock_session_state):
        """Test undoing an edit"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            # Mock state after undo (back to original)
            undone_state = mock_session_state.copy()
            undone_state["can_undo"] = False
            undone_state["can_redo"] = True
            undone_state["current_version_index"] = 0
            mock_manager.undo.return_value = undone_state
            
            response = test_client.post("/api/v2/sessions/test-session-123/undo")
            
            assert response.status_code == 200
            result = response.json()
            assert result["can_undo"] == False
            assert result["can_redo"] == True
            assert result["current_version_index"] == 0
            
            # Verify session manager was called
            mock_manager.undo.assert_called_once_with("test-session-123")
    
    def test_redo_edit(self, test_client, mock_session_state):
        """Test redoing an edit"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            # Mock state after redo
            redone_state = mock_session_state.copy()
            redone_state["can_undo"] = True
            redone_state["can_redo"] = False
            redone_state["current_version_index"] = 1
            mock_manager.redo.return_value = redone_state
            
            response = test_client.post("/api/v2/sessions/test-session-123/redo")
            
            assert response.status_code == 200
            result = response.json()
            assert result["can_undo"] == True
            assert result["can_redo"] == False
            assert result["current_version_index"] == 1
            
            # Verify session manager was called
            mock_manager.redo.assert_called_once_with("test-session-123")
    
    def test_restore_version(self, test_client, mock_session_state):
        """Test restoring to a specific version"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            # Mock state after restore
            restored_state = mock_session_state.copy()
            restored_state["current_version_index"] = 0
            mock_manager.restore_version.return_value = restored_state
            
            response = test_client.post("/api/v2/sessions/test-session-123/restore/0")
            
            assert response.status_code == 200
            result = response.json()
            assert result["current_version_index"] == 0
            
            # Verify session manager was called
            mock_manager.restore_version.assert_called_once_with("test-session-123", 0)
    
    def test_get_session_audio(self, test_client):
        """Test getting session audio"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            # Mock audio bytes
            mock_audio_bytes = b"fake audio data"
            mock_manager.get_audio_file.return_value = mock_audio_bytes
            
            response = test_client.get("/api/v2/sessions/test-session-123/audio")
            
            assert response.status_code == 200
            assert response.headers["content-type"] == "audio/wav"
            assert "attachment" in response.headers["content-disposition"]
            assert response.content == mock_audio_bytes
            
            # Verify session manager was called
            mock_manager.get_audio_file.assert_called_once_with("test-session-123")
    
    def test_list_sessions(self, test_client):
        """Test listing all sessions"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            mock_sessions = [
                {
                    "session_id": "session-1",
                    "created_at": 1640995200.0,
                    "last_accessed": 1640995200.0,
                    "audio_duration": 2.0,
                    "original_filename": "test1.wav",
                    "current_text_preview": "hello world",
                    "total_versions": 1,
                    "current_version_index": 0
                }
            ]
            mock_manager.list_sessions.return_value = mock_sessions
            
            response = test_client.get("/api/v2/sessions")
            
            assert response.status_code == 200
            result = response.json()
            assert "sessions" in result
            assert len(result["sessions"]) == 1
            assert result["sessions"][0]["session_id"] == "session-1"
    
    def test_delete_session(self, test_client):
        """Test deleting a session"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            response = test_client.delete("/api/v2/sessions/test-session-123")
            
            assert response.status_code == 200
            result = response.json()
            assert result["status"] == "deleted"
            assert result["session_id"] == "test-session-123"
            
            # Verify session manager was called
            mock_manager.cleanup_session.assert_called_once_with("test-session-123")
    
    def test_health_check(self, test_client):
        """Test health check endpoint"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.list_sessions.return_value = []
            
            response = test_client.get("/api/v2/health")
            
            assert response.status_code == 200
            result = response.json()
            assert result["status"] == "healthy"
            assert result["api_version"] == "v2_mvc"
            assert "total_sessions" in result
            assert "gpu_available" in result
    
    def test_cleanup_expired_sessions(self, test_client):
        """Test cleanup maintenance endpoint"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            
            response = test_client.post("/api/v2/maintenance/cleanup")
            
            assert response.status_code == 200
            result = response.json()
            assert result["status"] == "cleanup_completed"
            
            # Verify cleanup was called
            mock_manager.cleanup_expired_sessions.assert_called_once()


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="FastAPI dependencies not available")
class TestAPIErrorHandling:
    """Test API error handling"""
    
    def test_session_not_found(self, test_client):
        """Test handling of non-existent session"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.get_session_state.side_effect = ValueError("Session not found")
            
            response = test_client.get("/api/v2/sessions/nonexistent/state")
            
            assert response.status_code == 404
            result = response.json()
            assert "Session not found" in result["detail"]
    
    def test_invalid_edit_data(self, test_client):
        """Test handling of invalid edit data"""
        # Test with missing required fields
        response = test_client.post(
            "/api/v2/sessions/test-session-123/edit",
            json={"start_token_idx": 1}  # Missing end_token_idx and new_text
        )
        
        assert response.status_code == 422  # Validation error
        result = response.json()
        assert "detail" in result
    
    def test_server_error_handling(self, test_client):
        """Test handling of server errors"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.get_session_state.side_effect = Exception("Internal server error")
            
            response = test_client.get("/api/v2/sessions/test-session-123/state")
            
            assert response.status_code == 500
            result = response.json()
            assert "Internal server error" in result["detail"]
    
    def test_cannot_undo_error(self, test_client):
        """Test handling when undo is not possible"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.undo.side_effect = ValueError("Cannot undo: already at the first version")
            
            response = test_client.post("/api/v2/sessions/test-session-123/undo")
            
            assert response.status_code == 400
            result = response.json()
            assert "Cannot undo" in result["detail"]
    
    def test_cannot_redo_error(self, test_client):
        """Test handling when redo is not possible"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.redo.side_effect = ValueError("Cannot redo: already at the latest version")
            
            response = test_client.post("/api/v2/sessions/test-session-123/redo")
            
            assert response.status_code == 400
            result = response.json()
            assert "Cannot redo" in result["detail"]
    
    def test_invalid_version_index(self, test_client):
        """Test handling of invalid version index"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.restore_version.side_effect = ValueError("Version index 10 out of range")
            
            response = test_client.post("/api/v2/sessions/test-session-123/restore/10")
            
            assert response.status_code == 400
            result = response.json()
            assert "out of range" in result["detail"]


@pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="FastAPI dependencies not available")
class TestDeviceHandling:
    """Test device selection in API"""
    
    def test_cpu_device_selection(self, test_client, mock_audio_bytes):
        """Test selecting CPU device"""
        with patch('src.api_mvc.get_session_manager') as mock_sm, \
             patch('torch.cuda.is_available', return_value=False):
            
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.create_session.return_value = "test-session-123"
            
            files = {"audio": ("test.wav", io.BytesIO(mock_audio_bytes), "audio/wav")}
            data = {"device": "cuda"}  # Request CUDA but should fall back to CPU
            
            response = test_client.post("/api/v2/sessions", files=files, data=data)
            
            assert response.status_code == 200
            # Verify session was created with CPU device
            mock_manager.create_session.assert_called_once()
            call_args = mock_manager.create_session.call_args
            assert call_args.kwargs["device"] == "cpu"
    
    def test_default_device_cpu(self, test_client, mock_audio_bytes):
        """Test default device is CPU"""
        with patch('src.api_mvc.get_session_manager') as mock_sm:
            mock_manager = Mock()
            mock_sm.return_value = mock_manager
            mock_manager.create_session.return_value = "test-session-123"
            
            files = {"audio": ("test.wav", io.BytesIO(mock_audio_bytes), "audio/wav")}
            # Don't specify device
            
            response = test_client.post("/api/v2/sessions", files=files)
            
            assert response.status_code == 200
            # Verify session was created with default CPU device
            mock_manager.create_session.assert_called_once()
            call_args = mock_manager.create_session.call_args
            assert call_args.kwargs["device"] == "cpu"