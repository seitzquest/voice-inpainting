# 🗣️ Voice Inpainting
Edit voice messages based on prompts by orchestrating Whisper for transcription, LLaMA 3 8B Instruct for edit detection, and F5-TTS for audio generation.

![Architecture diagram](./architecture_diagram.svg)

## Setup
The demo requires a access to the LLaMA 3 8B Instruct repository (can be requested on [HuggingFace](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct)).

We use pip and poetry for package management:
```
pip install pip poetry wheel setuptools -U
poetry install
poetry shell
pip install git+https://github.com/openai/whisper.git 
pip install git+https://github.com/SWivid/F5-TTS.git
```

## Run
```
poetry run demo
```

# Architecture Diagram
The [architecture diagram](./architecture_diagram.svg) is defined using [D2](https://github.com/terrastruct/d2). Code to render the diagram:
```
d2 --watch architecture_diagram.d2 architecture_diagram.svg
```