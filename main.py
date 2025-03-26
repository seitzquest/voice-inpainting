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
from dotenv import load_dotenv

from src.main import setup_device, voice_inpainting, voice_inpainting_multi
from src.tokenization import AudioTokenizer

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
                os.remove(file_path)
                logger.info(f"Cleaned up temporary file: {file_path}")
        except Exception as e:
            logger.error(f"Error cleaning up file {file_path}: {e}")


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

        # Tokenize the audio using the AudioTokenizer
        logger.info(
            f"Tokenizing audio to get token metadata (semantic_only={semantic_only})..."
        )
        tokenizer = AudioTokenizer(device=device)
        tokenized_audio = tokenizer.tokenize(input_path, semantic_only=semantic_only)

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
                            "text": word_info["word"],
                            "start_time": word_info["start"],
                            "end_time": word_info["end"],
                            "llama_token": tokenized_audio.llama_tokens[i]
                            if i < len(tokenized_audio.llama_tokens)
                            else None,
                        }
                    )
        else:
            # Use the original approach for RVQ tokens
            # First build a mapping of character indices to their corresponding words
            char_to_word = {}
            if tokenized_audio.word_timestamps:
                for word_info in tokenized_audio.word_timestamps:
                    word_start = tokenized_audio.text.find(word_info["word"])
                    if word_start >= 0:
                        for i in range(word_start, word_start + len(word_info["word"])):
                            char_to_word[i] = word_info

            # Map tokens to text positions and extract metadata
            for i in range(len(tokenized_audio.semantic_tokens)):
                # Check if this token index maps to a text position
                if i in tokenized_audio.token_to_text_map:
                    char_idx = tokenized_audio.token_to_text_map[i]

                    # Find the corresponding word/segment
                    word_info = char_to_word.get(char_idx)

                    if word_info:
                        tokens_metadata.append(
                            {
                                "token_idx": i,
                                "text": word_info["word"],
                                "start_time": word_info["start"],
                                "end_time": word_info["end"],
                            }
                        )

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
            }
        else:
            response_data = {
                "status": "success",
                "session_id": session_id,
                "text": tokenized_audio.text,
                "tokens": tokens_metadata,
            }

        return response_data

    except Exception as e:
        logger.error(f"Error tokenizing audio: {str(e)}")
        # Clean up any files that were created
        background_tasks.add_task(cleanup_files, [input_path])
        raise HTTPException(status_code=500, detail=f"Error tokenizing audio: {str(e)}")


@app.post("/api/process")
async def process_audio(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    prompt: str = Form(...),
    return_metadata: Optional[bool] = Form(False),
):
    # Log details about the uploaded file
    logger.info(f"Received file: {audio.filename}, Content-Type: {audio.content_type}")

    # Generate unique IDs for the input and output files
    session_id = str(uuid.uuid4())
    input_path = f"data/input/{session_id}.wav"
    output_path = f"data/output/{session_id}.wav"

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

        # Process the audio with the voice inpainting function and measure time
        start_time = time.time()
        processing_result = voice_inpainting(prompt, input_path, output_path)
        processing_time = time.time() - start_time

        # Return the processed audio file
        if not os.path.exists(output_path):
            raise HTTPException(
                status_code=500, detail="Failed to generate output audio"
            )

        # Schedule delayed cleanup of files (30 minutes TTL)
        background_tasks.add_task(delayed_cleanup, [input_path, output_path])

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
                "details": processing_result
                if isinstance(processing_result, (dict, list, str))
                else "Processing completed successfully",
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
        raise HTTPException(status_code=500, detail=f"Error processing audio: {str(e)}")


@app.post("/api/process-multi")
async def process_audio_multi(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    edit_operations: str = Form(...),
    fusion_method: Optional[str] = Form("crossfade"),
    return_metadata: Optional[bool] = Form(False),
):
    """Process audio with multiple edit operations"""
    # Log details about the uploaded file
    logger.info(f"Received file: {audio.filename}, Content-Type: {audio.content_type}")

    # Generate unique IDs for the input and output files
    session_id = str(uuid.uuid4())
    input_path = f"data/input/{session_id}.wav"
    output_path = f"data/output/{session_id}.wav"

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

        # Process the audio with the multi-edit voice inpainting function
        start_time = time.time()
        processing_result = voice_inpainting_multi(
            edit_ops, input_path, output_path, fusion_method=fusion_method
        )
        processing_time = time.time() - start_time

        # Return the processed audio file
        if not os.path.exists(output_path):
            raise HTTPException(
                status_code=500, detail="Failed to generate output audio"
            )

        # Schedule delayed cleanup of files (30 minutes TTL)
        background_tasks.add_task(delayed_cleanup, [input_path, output_path])

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
                "details": processing_result
                if isinstance(processing_result, (dict, list, str))
                else "Processing completed successfully",
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
    return {"status": "healthy"}


# Mount the static files directory AFTER defining all API routes
# This is important so the API routes take precedence
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
