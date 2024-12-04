import tempfile
import soundfile as sf
import torchaudio
from cached_path import cached_path

from f5_tts.model import DiT
from f5_tts.infer.utils_infer import (
    load_vocoder,
    load_model,
    infer_process,
    remove_silence_for_generated_wav,
)

class F5TTS:
    def __init__(self, ckpt_path = str(cached_path("hf://SWivid/F5-TTS/F5TTS_Base/model_1200000.safetensors"))):
        self.vocoder = load_vocoder()
        
        F5TTS_model_cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4)
        self.model = load_model(DiT, F5TTS_model_cfg, ckpt_path)

    def infer(self, ref_audio, ref_text, gen_text, remove_silence=True):
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

        # Write the final audio to a temporary file
        return final_wave, final_sample_rate