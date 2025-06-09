"""
MVC API endpoints for voice inpainting editor.
Backend maintains single source of truth, frontend is pure view layer.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import time
from loguru import logger

from src.session_manager import get_session_manager
from src.memory_manager import MemoryManager


# Pydantic models for request/response validation
class EditOperation(BaseModel):
    start_token_idx: int
    end_token_idx: int
    new_text: str


class MultipleEditRequest(BaseModel):
    edit_operations: List[Dict[str, Any]]


class SessionStateResponse(BaseModel):
    session_id: str
    text: str
    tokens: List[Dict[str, Any]]
    versions: List[Dict[str, Any]]
    current_version_index: int
    can_undo: bool
    can_redo: bool
    session_info: Dict[str, Any]
    audio_duration: float
    sample_rate: int


# Create router for MVC endpoints
router = APIRouter(prefix="/api/v2", tags=["MVC Voice Inpainting"])


@router.post("/sessions", response_model=Dict[str, str])
async def create_session(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    device: str = "cpu"  # Default to CPU for compatibility
):
    """Create a new voice inpainting session
    
    Creates a new session with uploaded audio.
    Backend becomes the single source of truth for all session state.
    """
    logger.info(f"Creating new session with audio: {audio.filename}")
    
    try:
        # Read audio data
        audio_data = await audio.read()
        
        # Clear GPU memory before processing
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("API: Before session creation")
        
        # Auto-detect device if GPU is not available
        try:
            import torch
            if device == "cuda" and not torch.cuda.is_available():
                device = "cpu"
                logger.info("CUDA not available, falling back to CPU")
        except Exception:
            device = "cpu"
            logger.info("PyTorch not properly configured, using CPU")
        
        # Create session through SessionManager
        session_manager = get_session_manager()
        session_id = session_manager.create_session(
            audio_data=audio_data,
            filename=audio.filename or "audio.wav",
            device=device
        )
        
        # Log memory after session creation
        MemoryManager.log_memory_stats("API: After session creation")
        
        # Schedule cleanup of expired sessions
        background_tasks.add_task(session_manager.cleanup_expired_sessions)
        
        logger.info(f"Session {session_id} created successfully")
        
        return {"session_id": session_id, "status": "created"}
        
    except Exception as e:
        logger.error(f"Error creating session: {e}")
        MemoryManager.clear_gpu_memory()
        raise HTTPException(status_code=500, detail=f"Error creating session: {str(e)}")


@router.get("/sessions/{session_id}/state", response_model=SessionStateResponse)
async def get_session_state(session_id: str):
    """Get complete current state for a session
    
    Returns the current text, tokens, version history, and all session metadata.
    This is the single source of truth that frontend should display.
    """
    try:
        session_manager = get_session_manager()
        state = session_manager.get_session_state(session_id)
        
        return SessionStateResponse(**state)
        
    except ValueError as e:
        logger.error(f"Session error: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting session state: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting session state: {str(e)}")


@router.post("/sessions/{session_id}/edit", response_model=SessionStateResponse)
async def apply_edit(session_id: str, edit: EditOperation):
    """Apply a single text edit to the session
    
    Backend processes the edit and returns the updated complete state.
    Frontend should replace its entire state with the response.
    """
    logger.info(f"Applying edit to session {session_id}: [{edit.start_token_idx}:{edit.end_token_idx}] -> '{edit.new_text}'")
    
    try:
        # Clear GPU memory before processing
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("API: Before edit")
        
        session_manager = get_session_manager()
        updated_state = session_manager.apply_edit(
            session_id=session_id,
            start_token_idx=edit.start_token_idx,
            end_token_idx=edit.end_token_idx,
            new_text=edit.new_text
        )
        
        # Log memory after edit
        MemoryManager.log_memory_stats("API: After edit")
        MemoryManager.clear_gpu_memory()
        
        logger.info(f"Edit applied successfully to session {session_id}")
        
        return SessionStateResponse(**updated_state)
        
    except ValueError as e:
        logger.error(f"Session error: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error applying edit: {e}")
        MemoryManager.clear_gpu_memory()
        raise HTTPException(status_code=500, detail=f"Error applying edit: {str(e)}")


@router.post("/sessions/{session_id}/multi-edit", response_model=SessionStateResponse)
async def apply_multiple_edits(session_id: str, request: MultipleEditRequest):
    """Apply multiple edits to the session in one operation
    
    Backend processes all edits and returns the updated complete state.
    Frontend should replace its entire state with the response.
    """
    logger.info(f"Applying {len(request.edit_operations)} edits to session {session_id}")
    
    try:
        # Clear GPU memory before processing
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("API: Before multi-edit")
        
        session_manager = get_session_manager()
        updated_state = session_manager.apply_multiple_edits(
            session_id=session_id,
            edit_operations=request.edit_operations
        )
        
        # Log memory after edits
        MemoryManager.log_memory_stats("API: After multi-edit")
        MemoryManager.clear_gpu_memory()
        
        logger.info(f"Multiple edits applied successfully to session {session_id}")
        
        return SessionStateResponse(**updated_state)
        
    except ValueError as e:
        logger.error(f"Session error: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error applying multiple edits: {e}")
        MemoryManager.clear_gpu_memory()
        raise HTTPException(status_code=500, detail=f"Error applying multiple edits: {str(e)}")


@router.post("/sessions/{session_id}/undo", response_model=SessionStateResponse)
async def undo_edit(session_id: str):
    """Undo the last edit in the session
    
    Backend processes the undo and returns the updated complete state.
    Frontend should replace its entire state with the response.
    """
    logger.info(f"Undoing edit in session {session_id}")
    
    try:
        session_manager = get_session_manager()
        updated_state = session_manager.undo(session_id)
        
        logger.info(f"Edit undone successfully in session {session_id}")
        
        return SessionStateResponse(**updated_state)
        
    except ValueError as e:
        logger.error(f"Session error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error undoing edit: {e}")
        raise HTTPException(status_code=500, detail=f"Error undoing edit: {str(e)}")


@router.post("/sessions/{session_id}/redo", response_model=SessionStateResponse)
async def redo_edit(session_id: str):
    """Redo the next edit in the session
    
    Backend processes the redo and returns the updated complete state.
    Frontend should replace its entire state with the response.
    """
    logger.info(f"Redoing edit in session {session_id}")
    
    try:
        session_manager = get_session_manager()
        updated_state = session_manager.redo(session_id)
        
        logger.info(f"Edit redone successfully in session {session_id}")
        
        return SessionStateResponse(**updated_state)
        
    except ValueError as e:
        logger.error(f"Session error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error redoing edit: {e}")
        raise HTTPException(status_code=500, detail=f"Error redoing edit: {str(e)}")


@router.post("/sessions/{session_id}/restore/{version_index}", response_model=SessionStateResponse)
async def restore_version(session_id: str, version_index: int):
    """Restore session to a specific version
    
    Backend processes the restoration and returns the updated complete state.
    Frontend should replace its entire state with the response.
    """
    logger.info(f"Restoring session {session_id} to version {version_index}")
    
    try:
        session_manager = get_session_manager()
        updated_state = session_manager.restore_version(session_id, version_index)
        
        logger.info(f"Session {session_id} restored to version {version_index}")
        
        return SessionStateResponse(**updated_state)
        
    except ValueError as e:
        logger.error(f"Session error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error restoring version: {e}")
        raise HTTPException(status_code=500, detail=f"Error restoring version: {str(e)}")


@router.get("/sessions/{session_id}/audio")
async def get_session_audio(session_id: str):
    """Get current audio for the session as WAV file
    
    Returns the current audio state as a downloadable WAV file.
    """
    try:
        session_manager = get_session_manager()
        audio_bytes = session_manager.get_audio_file(session_id)
        
        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename=session_{session_id}.wav"}
        )
        
    except ValueError as e:
        logger.error(f"Session error: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting session audio: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting session audio: {str(e)}")


@router.get("/sessions")
async def list_sessions():
    """List all active sessions
    
    Returns basic information about all active sessions.
    """
    try:
        session_manager = get_session_manager()
        sessions = session_manager.list_sessions()
        
        return {"sessions": sessions}
        
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        raise HTTPException(status_code=500, detail=f"Error listing sessions: {str(e)}")


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session and clean up resources
    
    Permanently removes the session and frees all associated resources.
    """
    try:
        session_manager = get_session_manager()
        session_manager.cleanup_session(session_id)
        
        logger.info(f"Session {session_id} deleted successfully")
        
        return {"status": "deleted", "session_id": session_id}
        
    except Exception as e:
        logger.error(f"Error deleting session: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting session: {str(e)}")


@router.get("/health")
async def health_check():
    """Health check with memory and session information"""
    try:
        session_manager = get_session_manager()
        sessions = session_manager.list_sessions()
        
        status = {
            "status": "healthy",
            "api_version": "v2_mvc",
            "total_sessions": len(sessions),
            "gpu_available": True
        }
        
        # Add GPU memory information if available
        try:
            import torch
            if torch.cuda.is_available():
                used_memory = torch.cuda.memory_allocated() / (1024**3)
                total_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)
                status["gpu_memory"] = {
                    "used_gb": round(used_memory, 2),
                    "total_gb": round(total_memory, 2),
                    "used_percent": round((used_memory / total_memory) * 100, 2),
                }
        except Exception:
            status["gpu_available"] = False
        
        return status
        
    except Exception as e:
        logger.error(f"Error in health check: {e}")
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")


# Cleanup endpoint for maintenance
@router.post("/maintenance/cleanup")
async def cleanup_expired_sessions():
    """Clean up expired sessions (maintenance endpoint)"""
    try:
        session_manager = get_session_manager()
        session_manager.cleanup_expired_sessions()
        
        return {"status": "cleanup_completed"}
        
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")