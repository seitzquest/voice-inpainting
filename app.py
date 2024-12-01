import streamlit as st
import whisper
import numpy as np
import wave
import ffmpeg
import matplotlib.pyplot as plt
from io import BytesIO

# Function to transcribe audio with Whisper and get word timestamps
def transcribe_audio(audio_file):
    model = whisper.load_model("base", device="cpu")  # Use MPS for Apple Silicon
    result = model.transcribe(audio_file, word_timestamps=True)  # Enable word-level timestamps
    return result['text'], result['segments']  # Segments include timestamps and word-level timestamps

# Function to convert audio file to WAV using FFmpeg
def convert_to_wav(audio_file, output_path="converted_audio.wav"):
    ffmpeg.input(audio_file).output(output_path, overwrite_output=True).run()
    return output_path

# Function to load the waveform from audio file
def load_waveform(audio_file):
    # Convert non-WAV files to WAV using FFmpeg and load waveform data
    if not audio_file.endswith(".wav"):
        audio_file = convert_to_wav(audio_file)
    
    with wave.open(audio_file, 'r') as wav:
        n_frames = wav.getnframes()
        framerate = wav.getframerate()
        duration = n_frames / float(framerate)
        audio = np.frombuffer(wav.readframes(n_frames), dtype=np.int16)
        timespace = np.linspace(0, duration, num=n_frames)
    
    return timespace, audio

# Function to display audio waveform with highlights
def plot_waveform_with_segments(timespace, audio, highlight_start=None, highlight_end=None):
    plt.figure(figsize=(12, 4))
    plt.plot(timespace, audio, color='black')
    
    plt.axvspan(highlight_start, highlight_end, color='blue', alpha=0.6)
    
    plt.xlabel("Time (s)")
    plt.ylabel("Amplitude")
    plt.title("Audio Waveform with Highlights")
    st.pyplot(plt)

# Main Streamlit application
def main():
    st.title("Whisper Transcription with Audio Alignment")
    
    # Upload audio file
    audio_file = st.file_uploader("Upload an Audio File", type=["wav", "mp3", "ogg"])
    
    if audio_file is not None:
        st.audio(audio_file)  # Display audio player
        
        # Transcribe audio and get segments with timestamps
        text, segments = transcribe_audio(audio_file.name)
        
        # Convert full transcription to a list of words with corresponding timestamps
        words = []
        for segment in segments:
            for word_info in segment['words']:
                words.append((word_info['word'], word_info['start'], word_info['end']))
        
        # Store transcription in session state for reusability
        st.session_state["transcription"] = text
        
        # Display transcription in a text_area
        st.text_area("Transcription", value=text, height=200)

        # User input for the start and end words
        start_word = st.selectbox("Select Start Word", [word[0] for word in words])
        end_word = st.selectbox("Select End Word", [word[0] for word in words])
        
        highlight_start, highlight_end = None, None
        
        # Find the selected start word's corresponding start time
        for word, start, end in words:
            if word == start_word:
                highlight_start = start
                break
        
        # Find the selected end word's corresponding end time
        for word, start, end in words:
            if word == end_word:
                highlight_end = end
                break
        
        # Plot waveform and highlight the selected segment
        if highlight_start and highlight_end:
            timespace, audio = load_waveform(audio_file.name)
            plot_waveform_with_segments(timespace, audio, highlight_start, highlight_end)
        else:
            st.warning("Start or End word not found in transcription.")

if __name__ == "__main__":
    main()
