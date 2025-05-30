"""
Generator module for CSM model with improved memory management
"""

from dataclasses import dataclass
from typing import List, Tuple

import torch
import torchaudio
from loguru import logger
from src.models import Model, ModelArgs
from src.watermarking import CSM_1B_GH_WATERMARK, load_watermarker, watermark
from tokenizers.processors import TemplateProcessing
from transformers import AutoTokenizer

from src.mimi_tokenizer import MimiTokenizer
from src.memory_manager import MemoryManager


@dataclass
class Segment:
    speaker: int
    text: str
    # (num_samples,), sample_rate = 24_000
    audio: torch.Tensor


def load_llama3_tokenizer():
    """
    https://github.com/huggingface/transformers/issues/22794#issuecomment-2092623992
    """
    tokenizer_name = "meta-llama/Llama-3.2-1B"
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)
    bos = tokenizer.bos_token
    eos = tokenizer.eos_token
    tokenizer._tokenizer.post_processor = TemplateProcessing(
        single=f"{bos}:0 $A:0 {eos}:0",
        pair=f"{bos}:0 $A:0 {eos}:0 {bos}:1 $B:1 {eos}:1",
        special_tokens=[
            (f"{bos}", tokenizer.bos_token_id),
            (f"{eos}", tokenizer.eos_token_id),
        ],
    )

    return tokenizer


class Generator:
    def __init__(
        self,
        model: Model,
    ):
        self._model = model
        self._model.setup_caches(1)

        self._text_tokenizer = load_llama3_tokenizer()

        device = next(model.parameters()).device
        # Use MimiTokenizer for all platforms
        self._audio_tokenizer = MimiTokenizer(device=device, num_codebooks=32)

        # Lazy-load watermarker only when needed
        self._watermarker = None

        self.sample_rate = self._audio_tokenizer.sample_rate
        self.device = device

    def _load_watermarker(self):
        """Lazy-load the watermarker when needed"""
        if self._watermarker is not None:
            return self._watermarker

        # Log memory before loading
        MemoryManager.log_memory_stats("Before loading watermarker")

        logger.info("Loading watermarker model")
        self._watermarker = load_watermarker(device=self.device)

        # Log memory after loading
        MemoryManager.log_memory_stats("After loading watermarker")

        return self._watermarker

    def _unload_watermarker(self):
        """Unload the watermarker to free memory"""
        if self._watermarker is not None:
            logger.info("Unloading watermarker model")

            # Log memory before unloading
            MemoryManager.log_memory_stats("Before unloading watermarker")

            # Delete model reference
            del self._watermarker
            self._watermarker = None

            # Clear GPU memory
            MemoryManager.clear_gpu_memory()

            # Log memory after unloading
            MemoryManager.log_memory_stats("After unloading watermarker")

    def to_cpu(self):
        """Move model to CPU to free GPU memory"""
        if self._model is not None:
            logger.info("Moving generator model to CPU")
            self._model = self._model.cpu()
            return True
        return False

    def to_device(self, device=None):
        """Move model back to its original device or specified device"""
        if device is None:
            device = self.device

        if self._model is not None:
            logger.info(f"Moving generator model to {device}")
            self._model = self._model.to(device)
            return True
        return False

    def _tokenize_text_segment(
        self, text: str, speaker: int
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        frame_tokens = []
        frame_masks = []

        text_tokens = self._text_tokenizer.encode(f"[{speaker}]{text}")
        text_frame = torch.zeros(len(text_tokens), 33).long()
        text_frame_mask = torch.zeros(len(text_tokens), 33).bool()
        text_frame[:, -1] = torch.tensor(text_tokens)
        text_frame_mask[:, -1] = True

        frame_tokens.append(text_frame.to(self.device))
        frame_masks.append(text_frame_mask.to(self.device))

        return torch.cat(frame_tokens, dim=0), torch.cat(frame_masks, dim=0)

    def _tokenize_audio(self, audio: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        frame_tokens = []
        frame_masks = []

        # Move audio to device
        audio = audio.to(self.device)

        # The MLX tokenizer will handle proper reshaping internally
        audio_tokens = self._audio_tokenizer.encode(audio)

        # add EOS frame
        eos_frame = torch.zeros(audio_tokens.size(0), 1).to(self.device)
        audio_tokens = torch.cat([audio_tokens, eos_frame], dim=1)

        audio_frame = torch.zeros(audio_tokens.size(1), 33).long().to(self.device)
        audio_frame_mask = torch.zeros(audio_tokens.size(1), 33).bool().to(self.device)
        audio_frame[:, :-1] = audio_tokens.transpose(0, 1)
        audio_frame_mask[:, :-1] = True

        frame_tokens.append(audio_frame)
        frame_masks.append(audio_frame_mask)

        return torch.cat(frame_tokens, dim=0), torch.cat(frame_masks, dim=0)

    def _tokenize_segment(self, segment: Segment) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Returns:
            (seq_len, 33), (seq_len, 33)
        """
        text_tokens, text_masks = self._tokenize_text_segment(
            segment.text, segment.speaker
        )
        audio_tokens, audio_masks = self._tokenize_audio(segment.audio)

        return torch.cat([text_tokens, audio_tokens], dim=0), torch.cat(
            [text_masks, audio_masks], dim=0
        )

    @torch.inference_mode()
    def generate(
        self,
        text: str,
        speaker: int,
        context: List[Segment],
        max_audio_length_ms: float = 90_000,
        temperature: float = 0.9,
        topk: int = 20,
        max_seq_len: int = 2048,
    ) -> torch.Tensor:
        # Log memory before generation
        MemoryManager.log_memory_stats("Before audio generation")

        # Make sure model is on the correct device
        if next(self._model.parameters()).device != torch.device(self.device):
            self.to_device()

        self._model.reset_caches()

        max_audio_frames = int(max_audio_length_ms / 80)
        tokens, tokens_mask = [], []
        for segment in context:
            segment_tokens, segment_tokens_mask = self._tokenize_segment(segment)
            tokens.append(segment_tokens)
            tokens_mask.append(segment_tokens_mask)

        gen_segment_tokens, gen_segment_tokens_mask = self._tokenize_text_segment(
            text, speaker
        )
        tokens.append(gen_segment_tokens)
        tokens_mask.append(gen_segment_tokens_mask)

        prompt_tokens = torch.cat(tokens, dim=0).long().to(self.device)
        prompt_tokens_mask = torch.cat(tokens_mask, dim=0).bool().to(self.device)

        samples = []
        # These unsqueeze operations are necessary for the model input format
        curr_tokens = prompt_tokens.unsqueeze(0)
        curr_tokens_mask = prompt_tokens_mask.unsqueeze(0)
        curr_pos = (
            torch.arange(0, prompt_tokens.size(0)).unsqueeze(0).long().to(self.device)
        )

        max_seq_len = max_seq_len - max_audio_frames
        if curr_tokens.size(1) >= max_seq_len:
            raise ValueError(
                f"Inputs too long, must be below max_seq_len - max_audio_frames: {max_seq_len}"
            )

        for _ in range(max_audio_frames):
            sample = self._model.generate_frame(
                curr_tokens, curr_tokens_mask, curr_pos, temperature, topk
            )
            if torch.all(sample == 0):
                break  # eos

            samples.append(sample)

            curr_tokens = torch.cat(
                [sample, torch.zeros(1, 1).long().to(self.device)], dim=1
            ).unsqueeze(1)
            curr_tokens_mask = torch.cat(
                [
                    torch.ones_like(sample).bool(),
                    torch.zeros(1, 1).bool().to(self.device),
                ],
                dim=1,
            ).unsqueeze(1)
            curr_pos = curr_pos[:, -1:] + 1

        # Use MimiTokenizer's decode method without unnecessary reshaping
        audio = self._audio_tokenizer.decode(torch.stack(samples).permute(1, 2, 0))

        # Log memory after generation
        MemoryManager.log_memory_stats("After audio generation")

        # This applies an imperceptible watermark to identify audio as AI-generated.
        # Watermarking ensures transparency, dissuades misuse, and enables traceability.
        # Please be a responsible AI citizen and keep the watermarking in place.
        # If using CSM 1B in another application, use your own private key and keep it secret.

        # Lazy-load watermarker
        watermarker = self._load_watermarker()

        audio, wm_sample_rate = watermark(
            watermarker, audio, self.sample_rate, CSM_1B_GH_WATERMARK
        )

        # Unload watermarker to free memory
        self._unload_watermarker()

        audio = torchaudio.functional.resample(
            audio, orig_freq=wm_sample_rate, new_freq=self.sample_rate
        )

        return audio


def load_csm_1b(ckpt_path: str = "ckpt.pt", device: str = "cuda") -> Generator:
    # Log memory before loading
    MemoryManager.log_memory_stats("Before loading CSM model")

    model_args = ModelArgs(
        backbone_flavor="llama-1B",
        decoder_flavor="llama-100M",
        text_vocab_size=128256,
        audio_vocab_size=2051,
        audio_num_codebooks=32,
    )

    # Try loading with lower precision to reduce memory usage
    try:
        logger.info("Loading CSM model with bfloat16 precision")
        model = Model(model_args).to(device=device, dtype=torch.bfloat16)
        state_dict = torch.load(ckpt_path)
        model.load_state_dict(state_dict)
    except Exception as e:
        logger.warning(f"Failed to load with bfloat16: {e}, falling back to default")
        model = Model(model_args).to(device=device)
        state_dict = torch.load(ckpt_path)
        model.load_state_dict(state_dict)

    generator = Generator(model)

    # Log memory after loading
    MemoryManager.log_memory_stats("After loading CSM model")

    return generator
