from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import uuid
from typing import Optional
import logging
import time

# Import your voice inpainting function
from src.main import voice_inpainting

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

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
os.makedirs("data/temp", exist_ok=True)


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
