# 🗣️ Voice Inpainting

Edit voice messages based on prompts by orchestrating Whisper for transcription, LLaMA 3 8B Instruct for edit detection, and F5-TTS for audio generation.

![Architecture diagram](./architecture_diagram.svg)

## Setup

The demo requires a access to the LLaMA 3 8B Instruct repository (can be requested on [HuggingFace](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct)).

Install [uv](https://docs.astral.sh/uv/getting-started/installation/#standalone-installer) for package management:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
```

Setup the environment:

```bash
uv sync
```

## Run

```bash
uv run main.py
```

## Architecture Diagram

The [architecture diagram](./architecture_diagram.svg) is defined using [D2](https://github.com/terrastruct/d2). Code to render the diagram:

```bash
d2 --watch architecture_diagram.d2 architecture_diagram.svg
```
