import streamlit as st
from transcription import VoiceMessage, tts, fuse_audio, find_edit_substring

# Streamlit setup
st.title("Voice Inpainting")
st.text("A demo for prompt-based voice message editing.")

# Option to choose between upload and record
audio_choice = st.radio("Choose how you want to provide the audio:", ("Record a voice message", "Upload a WAV file"))

# Initialize file path
file_path = "input.wav"  # Default path for the audio

# Conditional rendering based on the choice
uploaded_file, record_audio = None, None
if audio_choice == "Upload a WAV file":
    uploaded_file = st.file_uploader("Upload a WAV file", type=["wav"])

    if uploaded_file is not None:
        with open(file_path, "wb") as f:
            f.write(uploaded_file.read())
        st.audio(file_path, format="audio/wav")
    else:
        st.warning("Please upload a WAV file.")

elif audio_choice == "Record a voice message":
    record_audio = st.audio_input("Record a voice message")  # Assuming this is a valid method for audio input

    if record_audio is not None:
        with open(file_path, "wb") as f:
            f.write(record_audio.getvalue())  # Save the raw audio data as a WAV file
    else:
        st.warning("Please record a voice message.")

# Ensure the file is saved and allow the user to preview it
if uploaded_file is not None or record_audio is not None:
    # Now, prompt the user to enter text for the audio edit
    edit_prompt = st.text_area("Enter the edit prompt for the audio")

    if edit_prompt:
        # Ensure the input file exists before proceeding
        try:
            # Instantiate VoiceMessage after ensuring the file is saved
            source_audio = VoiceMessage(file_path)

            # Apply the edit based on the provided prompt
            start_index, end_index, subseq_edited = find_edit_substring(source_audio, edit_prompt)

            # Use TTS to generate the edited audio based on the prompt
            tts(subseq_edited, source_audio.path, source_audio.text, "edit.wav")

            # Fuse the edited audio back into the original audio
            fuse_audio(source_audio, start_index, end_index, "edit.wav", "output.wav")

            # Display the final output audio
            st.audio("output.wav", format="audio/wav")

        except Exception as e:
            st.error(f"Error processing audio: {e}")