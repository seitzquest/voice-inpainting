import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import uuid
from typing import Optional
from loguru import logger
import time
import torch
from dotenv import load_dotenv

from src.main import setup_device, voice_inpainting
from src.tokenization import AudioTokenizer
from src.memory_manager import MemoryManager

# Load HF token
load_dotenv()
if not os.environ.get("HF_TOKEN", False):
    logger.warning("Warning: HF_TOKEN environment variable is not set")

app = FastAPI(title="Voice Inpainting API")

# CORS middleware to allow requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create data directories if they don't exist
os.makedirs("data/input", exist_ok=True)
os.makedirs("data/output", exist_ok=True)


# Clean up temporary files
def cleanup_files(file_paths):
    for file_path in file_paths:
        try:
            if os.path.exists(file_path):
                if os.path.isdir(file_path):
                    import shutil

                    shutil.rmtree(file_path)
                    logger.info(f"Cleaned up temporary directory: {file_path}")
                else:
                    os.remove(file_path)
                    logger.info(f"Cleaned up temporary file: {file_path}")
        except Exception as e:
            logger.error(f"Error cleaning up path {file_path}: {e}")


# Delayed cleanup function for background tasks
def delayed_cleanup(file_paths, delay_seconds=1800):
    time.sleep(delay_seconds)
    cleanup_files(file_paths)


@app.post("/api/tokenize")
async def tokenize_audio(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    semantic_only: bool = Form(True),
):
    """Tokenize audio and return transcription with token metadata

    Args:
        audio: The audio file to tokenize
        semantic_only: If True, only extract semantic tokens (faster for frontend use)
    """
    # Log details about the uploaded file
    logger.info(
        f"Tokenizing file: {audio.filename}, Content-Type: {audio.content_type}, semantic_only={semantic_only}"
    )

    # Generate unique ID for the input file
    session_id = str(uuid.uuid4())
    input_path = f"data/input/{session_id}.wav"

    try:
        # Save the uploaded audio file
        content = await audio.read()
        with open(input_path, "wb") as buffer:
            buffer.write(content)

        # Reset file pointer for future reads if needed
        await audio.seek(0)

        # Verify the file was saved correctly
        if not os.path.exists(input_path):
            raise HTTPException(
                status_code=500, detail="Failed to save input audio file"
            )

        # Set up device
        device = setup_device()

        # Log memory before tokenization
        MemoryManager.log_memory_stats("API: Before tokenization")

        # Tokenize the audio using the AudioTokenizer
        logger.info(
            f"Tokenizing audio to get token metadata (semantic_only={semantic_only})..."
        )
        tokenizer = AudioTokenizer(device=device)
        tokenized_audio = tokenizer.tokenize(input_path, semantic_only=semantic_only)

        # Log memory after tokenization
        MemoryManager.log_memory_stats("API: After tokenization")

        # Extract token metadata including timestamps
        tokens_metadata = []

        if semantic_only:
            # For semantic-only mode, create metadata based on word timestamps
            if tokenized_audio.word_timestamps:
                for i, word_info in enumerate(tokenized_audio.word_timestamps):
                    # Map each word to a token index using the simplified mapping
                    tokens_metadata.append(
                        {
                            "token_idx": i,
                            "text": word_info["text"],
                            "start_time": word_info["start"],
                            "end_time": word_info["end"],
                            "confidence": word_info.get("confidence", 1.0),
                            "llama_token": tokenized_audio.llama_tokens[i]
                            if i < len(tokenized_audio.llama_tokens or [])
                            else None,
                        }
                    )
        else:
            # Use the original approach for RVQ tokens
            # First build a mapping of character indices to their corresponding words
            char_to_word = {}
            if tokenized_audio.word_timestamps:
                for word_info in tokenized_audio.word_timestamps:
                    word = word_info["text"]
                    word_start = tokenized_audio.text.find(word)
                    if word_start >= 0:
                        for i in range(word_start, word_start + len(word)):
                            char_to_word[i] = word_info

            # Map tokens to text positions and extract metadata
            for i in range(len(tokenized_audio.semantic_tokens or [])):
                # Check if this token index maps to a text position
                if i in tokenized_audio.token_to_text_map:
                    char_idx = tokenized_audio.token_to_text_map[i]

                    # Find the corresponding word/segment
                    word_info = char_to_word.get(char_idx)

                    if word_info:
                        tokens_metadata.append(
                            {
                                "token_idx": i,
                                "text": word_info["text"],
                                "start_time": word_info["start"],
                                "end_time": word_info["end"],
                                "confidence": word_info.get("confidence", 1.0),
                            }
                        )

        # Clean up memory
        del tokenizer

        # Free GPU memory
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("API: After cleanup")

        # Schedule delayed cleanup of files (30 minutes TTL)
        background_tasks.add_task(delayed_cleanup, [input_path])

        # Prepare response based on mode
        if semantic_only:
            response_data = {
                "status": "success",
                "session_id": session_id,
                "text": tokenized_audio.text,
                "tokens": tokens_metadata,
                "llama_tokens": tokenized_audio.llama_tokens,
                "semantic_to_rvq_map": tokenized_audio.semantic_to_rvq_map,
            }
        else:
            response_data = {
                "status": "success",
                "session_id": session_id,
                "text": tokenized_audio.text,
                "tokens": tokens_metadata,
                "semantic_to_rvq_map": tokenized_audio.semantic_to_rvq_map,
            }

        # Final cleanup of local variable references
        del tokenized_audio

        return response_data

    except Exception as e:
        logger.error(f"Error tokenizing audio: {str(e)}")
        # Clean up any files that were created
        background_tasks.add_task(cleanup_files, [input_path])
        # Make sure GPU memory is freed in case of errors
        MemoryManager.clear_gpu_memory()
        raise HTTPException(status_code=500, detail=f"Error tokenizing audio: {str(e)}")


@app.post("/api/process")
async def process_audio(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    prompt: str = Form(...),
    temperature: Optional[float] = Form(0.7),
    topk: Optional[int] = Form(25),
    return_metadata: Optional[bool] = Form(False),
):
    """Process audio with a single edit prompt"""
    # Log details about the uploaded file
    logger.info(f"Received file: {audio.filename}, Content-Type: {audio.content_type}")

    # Generate unique IDs for the input and output files
    session_id = str(uuid.uuid4())
    input_path = f"data/input/{session_id}.wav"
    output_path = f"data/output/{session_id}.wav"
    debug_dir = f"data/debug/{session_id}"

    logger.info(f"Processing audio with prompt: {prompt}")

    try:
        # Save the uploaded audio file
        content = await audio.read()
        with open(input_path, "wb") as buffer:
            buffer.write(content)

        # Reset file pointer for future reads if needed
        await audio.seek(0)

        # Verify the file was saved correctly
        if not os.path.exists(input_path):
            raise HTTPException(
                status_code=500, detail="Failed to save input audio file"
            )

        file_size = os.path.getsize(input_path)
        logger.info(f"Saved input file to {input_path}, size: {file_size} bytes")

        # Clear GPU memory before processing
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("API: Before voice inpainting")

        # Process the audio with the improved voice inpainting function and measure time
        start_time = time.time()
        processing_result = voice_inpainting(
            input_file=input_path,
            output_file=output_path,
            edits=prompt,  # Single edit prompt
            debug=True,
            debug_dir=debug_dir,
            temperature=temperature,
            topk=topk,
        )
        processing_time = time.time() - start_time

        # Log memory after processing
        MemoryManager.log_memory_stats("API: After voice inpainting")

        # Make sure GPU memory is freed after processing
        MemoryManager.clear_gpu_memory()

        # Return the processed audio file
        if not os.path.exists(output_path):
            raise HTTPException(
                status_code=500, detail="Failed to generate output audio"
            )

        # Schedule delayed cleanup of files (30 minutes TTL)
        background_tasks.add_task(delayed_cleanup, [input_path, output_path])
        # Also schedule cleanup for debug directory, but with longer delay
        if os.path.exists(debug_dir):
            background_tasks.add_task(delayed_cleanup, [debug_dir], 3600)  # 1 hour

        # Create paths for client to access files
        output_url = f"/api/audio/{session_id}/output.wav"
        input_url = f"/api/audio/{session_id}/input.wav"

        # Choose response type based on parameter
        if return_metadata:
            # Return JSON with metadata and URL to download the processed file
            response_data = {
                "status": "success",
                "input_url": input_url,
                "output_url": output_url,
                "processing_time": processing_time,
                "prompt": prompt,
                "tokenization": processing_result.get("tokenization", {})
                if isinstance(processing_result, dict)
                else {},
                "generated_regions": processing_result.get("generated_regions", [])
                if isinstance(processing_result, dict)
                else [],
                "edit_operations": processing_result.get("edit_operations", [])
                if isinstance(processing_result, dict)
                else [],
            }
            return response_data
        else:
            # Return the raw audio file
            return FileResponse(
                output_path, media_type="audio/wav", filename="processed_audio.wav"
            )

    except Exception as e:
        logger.error(f"Error processing audio: {str(e)}")
        # Clean up any files that were created
        background_tasks.add_task(cleanup_files, [input_path, output_path])
        # Make sure GPU memory is freed in case of errors
        MemoryManager.clear_gpu_memory()
        raise HTTPException(status_code=500, detail=f"Error processing audio: {str(e)}")


@app.post("/api/process-multi")
async def process_audio_multi(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    edit_operations: str = Form(...),
    temperature: Optional[float] = Form(0.7),
    topk: Optional[int] = Form(25),
    return_metadata: Optional[bool] = Form(False),
):
    """Process audio with multiple edit operations"""
    # Log details about the uploaded file
    logger.info(f"Received file: {audio.filename}, Content-Type: {audio.content_type}")

    # Generate unique IDs for the input and output files
    session_id = str(uuid.uuid4())
    input_path = f"data/input/{session_id}.wav"
    output_path = f"data/output/{session_id}.wav"
    debug_dir = f"data/debug/{session_id}"

    # Parse edit operations from JSON string
    try:
        edit_ops = json.loads(edit_operations)
        logger.info(f"Processing audio with {len(edit_ops)} edit operations")
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400, detail=f"Invalid edit operations format: {str(e)}"
        )

    try:
        # Save the uploaded audio file
        content = await audio.read()
        with open(input_path, "wb") as buffer:
            buffer.write(content)

        # Reset file pointer for future reads if needed
        await audio.seek(0)

        # Verify the file was saved correctly
        if not os.path.exists(input_path):
            raise HTTPException(
                status_code=500, detail="Failed to save input audio file"
            )

        file_size = os.path.getsize(input_path)
        logger.info(f"Saved input file to {input_path}, size: {file_size} bytes")

        # Clear GPU memory before tokenization
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("API: Before tokenization")

        # First tokenize the audio to get the mapping between semantic and RVQ tokens
        device = setup_device()
        tokenizer = AudioTokenizer(device=device)
        tokenized_audio = tokenizer.tokenize(input_path)

        MemoryManager.log_memory_stats("API: After tokenization")

        # Sort edit operations by their start_token_idx to process from left to right
        sorted_edits = sorted(edit_ops, key=lambda op: op["start_token_idx"])

        # Use the consistent semantic_to_rvq_map from tokenized_audio
        semantic_to_rvq_map = tokenized_audio.semantic_to_rvq_map or {}

        # If no mapping is available (should not happen), log a warning
        if not semantic_to_rvq_map:
            logger.warning(
                "No semantic_to_rvq_map available in tokenized_audio. Using identity mapping as fallback."
            )
            # Create identity mapping as fallback
            for token_idx in range(len(tokenized_audio.word_timestamps or [])):
                semantic_to_rvq_map[token_idx] = token_idx

        # Update each edit operation with the correctly translated token indices
        translated_edit_ops = []
        for i, edit_dict in enumerate(sorted_edits):
            # Get the semantic token indices from the frontend
            start_idx = edit_dict["start_token_idx"]
            end_idx = edit_dict["end_token_idx"]

            # Translate to RVQ token indices using our mapping
            translated_start = semantic_to_rvq_map.get(start_idx, start_idx)
            translated_end = semantic_to_rvq_map.get(end_idx, end_idx)

            # Ensure original_text includes all necessary spaces
            original_text = edit_dict["original_text"]

            # Handle whitespace preservation in the original text
            # (This helps with the frontend issue)
            if i > 0 and i < len(sorted_edits) - 1:
                prev_edit = sorted_edits[i - 1]
                next_edit = sorted_edits[i + 1]

                # Check if we need to add space before this edit
                if (
                    not prev_edit["original_text"].endswith(" ")
                    and not original_text.startswith(" ")
                    and not prev_edit["original_text"].endswith(
                        (".", ",", "!", "?", ";", ":")
                    )
                ):
                    original_text = " " + original_text

                # Check if we need to add space after this edit
                if (
                    not original_text.endswith(" ")
                    and not next_edit["original_text"].startswith(" ")
                    and not original_text.endswith((".", ",", "!", "?", ";", ":"))
                ):
                    original_text = original_text + " "

            # Create a new operation with translated indices
            translated_op = {
                "original_text": original_text,
                "edited_text": edit_dict["edited_text"],
                "start_token_idx": translated_start,
                "end_token_idx": translated_end,
            }
            translated_edit_ops.append(translated_op)

            logger.info(
                f"Translated token indices: {start_idx}->{translated_start}, {end_idx}->{translated_end}"
            )

        # Clean up tokenizer and tokenized_audio to free memory before inpainting
        del tokenizer
        del tokenized_audio
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("API: Before inpainting (multi-edit)")

        # Process the audio with the new integrated voice inpainting function
        start_time = time.time()
        processing_result = voice_inpainting(
            input_file=input_path,
            output_file=output_path,
            edits=translated_edit_ops,  # Use translated operations
            debug=True,
            debug_dir=debug_dir,
            temperature=temperature,
            topk=topk,
        )
        processing_time = time.time() - start_time

        MemoryManager.log_memory_stats("API: After inpainting (multi-edit)")
        MemoryManager.clear_gpu_memory()

        # Return the processed audio file
        if not os.path.exists(output_path):
            raise HTTPException(
                status_code=500, detail="Failed to generate output audio"
            )

        # Schedule delayed cleanup of files (30 minutes TTL)
        background_tasks.add_task(delayed_cleanup, [input_path, output_path])
        # Also schedule cleanup for debug directory, but with longer delay
        if os.path.exists(debug_dir):
            background_tasks.add_task(delayed_cleanup, [debug_dir], 3600)  # 1 hour

        # Create paths for client to access files
        output_url = f"/api/audio/{session_id}/output.wav"
        input_url = f"/api/audio/{session_id}/input.wav"

        # Choose response type based on parameter
        if return_metadata:
            # Return JSON with metadata and URL to download the processed file
            response_data = {
                "status": "success",
                "input_url": input_url,
                "output_url": output_url,
                "processing_time": processing_time,
                "edit_operations": edit_ops,
                "tokenization": processing_result.get("tokenization", {})
                if isinstance(processing_result, dict)
                else {},
                "generated_regions": processing_result.get("generated_regions", [])
                if isinstance(processing_result, dict)
                else [],
                "details": processing_result,
            }
            return response_data
        else:
            # Return the raw audio file
            return FileResponse(
                output_path, media_type="audio/wav", filename="processed_audio.wav"
            )

    except Exception as e:
        logger.error(f"Error processing audio: {str(e)}")
        # Clean up any files that were created
        background_tasks.add_task(cleanup_files, [input_path, output_path])
        # Make sure GPU memory is freed in case of errors
        MemoryManager.clear_gpu_memory()
        raise HTTPException(status_code=500, detail=f"Error processing audio: {str(e)}")


@app.get("/api/audio/{session_id}/{filename}")
async def get_audio_file(session_id: str, filename: str):
    """Serve audio files by session ID"""
    if filename == "input.wav":
        file_path = f"data/input/{session_id}.wav"
    elif filename == "output.wav":
        file_path = f"data/output/{session_id}.wav"
    else:
        raise HTTPException(status_code=404, detail="File not found")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, media_type="audio/wav", filename=filename)


@app.get("/api/health")
async def health_check():
    """Health check endpoint with memory information"""
    status = {"status": "healthy", "gpu_available": torch.cuda.is_available()}

    # Add memory information if GPU is available
    if torch.cuda.is_available():
        try:
            used_memory = torch.cuda.memory_allocated() / (1024**3)
            total_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            status["gpu_memory"] = {
                "used_gb": round(used_memory, 2),
                "total_gb": round(total_memory, 2),
                "used_percent": round((used_memory / total_memory) * 100, 2),
            }
        except Exception as e:
            status["gpu_memory_error"] = str(e)

    return status


@app.get("/api/memory")
async def memory_stats():
    """Get current memory statistics"""
    if not torch.cuda.is_available():
        return {"status": "gpu_not_available"}

    try:
        # Clean up GPU memory first
        MemoryManager.clear_gpu_memory()

        # Get memory statistics
        used_memory = torch.cuda.memory_allocated() / (1024**3)
        reserved_memory = torch.cuda.memory_reserved() / (1024**3)
        total_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)

        return {
            "status": "success",
            "memory_gb": {
                "used": round(used_memory, 2),
                "reserved": round(reserved_memory, 2),
                "total": round(total_memory, 2),
                "available": round(total_memory - reserved_memory, 2),
                "used_percent": round((used_memory / total_memory) * 100, 2),
            },
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# Mount the static files directory AFTER defining all API routes
# This is important so the API routes take precedence
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
