from typing import Tuple
import tempfile
from cached_path import cached_path
import numpy as np
import soundfile as sf
import torchaudio
from f5_tts.model import DiT
from f5_tts.infer.utils_infer import (
    load_vocoder,
    load_model,
    infer_process,
    remove_silence_for_generated_wav,
)


class F5TTS:
    """F5-TTS model for text-to-speech synthesis with reference audio
    """
    def __init__(self, ckpt_path = str(cached_path("hf://SWivid/F5-TTS/F5TTS_Base/model_1200000.safetensors"))):
        """Initialize the F5-TTS model

        Args:
            ckpt_path: Path to the model checkpoint. Defaults to str(cached_path("hf://SWivid/F5-TTS/F5TTS_Base/model_1200000.safetensors")).
        """
        self.vocoder = load_vocoder()
        
        F5TTS_model_cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4)
        self.model = load_model(DiT, F5TTS_model_cfg, ckpt_path)

    def infer(self, ref_audio, ref_text, gen_text, remove_silence=True) -> Tuple[np.ndarray, int]:
        """Infer the F5-TTS model

        Args:
            ref_audio: Path to the reference audio
            ref_text: Reference text
            gen_text: Text to generate
            remove_silence: If silence should be removed. Defaults to True.

        Returns:
            The final audio and sample rate
        """
        final_wave, final_sample_rate, _ = infer_process(
            ref_audio,
            ref_text,
            gen_text,
            self.model,
            self.vocoder,
            cross_fade_duration=0.15,
            speed=1
        )

        if remove_silence:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
                sf.write(f.name, final_wave, final_sample_rate)
                remove_silence_for_generated_wav(f.name)
                final_wave, _ = torchaudio.load(f.name)
            final_wave = final_wave.squeeze().cpu().numpy()

        return final_wave, final_sample_rate
