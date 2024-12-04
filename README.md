# Requirements
Requires a `$HF_TOKEN` environment variable with Llama access. You can request access [here](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct).


# Setup
```
poetry install
pip install git+https://github.com/openai/whisper.git 
pip install git+https://github.com/SWivid/F5-TTS.git
```

# Demo
```
streamlit run app.py
```