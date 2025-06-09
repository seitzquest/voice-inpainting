"""
Session management module for voice inpainting editor.
Implements proper MVC pattern with backend as single source of truth.
"""

import uuid
import time
import threading
from typing import Dict, Optional, Any, List
from dataclasses import dataclass, asdict
from loguru import logger
from pathlib import Path

from src.token_store import TokenStore, register_token_store, get_token_store_by_id, cleanup_token_store
from src.memory_manager import MemoryManager


@dataclass
class SessionInfo:
    """Information about a session"""
    session_id: str
    created_at: float
    last_accessed: float
    audio_duration: Optional[float] = None
    original_filename: Optional[str] = None
    current_text: str = ""
    total_versions: int = 0
    current_version_index: int = 0


class SessionManager:
    """
    Manages voice inpainting sessions with proper MVC architecture.
    Backend maintains single source of truth for all session state.
    """

    def __init__(self, session_timeout_hours: float = 24.0):
        """Initialize session manager
        
        Args:
            session_timeout_hours: How long to keep inactive sessions (hours)
        """
        self.session_timeout = session_timeout_hours * 3600  # Convert to seconds
        self.sessions: Dict[str, SessionInfo] = {}
        self._lock = threading.RLock()
        
        logger.info(f"SessionManager initialized with {session_timeout_hours}h timeout")

    def create_session(self, audio_data: bytes, filename: str = "audio.wav", device: str = "cuda") -> str:
        """Create a new session with audio data
        
        Args:
            audio_data: Raw audio bytes
            filename: Original filename
            device: Device to use for processing
            
        Returns:
            Session ID
        """
        with self._lock:
            # Create TokenStore
            token_store = TokenStore(device=device)
            
            # Initialize with audio data
            try:
                logger.info(f"Creating new session with audio file: {filename}")
                tokenized_audio = token_store.initialize_from_blob(audio_data)
                
                # Register in global registry
                session_id = register_token_store(token_store)
                
                # Create session info
                audio_duration = tokenized_audio.audio.shape[0] / tokenized_audio.sample_rate
                session_info = SessionInfo(
                    session_id=session_id,
                    created_at=time.time(),
                    last_accessed=time.time(),
                    audio_duration=audio_duration,
                    original_filename=filename,
                    current_text=tokenized_audio.text,
                    total_versions=1,
                    current_version_index=0
                )
                
                self.sessions[session_id] = session_info
                
                logger.info(f"Session {session_id} created successfully")
                logger.info(f"Audio duration: {audio_duration:.2f}s, Text: '{tokenized_audio.text[:100]}...'")
                
                return session_id
                
            except Exception as e:
                logger.error(f"Failed to create session: {e}")
                import traceback
                logger.error(f"Full traceback: {traceback.format_exc()}")
                # Clean up on failure
                try:
                    token_store.cleanup()
                except:
                    pass
                raise

    def get_session_state(self, session_id: str) -> Dict[str, Any]:
        """Get complete current state for a session
        
        Args:
            session_id: Session ID
            
        Returns:
            Complete session state including text, tokens, versions, etc.
        """
        with self._lock:
            # Update last accessed time
            if session_id in self.sessions:
                self.sessions[session_id].last_accessed = time.time()
            
            # Get TokenStore
            token_store = get_token_store_by_id(session_id)
            if not token_store:
                raise ValueError(f"Session {session_id} not found")
            
            # Get current state from TokenStore (single source of truth)
            current_state = token_store.get_current_state()
            if not current_state:
                raise ValueError(f"Session {session_id} has no current state")
            
            # Build complete state response
            state = {
                "session_id": session_id,
                "text": current_state.text,
                "tokens": self._format_tokens(current_state),
                "versions": token_store.get_versions(),
                "current_version_index": token_store.get_current_version_index(),
                "can_undo": token_store.can_undo(),
                "can_redo": token_store.can_redo(),
                "session_info": asdict(self.sessions.get(session_id, SessionInfo(session_id, 0, 0))),
                "audio_duration": current_state.audio.shape[0] / current_state.sample_rate,
                "sample_rate": current_state.sample_rate,
            }
            
            # Update session info with latest data
            if session_id in self.sessions:
                self.sessions[session_id].current_text = current_state.text
                self.sessions[session_id].total_versions = len(token_store.get_versions())
                self.sessions[session_id].current_version_index = token_store.get_current_version_index()
            
            return state

    def apply_edit(self, session_id: str, start_token_idx: int, end_token_idx: int, new_text: str) -> Dict[str, Any]:
        """Apply a text edit to the session
        
        Args:
            session_id: Session ID
            start_token_idx: Starting token index
            end_token_idx: Ending token index  
            new_text: New text to replace the token range
            
        Returns:
            Updated session state
        """
        with self._lock:
            # Get TokenStore
            token_store = get_token_store_by_id(session_id)
            if not token_store:
                raise ValueError(f"Session {session_id} not found")
            
            # Apply edit through TokenStore (single source of truth)
            logger.info(f"Applying edit to session {session_id}: [{start_token_idx}:{end_token_idx}] -> '{new_text}'")
            
            try:
                token_store.apply_edit(start_token_idx, end_token_idx, new_text)
                
                # Return updated state
                return self.get_session_state(session_id)
                
            except Exception as e:
                logger.error(f"Failed to apply edit to session {session_id}: {e}")
                raise

    def apply_multiple_edits(self, session_id: str, edit_operations: List[Dict]) -> Dict[str, Any]:
        """Apply multiple edits to the session
        
        Args:
            session_id: Session ID
            edit_operations: List of edit operation dicts
            
        Returns:
            Updated session state
        """
        with self._lock:
            # Get TokenStore
            token_store = get_token_store_by_id(session_id)
            if not token_store:
                raise ValueError(f"Session {session_id} not found")
            
            # Apply edits through TokenStore (single source of truth)
            logger.info(f"Applying {len(edit_operations)} edits to session {session_id}")
            
            try:
                token_store.apply_edit_operations(edit_operations)
                
                # Return updated state
                return self.get_session_state(session_id)
                
            except Exception as e:
                logger.error(f"Failed to apply multiple edits to session {session_id}: {e}")
                raise

    def undo(self, session_id: str) -> Dict[str, Any]:
        """Undo the last edit
        
        Args:
            session_id: Session ID
            
        Returns:
            Updated session state
        """
        with self._lock:
            # Get TokenStore
            token_store = get_token_store_by_id(session_id)
            if not token_store:
                raise ValueError(f"Session {session_id} not found")
            
            # Undo through TokenStore
            result = token_store.undo()
            if result is None:
                raise ValueError("Cannot undo: already at the first version")
            
            logger.info(f"Undone edit in session {session_id}")
            
            # Return updated state
            return self.get_session_state(session_id)

    def redo(self, session_id: str) -> Dict[str, Any]:
        """Redo the next edit
        
        Args:
            session_id: Session ID
            
        Returns:
            Updated session state
        """
        with self._lock:
            # Get TokenStore
            token_store = get_token_store_by_id(session_id)
            if not token_store:
                raise ValueError(f"Session {session_id} not found")
            
            # Redo through TokenStore
            result = token_store.redo()
            if result is None:
                raise ValueError("Cannot redo: already at the latest version")
            
            logger.info(f"Redone edit in session {session_id}")
            
            # Return updated state
            return self.get_session_state(session_id)

    def restore_version(self, session_id: str, version_index: int) -> Dict[str, Any]:
        """Restore to a specific version
        
        Args:
            session_id: Session ID
            version_index: Version index to restore
            
        Returns:
            Updated session state
        """
        with self._lock:
            # Get TokenStore
            token_store = get_token_store_by_id(session_id)
            if not token_store:
                raise ValueError(f"Session {session_id} not found")
            
            # Restore through TokenStore
            token_store.restore_version(version_index=version_index)
            
            logger.info(f"Restored session {session_id} to version {version_index}")
            
            # Return updated state
            return self.get_session_state(session_id)

    def get_audio_file(self, session_id: str) -> bytes:
        """Get current audio as WAV bytes
        
        Args:
            session_id: Session ID
            
        Returns:
            WAV audio bytes
        """
        with self._lock:
            # Get TokenStore
            token_store = get_token_store_by_id(session_id)
            if not token_store:
                raise ValueError(f"Session {session_id} not found")
            
            # Get current audio state
            current_state = token_store.get_current_state()
            if not current_state:
                raise ValueError(f"Session {session_id} has no current state")
            
            # Convert to WAV bytes
            import io
            import torchaudio
            
            buffer = io.BytesIO()
            
            # Ensure audio tensor has correct shape
            audio_tensor = current_state.audio
            if audio_tensor.dim() == 1:
                audio_tensor = audio_tensor.unsqueeze(0)
            
            # Save to buffer
            torchaudio.save(buffer, audio_tensor.cpu(), current_state.sample_rate, format="wav")
            
            return buffer.getvalue()

    def list_sessions(self) -> List[Dict[str, Any]]:
        """List all active sessions
        
        Returns:
            List of session information
        """
        with self._lock:
            sessions = []
            for session_id, session_info in self.sessions.items():
                sessions.append({
                    "session_id": session_id,
                    "created_at": session_info.created_at,
                    "last_accessed": session_info.last_accessed,
                    "audio_duration": session_info.audio_duration,
                    "original_filename": session_info.original_filename,
                    "current_text_preview": session_info.current_text[:100] + "..." if len(session_info.current_text) > 100 else session_info.current_text,
                    "total_versions": session_info.total_versions,
                    "current_version_index": session_info.current_version_index,
                })
            return sessions

    def cleanup_session(self, session_id: str):
        """Clean up a specific session
        
        Args:
            session_id: Session ID to clean up
        """
        with self._lock:
            try:
                # Clean up TokenStore
                cleanup_token_store(session_id)
                
                # Remove from sessions
                if session_id in self.sessions:
                    del self.sessions[session_id]
                
                logger.info(f"Session {session_id} cleaned up")
                
            except Exception as e:
                logger.error(f"Error cleaning up session {session_id}: {e}")

    def cleanup_expired_sessions(self):
        """Clean up expired sessions"""
        with self._lock:
            current_time = time.time()
            expired_sessions = []
            
            for session_id, session_info in self.sessions.items():
                if current_time - session_info.last_accessed > self.session_timeout:
                    expired_sessions.append(session_id)
            
            for session_id in expired_sessions:
                logger.info(f"Cleaning up expired session: {session_id}")
                self.cleanup_session(session_id)

    def _format_tokens(self, tokenized_audio) -> List[Dict[str, Any]]:
        """Format tokens for API response
        
        Args:
            tokenized_audio: TokenizedAudio object
            
        Returns:
            List of formatted token objects
        """
        tokens = []
        
        if tokenized_audio.word_timestamps:
            for i, word_info in enumerate(tokenized_audio.word_timestamps):
                token_info = {
                    "token_idx": i,
                    "text": word_info.get("text", ""),
                    "start_time": word_info.get("start", 0),
                    "end_time": word_info.get("end", 0),
                    "confidence": word_info.get("confidence", 1.0),
                }
                tokens.append(token_info)
        
        return tokens


# Global session manager instance
_session_manager = None


def get_session_manager() -> SessionManager:
    """Get the global session manager instance"""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
    return _session_manager