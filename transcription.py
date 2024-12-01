import whisper

def transcribe_audio(audio_file):
    model = whisper.load_model("base", device="cpu")  # Use MPS for Apple Silicon
    result = model.transcribe(audio_file)
    return result['text'], result['segments']  # Segments include timestamps


x, y = transcribe_audio("/Users/philipp/Desktop/test.ogg")
print(x, y)