"""
Forced Alignment with Wav2Vec2
Based on WhisperX alignment implementation by C. Max Bain
"""

import math
from dataclasses import dataclass
from typing import List, Optional

import torch
import torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
from loguru import logger

# Constants for alignment
SAMPLE_RATE = 16000  # Wav2Vec2 models expect 16kHz audio
LANGUAGES_WITHOUT_SPACES = ["ja", "zh"]

# Default alignment models for different languages
DEFAULT_ALIGN_MODELS_TORCH = {
    "en": "WAV2VEC2_ASR_BASE_960H",
    "fr": "VOXPOPULI_ASR_BASE_10K_FR",
    "de": "VOXPOPULI_ASR_BASE_10K_DE",
    "es": "VOXPOPULI_ASR_BASE_10K_ES",
    "it": "VOXPOPULI_ASR_BASE_10K_IT",
}

DEFAULT_ALIGN_MODELS_HF = {
    "ja": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "zh": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    "nl": "jonatasgrosman/wav2vec2-large-xlsr-53-dutch",
    "uk": "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm",
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
    "ar": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
    "ru": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
    # Add more languages as needed
}


@dataclass
class Point:
    """Alignment point for CTC forced alignment"""

    token_index: int
    time_index: int
    score: float


@dataclass
class Segment:
    """Segment with alignment information"""

    label: str
    start: int
    end: int
    score: float

    def __repr__(self):
        return f"{self.label}\t({self.score:4.2f}): [{self.start:5d}, {self.end:5d})"

    @property
    def length(self):
        return self.end - self.start


@dataclass
class BeamState:
    """State in beam search."""

    token_index: int  # Current token position
    time_index: int  # Current time step
    score: float  # Cumulative score
    path: List[Point]  # Path history


@dataclass
class AlignedWord:
    """A word with precise timestamp alignment"""

    word: str
    start: float
    end: float
    score: float


class AudioAligner:
    """Class for aligning transcription with audio using Wav2Vec2"""

    def __init__(self, language="en", device="cpu", model_name=None):
        """Initialize the AudioAligner with a Wav2Vec2 model

        Args:
            language: ISO language code (e.g., 'en' for English)
            device: Device to run inference on ('cpu', 'cuda', 'mps')
            model_name: Optional custom model name
        """
        self.language = language
        self.device = device

        logger.info(
            f"Loading Wav2Vec2 alignment model for language '{language}' on {device}..."
        )
        self.model, self.metadata = self._load_align_model(language, device, model_name)
        logger.info("Alignment model loaded successfully")

    def _load_align_model(
        self, language_code: str, device: str, model_name: Optional[str] = None
    ):
        """Load the Wav2Vec2 model for alignment

        Args:
            language_code: ISO language code
            device: Device to run inference on
            model_name: Optional custom model name

        Returns:
            Tuple of (model, metadata)
        """
        if model_name is None:
            # Use default model based on language
            if language_code in DEFAULT_ALIGN_MODELS_TORCH:
                model_name = DEFAULT_ALIGN_MODELS_TORCH[language_code]
            elif language_code in DEFAULT_ALIGN_MODELS_HF:
                model_name = DEFAULT_ALIGN_MODELS_HF[language_code]
            else:
                logger.warning(
                    f"No default alignment model for language '{language_code}', falling back to English"
                )
                model_name = DEFAULT_ALIGN_MODELS_TORCH["en"]
                language_code = "en"

        # Load either torchaudio or huggingface model
        if model_name in torchaudio.pipelines.__all__:
            # TorchAudio pipeline
            pipeline_type = "torchaudio"
            bundle = torchaudio.pipelines.__dict__[model_name]
            align_model = bundle.get_model().to(device)
            labels = bundle.get_labels()
            align_dictionary = {c.lower(): i for i, c in enumerate(labels)}
        else:
            # HuggingFace pipeline
            try:
                processor = Wav2Vec2Processor.from_pretrained(model_name)
                align_model = Wav2Vec2ForCTC.from_pretrained(model_name)
            except Exception as e:
                logger.error(f"Error loading model from HuggingFace: {e}")
                raise ValueError(f"Could not load alignment model '{model_name}'")

            pipeline_type = "huggingface"
            align_model = align_model.to(device)
            align_dictionary = {
                char.lower(): code
                for char, code in processor.tokenizer.get_vocab().items()
            }

        align_metadata = {
            "language": language_code,
            "dictionary": align_dictionary,
            "type": pipeline_type,
        }

        return align_model, align_metadata

    def _load_audio(self, audio_path: str) -> torch.Tensor:
        """Load and prepare audio for alignment

        Args:
            audio_path: Path to audio file

        Returns:
            Audio tensor ready for alignment
        """
        # Load audio using torchaudio and resample if needed
        waveform, sample_rate = torchaudio.load(audio_path)

        # Resample to 16kHz if needed (Wav2Vec2 expectation)
        if sample_rate != SAMPLE_RATE:
            resampler = torchaudio.transforms.Resample(
                orig_freq=sample_rate, new_freq=SAMPLE_RATE
            )
            waveform = resampler(waveform)

        # Convert to mono if stereo
        if waveform.shape[0] > 1:
            waveform = torch.mean(waveform, dim=0, keepdim=True)

        return waveform

    def _prepare_text_for_alignment(self, text: str):
        """Prepare text for alignment with Wav2Vec2

        Args:
            text: Text to prepare

        Returns:
            Tuple of (clean_text, tokens, char_to_idx_map)
        """
        model_dictionary = self.metadata["dictionary"]
        model_lang = self.metadata["language"]

        # Keep track of original character indices
        char_to_idx_map = {}
        clean_chars = []

        for i, char in enumerate(text):
            char_lower = char.lower()

            # Wav2Vec2 models use "|" character to represent spaces
            if model_lang not in LANGUAGES_WITHOUT_SPACES:
                char_lower = char_lower.replace(" ", "|")

            if char_lower in model_dictionary:
                clean_chars.append(char_lower)
                char_to_idx_map[len(clean_chars) - 1] = i

        # Convert to tokens
        clean_text = "".join(clean_chars)
        tokens = [model_dictionary.get(c, -1) for c in clean_text]

        return clean_text, tokens, char_to_idx_map

    def align_transcript(
        self, audio_path: str, transcript: str, start_time=0, end_time=None
    ):
        """Align transcript with audio

        Args:
            audio_path: Path to the audio file
            transcript: Text to align
            start_time: Start time in the audio (seconds)
            end_time: End time in the audio (seconds)

        Returns:
            List of AlignedWord objects
        """
        # Load and prepare audio
        waveform = self._load_audio(audio_path)
        audio_length = waveform.shape[1] / SAMPLE_RATE  # in seconds

        if end_time is None:
            end_time = audio_length

        # Prepare text for alignment
        clean_text, tokens, char_to_idx_map = self._prepare_text_for_alignment(
            transcript
        )

        if not tokens:
            logger.warning(f"No alignable tokens found in text: '{transcript}'")
            # Return dummy alignment with original timestamps
            return [
                AlignedWord(word=transcript, start=start_time, end=end_time, score=0.0)
            ]

        # Extract audio segment
        f1 = int(start_time * SAMPLE_RATE)
        f2 = int(end_time * SAMPLE_RATE)
        waveform_segment = waveform[:, f1:f2]

        # Handle minimum input length for Wav2Vec2
        if waveform_segment.shape[1] < 400:
            lengths = torch.tensor([waveform_segment.shape[1]]).to(self.device)
            waveform_segment = torch.nn.functional.pad(
                waveform_segment, (0, 400 - waveform_segment.shape[1])
            )
        else:
            lengths = None

        # Get emissions from model
        with torch.inference_mode():
            if self.metadata["type"] == "torchaudio":
                emissions, _ = self.model(
                    waveform_segment.to(self.device), lengths=lengths
                )
            else:  # huggingface
                emissions = self.model(waveform_segment.to(self.device)).logits

            emissions = torch.log_softmax(emissions, dim=-1)

        emission = emissions[0].cpu().detach()

        # Find blank_id for CTC
        blank_id = 0
        for char, code in self.metadata["dictionary"].items():
            if char == "[pad]" or char == "<pad>":
                blank_id = code

        # Align using trellis and beam search
        trellis = self._get_trellis(emission, tokens, blank_id)
        path = self._backtrack_beam(trellis, emission, tokens, blank_id, beam_width=4)

        if path is None:
            logger.warning(f"Alignment failed for text: '{transcript}'")
            # Return dummy alignment with original timestamps
            return [
                AlignedWord(word=transcript, start=start_time, end=end_time, score=0.0)
            ]

        # Merge repeated characters
        char_segments = self._merge_repeats(path, clean_text)

        # Calculate time ratio for mapping from frames to seconds
        duration = end_time - start_time
        ratio = duration / (trellis.size(0) - 1)

        # Map character segments to original text
        aligned_chars = []
        for i, segment in enumerate(char_segments):
            orig_idx = char_to_idx_map.get(i)
            if orig_idx is not None:
                aligned_chars.append(
                    {
                        "char": transcript[orig_idx],
                        "start": start_time + segment.start * ratio,
                        "end": start_time + segment.end * ratio,
                        "score": segment.score,
                    }
                )

        # Group characters into words
        words = []
        current_word = []

        for char_data in aligned_chars:
            if char_data["char"].isspace() and current_word:
                # End of word
                word_text = "".join(c["char"] for c in current_word)
                word_start = min(c["start"] for c in current_word)
                word_end = max(c["end"] for c in current_word)
                word_score = sum(c["score"] for c in current_word) / len(current_word)

                words.append(
                    AlignedWord(
                        word=word_text, start=word_start, end=word_end, score=word_score
                    )
                )
                current_word = []
            elif not char_data["char"].isspace():
                current_word.append(char_data)

        # Add the last word if there is one
        if current_word:
            word_text = "".join(c["char"] for c in current_word)
            word_start = min(c["start"] for c in current_word)
            word_end = max(c["end"] for c in current_word)
            word_score = sum(c["score"] for c in current_word) / len(current_word)

            words.append(
                AlignedWord(
                    word=word_text, start=word_start, end=word_end, score=word_score
                )
            )

        return words

    def _get_trellis(self, emission, tokens, blank_id=0):
        """Build trellis matrix for alignment

        Args:
            emission: Emission probabilities from model
            tokens: Token indices
            blank_id: ID of blank token

        Returns:
            Trellis matrix
        """
        num_frames = emission.size(0)
        num_tokens = len(tokens)

        trellis = torch.zeros((num_frames, num_tokens))
        trellis[1:, 0] = torch.cumsum(emission[1:, blank_id], 0)
        trellis[0, 1:] = float("-inf")
        trellis[-num_tokens + 1 :, 0] = float("inf")

        for t in range(num_frames - 1):
            trellis[t + 1, 1:] = torch.maximum(
                # Score for staying at the same token
                trellis[t, 1:] + emission[t, blank_id],
                # Score for changing to the next token
                trellis[t, :-1]
                + self._get_wildcard_emission(emission[t], tokens[1:], blank_id),
            )
        return trellis

    def _get_wildcard_emission(self, frame_emission, tokens, blank_id):
        """Process token emission scores with wildcards

        Args:
            frame_emission: Emission probability vector
            tokens: Token indices
            blank_id: ID of blank token

        Returns:
            Processed emission scores
        """
        # Convert tokens to tensor if needed
        tokens = (
            torch.tensor(tokens) if not isinstance(tokens, torch.Tensor) else tokens
        )

        # Create mask for wildcards
        wildcard_mask = tokens == -1

        # Get scores for non-wildcard positions
        regular_scores = frame_emission[tokens.clamp(min=0)]  # clamp to avoid -1 index

        # Create mask and compute maximum valid score
        max_valid_score = frame_emission.clone()
        max_valid_score[blank_id] = float("-inf")
        max_valid_score = max_valid_score.max()

        # Combine results
        result = torch.where(wildcard_mask, max_valid_score, regular_scores)
        return result

    def _backtrack_beam(self, trellis, emission, tokens, blank_id=0, beam_width=5):
        """Beam search backtracking for CTC alignment

        Args:
            trellis: Trellis matrix
            emission: Emission probabilities
            tokens: Token indices
            blank_id: ID of blank token
            beam_width: Number of beams to keep

        Returns:
            Best path found
        """
        T, J = trellis.size(0) - 1, trellis.size(1) - 1

        # Initialize beam search with starting point
        init_state = BeamState(
            token_index=J,
            time_index=T,
            score=trellis[T, J],
            path=[Point(J, T, emission[T, blank_id].exp().item())],
        )

        beams = [init_state]

        # Beam search loop
        while beams and beams[0].token_index > 0:
            next_beams = []

            for beam in beams:
                t, j = beam.time_index, beam.token_index

                if t <= 0:
                    continue

                # Get probabilities for staying or changing
                p_stay = emission[t - 1, blank_id]
                p_change = self._get_wildcard_emission(
                    emission[t - 1], [tokens[j]], blank_id
                )[0]

                # Get scores for staying or changing
                stay_score = trellis[t - 1, j]
                change_score = trellis[t - 1, j - 1] if j > 0 else float("-inf")

                # Option 1: Stay at the same token
                if not math.isinf(stay_score):
                    new_path = beam.path.copy()
                    new_path.append(Point(j, t - 1, p_stay.exp().item()))
                    next_beams.append(
                        BeamState(
                            token_index=j,
                            time_index=t - 1,
                            score=stay_score,
                            path=new_path,
                        )
                    )

                # Option 2: Move to the previous token
                if j > 0 and not math.isinf(change_score):
                    new_path = beam.path.copy()
                    new_path.append(Point(j - 1, t - 1, p_change.exp().item()))
                    next_beams.append(
                        BeamState(
                            token_index=j - 1,
                            time_index=t - 1,
                            score=change_score,
                            path=new_path,
                        )
                    )

            # Sort beams by score and keep top beam_width
            beams = sorted(next_beams, key=lambda x: x.score, reverse=True)[:beam_width]

            if not beams:
                break

        if not beams:
            return None

        # Get the best path
        best_beam = beams[0]
        t = best_beam.time_index
        j = best_beam.token_index

        # Fill in the rest of the path
        while t > 0:
            prob = emission[t - 1, blank_id].exp().item()
            best_beam.path.append(Point(j, t - 1, prob))
            t -= 1

        return best_beam.path[::-1]

    def _merge_repeats(self, path, transcript):
        """Merge repeated characters in alignment path

        Args:
            path: Alignment path
            transcript: Character transcript

        Returns:
            List of segments
        """
        i1, i2 = 0, 0
        segments = []

        while i1 < len(path):
            while i2 < len(path) and path[i1].token_index == path[i2].token_index:
                i2 += 1

            score = sum(path[k].score for k in range(i1, i2)) / (i2 - i1)
            segments.append(
                Segment(
                    transcript[path[i1].token_index],
                    path[i1].time_index,
                    path[i2 - 1].time_index + 1,
                    score,
                )
            )
            i1 = i2

        return segments
