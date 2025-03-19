import streamlit as st

from src.main import voice_inpainting


st.set_page_config(
    page_title="Voice Inpainting",
    page_icon="🗣️",
)
st.title("Voice Inpainting")
st.text("Demo for prompt-based voice message editing.")

# Conditional rendering based on the choice
audio_choice = st.radio(
    "Choose how you want to provide the audio:",
    ("Record a voice message", "Upload a WAV file"),
)
uploaded_file, record_audio = None, None
file_path = "data/input.wav"

if audio_choice == "Upload a WAV file":
    uploaded_file = st.file_uploader("Upload a WAV file", type=["wav"])

    if uploaded_file is not None:
        with open(file_path, "wb") as f:
            f.write(uploaded_file.read())
        st.audio(file_path, format="audio/wav")
    else:
        st.warning("Please upload a WAV file.")

elif audio_choice == "Record a voice message":
    record_audio = st.audio_input("Record a voice message")

    if record_audio is not None:
        with open(file_path, "wb") as f:
            f.write(record_audio.getvalue())
    else:
        st.warning("Please record a voice message.")

# Ensure the file is saved and allow the user to preview it
if uploaded_file is not None or record_audio is not None:
    edit_prompt = st.text_area("Enter the edit prompt for the audio")

    if edit_prompt:
        try:
            with st.spinner("Processing your audio..."):
                # Find section to edit and generate the edited audio
                voice_inpainting(edit_prompt, file_path)

            st.success("Audio processing complete!")
            st.audio("data/output.wav", format="audio/wav")

        except Exception as e:
            st.error(f"Error processing audio: {e}")
