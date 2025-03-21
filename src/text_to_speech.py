from typing import Tuple
import tempfile
from cached_path import cached_path
import numpy as np
import soundfile as sf
import torchaudio
import torch
from f5_tts.model import DiT
from f5_tts.infer.utils_infer import (
    load_vocoder,
    load_model,
    infer_process,
    remove_silence_for_generated_wav,
)


class F5TTS:
    """F5-TTS model for text-to-speech synthesis with reference audio"""

    def __init__(
        self,
        ckpt_path=str(
            cached_path("hf://SWivid/F5-TTS/F5TTS_v1_Base/model_1250000.safetensors")
        ),
        target_sample_rate=24000,  # Set model's expected sample rate
    ):
        """Initialize the F5-TTS model

        Args:
            ckpt_path: Path to the model checkpoint. Defaults to str(cached_path("hf://SWivid/F5-TTS/F5TTS_Base/model_1200000.safetensors")).
            target_sample_rate: The sample rate expected by the model. Defaults to 24000 (24kHz).
        """
        self.vocoder = load_vocoder(vocoder_name="vocos")
        self.target_sample_rate = target_sample_rate

        F5TTS_model_cfg = dict(
            dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4
        )
        self.model = load_model(DiT, F5TTS_model_cfg, ckpt_path)

    def _resample_if_needed(self, audio_path):
        """Resample audio if its sample rate doesn't match the target"""
        try:
            info = torchaudio.info(audio_path)
            if info.sample_rate != self.target_sample_rate:
                print(
                    f"Resampling audio from {info.sample_rate}Hz to {self.target_sample_rate}Hz"
                )

                # Load audio
                waveform, original_sr = torchaudio.load(audio_path)

                # Resample
                resampler = torchaudio.transforms.Resample(
                    orig_freq=original_sr, new_freq=self.target_sample_rate
                )
                resampled_waveform = resampler(waveform)

                # Save to temporary file
                with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
                    torchaudio.save(f.name, resampled_waveform, self.target_sample_rate)
                    return f.name

            # No resampling needed
            return audio_path
        except Exception as e:
            print(f"Warning: Could not check/resample audio: {e}")
            return audio_path

    def infer(
        self, ref_audio, ref_text, gen_text, remove_silence=True
    ) -> Tuple[np.ndarray, int]:
        """Infer the F5-TTS model

        Args:
            ref_audio: Path to the reference audio
            ref_text: Reference text
            gen_text: Text to generate
            remove_silence: If silence should be removed. Defaults to True.

        Returns:
            The final audio and sample rate
        """
        # Ensure reference audio has the correct sample rate
        ref_audio_resampled = self._resample_if_needed(ref_audio)

        # Process with the potentially resampled audio
        final_wave, final_sample_rate, _ = infer_process(
            ref_audio_resampled,
            ref_text,
            gen_text,
            self.model,
            self.vocoder,
            cross_fade_duration=0.15,
            speed=1,
        )

        # Make sure the output has the correct sample rate
        if final_sample_rate != self.target_sample_rate:
            print(
                f"Warning: Output sample rate {final_sample_rate}Hz doesn't match target {self.target_sample_rate}Hz"
            )
            # Convert numpy array to tensor for resampling
            tensor_wave = torch.tensor(final_wave).unsqueeze(0)  # Add batch dimension

            resampler = torchaudio.transforms.Resample(
                orig_freq=final_sample_rate, new_freq=self.target_sample_rate
            )
            final_wave = resampler(tensor_wave).squeeze(0).numpy()
            final_sample_rate = self.target_sample_rate

        if remove_silence:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
                sf.write(f.name, final_wave, final_sample_rate)
                remove_silence_for_generated_wav(f.name)
                # Load with the explicit sample rate
                final_wave, loaded_sr = torchaudio.load(f.name, normalize=False)

                # Double-check sample rate
                if loaded_sr != final_sample_rate:
                    resampler = torchaudio.transforms.Resample(
                        orig_freq=loaded_sr, new_freq=final_sample_rate
                    )
                    final_wave = resampler(final_wave)

            final_wave = final_wave.squeeze().cpu().numpy()

        return final_wave, final_sample_rate
