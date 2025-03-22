from typing import Tuple
import string
import numpy as np
from scipy import signal
from pydub import AudioSegment
import whisper
from loguru import logger

from .alignment import AudioAligner


class WordWithTimestamps:
    """
    A class to represent a word with a timestamp
    """

    def __init__(self, word, start, end):
        self.word = word
        self.start = start
        self.end = end

    def __repr__(self):
        return f"{self.word} ({self.start:.2f}s - {self.end:.2f}s)"


class VoiceMessage:
    """
    A class to represent a voice message (list of WordWithTimestamps)
    """

    def __init__(self, path: str, device="cpu"):
        """Transcribes a voice message using Whisper for initial transcription,
        then aligns with Wav2Vec2 for accurate word timestamps

        Args:
            path: path to the audio file
            device: device to run the model on ("cpu", "cuda", or "mps")
        """
        # 1. Initial transcription with Whisper
        logger.info("Loading Whisper model...")
        whisper_model = whisper.load_model("base", device=device)

        logger.info("Transcribing audio with Whisper...")
        self.whisper_result = whisper_model.transcribe(
            path,
            word_timestamps=True,  # Get initial word timestamps
            language="en",  # You can make this configurable
        )

        self.path = path
        self.text = self.whisper_result["text"]
        logger.info(f"Initial transcription: {self.text}")

        # Initial word list from Whisper (we'll refine this)
        whisper_words = []
        for segment in self.whisper_result["segments"]:
            for word_data in segment["words"]:
                whisper_words.append(
                    WordWithTimestamps(
                        word=word_data["word"].strip(),
                        start=word_data["start"],
                        end=word_data["end"],
                    )
                )

        # 2. Refine timestamps with Wav2Vec2 alignment
        logger.info("Refining word timestamps with Wav2Vec2 alignment...")
        self._refine_timestamps_with_alignment(path, device)

        # 3. Further refine with DSP
        logger.info("Further refining timestamps with DSP...")
        self._refine_timestamps_with_dsp(path)

        logger.info(f"Transcription complete with {len(self.word_list)} words")

    def _refine_timestamps_with_alignment(self, audio_path: str, device="cpu"):
        """Refine word timestamps using Wav2Vec2 alignment

        Args:
            audio_path: path to the audio file
            device: device to run the model on
        """
        try:
            # Initialize the aligner
            aligner = AudioAligner(language="en", device=device)

            aligned_words = []

            # Process each segment separately for better alignment
            for segment in self.whisper_result["segments"]:
                segment_text = segment["text"]
                segment_start = segment["start"]
                segment_end = segment["end"]

                # Align this segment
                aligned_segment = aligner.align_transcript(
                    audio_path, segment_text, segment_start, segment_end
                )

                aligned_words.extend(aligned_segment)

            # Convert aligned words to our format
            self.word_list = [
                WordWithTimestamps(word=word.word, start=word.start, end=word.end)
                for word in aligned_words
                if word.word.strip()
            ]

        except Exception as e:
            # Fallback to Whisper timestamps if alignment fails
            logger.error(f"Alignment failed: {e}. Falling back to Whisper timestamps.")
            self.word_list = []
            for segment in self.whisper_result["segments"]:
                for word_data in segment["words"]:
                    self.word_list.append(
                        WordWithTimestamps(
                            word=word_data["word"].strip(),
                            start=word_data["start"],
                            end=word_data["end"],
                        )
                    )

    def _refine_timestamps_with_dsp(self, audio_path: str):
        """Refine word timestamps using DSP methods for better boundaries

        Args:
            audio_path: path to the audio file
        """
        try:
            # Load audio file
            import soundfile as sf

            audio, sample_rate = sf.read(audio_path)

            # Convert to mono if stereo
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)

            # Calculate energy envelope
            window_size = int(0.01 * sample_rate)  # 10ms window
            energy = np.array(
                [
                    np.sqrt(np.mean(audio[i : i + window_size] ** 2))
                    for i in range(0, len(audio), window_size)
                ]
            )
            time_points = np.arange(len(energy)) * (window_size / sample_rate)

            # Smooth energy curve
            energy_smooth = signal.medfilt(energy, kernel_size=5)

            # Calculate adaptive silence threshold
            silence_threshold = np.percentile(energy_smooth, 20) * 1.5

            # Adjust each word's boundaries based on energy
            for word in self.word_list:
                # Find time indices closest to word boundaries
                start_idx = np.argmin(np.abs(time_points - word.start))
                end_idx = np.argmin(np.abs(time_points - word.end))

                # Expand search windows
                search_window_start = max(0, start_idx - 10)
                search_window_end = min(len(energy_smooth) - 1, end_idx + 10)

                # Find more precise word start (where energy rises above threshold)
                for i in range(start_idx, search_window_start, -1):
                    if energy_smooth[i] < silence_threshold:
                        word.start = time_points[i + 1]
                        break

                # Find more precise word end (where energy falls below threshold)
                for i in range(end_idx, search_window_end):
                    if energy_smooth[i] < silence_threshold:
                        word.end = time_points[i - 1]
                        break

            # Ensure no overlapping words
            for i in range(1, len(self.word_list)):
                if self.word_list[i].start < self.word_list[i - 1].end:
                    # Find midpoint
                    midpoint = (self.word_list[i - 1].end + self.word_list[i].start) / 2
                    self.word_list[i - 1].end = midpoint
                    self.word_list[i].start = midpoint

            logger.info("Word timestamps refined using DSP")
        except Exception as e:
            logger.warning(f"Failed to refine timestamps with DSP: {e}")

    def __repr__(self):
        return "\n".join([word.__repr__() for word in self.word_list])

    def _find_subsequence_indices(self, subsequence: str) -> Tuple[int, int]:
        """Find the start and end indices of a subsequence in the voice message

        Args:
            subsequence: subsequence to find

        Returns:
            Start and end indices of the subsequence in the voice message or -1, -1 if not found
        """
        # Clean subsequence and convert to lowercase for case-insensitive matching
        subsequence = subsequence.lower().strip()
        subsequence_words = [
            word.strip().translate(str.maketrans("", "", string.punctuation))
            for word in subsequence.split()
        ]

        # Prepare a cleaned version of our transcript words for matching
        clean_word_list = [
            word.word.lower()
            .strip()
            .translate(str.maketrans("", "", string.punctuation))
            for word in self.word_list
        ]

        # First, try exact subsequence match
        for i in range(len(clean_word_list) - len(subsequence_words) + 1):
            match = True
            for j in range(len(subsequence_words)):
                if clean_word_list[i + j] != subsequence_words[j]:
                    match = False
                    break
            if match:
                return i, i + len(subsequence_words) - 1

        # If exact match fails, try fuzzy matching (allow for small errors)
        # This helps with transcription errors like "Navocado" vs "avocado"
        from difflib import SequenceMatcher

        for i in range(len(clean_word_list) - len(subsequence_words) + 1):
            avg_ratio = 0
            for j in range(len(subsequence_words)):
                ratio = SequenceMatcher(
                    None, clean_word_list[i + j], subsequence_words[j]
                ).ratio()
                avg_ratio += ratio

            avg_ratio /= len(subsequence_words)
            if avg_ratio > 0.8:  # 80% similarity threshold
                return i, i + len(subsequence_words) - 1

        # If still no match, try word-by-word fuzzy matching
        best_match_idx = -1
        best_match_score = 0

        for i in range(len(clean_word_list) - len(subsequence_words) + 1):
            total_score = 0
            for j in range(len(subsequence_words)):
                matcher = SequenceMatcher(
                    None, clean_word_list[i + j], subsequence_words[j]
                )
                total_score += matcher.ratio()

            avg_score = total_score / len(subsequence_words)
            if (
                avg_score > best_match_score and avg_score > 0.7
            ):  # Higher threshold for single-word
                best_match_score = avg_score
                best_match_idx = i

        if best_match_idx >= 0:
            return best_match_idx, best_match_idx + len(subsequence_words) - 1

        return -1, -1  # Return -1, -1 if no subsequence is found

    def fuse_audio(
        self,
        start_index: int,
        end_index: int,
        generated_audio_path: str,
        output_path: str,
        fade_in_ms=10,
        fade_out_ms=40,
        overlap_ms=30,
        eq_match=True,
    ) -> None:
        """Fuse the voice message with generated audio and store to disk with advanced audio processing

        Args:
            start_index: the start index of the subsequence to replace
            end_index: the end index of the subsequence to replace
            generated_audio_path: path to the generated audio
            output_path: path to save the fused audio
            fade_in_ms: duration of fade in (milliseconds)
            fade_out_ms: duration of fade out (milliseconds)
            overlap_ms: duration of overlap for crossfades (milliseconds)
            eq_match: whether to apply EQ matching
        """
        # Load audio segments
        source_audio_segment = AudioSegment.from_wav(self.path)
        generated_audio_segment = AudioSegment.from_wav(generated_audio_path)

        # Get timestamps and convert to milliseconds
        start_time, end_time = (
            self.word_list[start_index].start,
            self.word_list[end_index].end,
        )
        start_time_ms, end_time_ms = int(start_time * 1000), int(end_time * 1000)

        # Calculate proper segment boundaries with offsets for smooth transitions
        adjusted_start_ms = max(0, start_time_ms - (overlap_ms // 2))
        adjusted_end_ms = min(
            len(source_audio_segment), end_time_ms + (overlap_ms // 2)
        )

        # Extract segments
        source_segment_before = source_audio_segment[:adjusted_start_ms]
        source_segment_after = source_audio_segment[adjusted_end_ms:]

        # Match volumes for consistent audio level
        target_dBFS = source_audio_segment.dBFS
        gain_needed = target_dBFS - generated_audio_segment.dBFS
        generated_audio_segment = generated_audio_segment.apply_gain(gain_needed)

        # Apply EQ matching if requested
        if eq_match:
            try:
                # Get a sample of the source audio near the edit point for reference
                context_before = source_audio_segment[
                    max(0, adjusted_start_ms - 500) : adjusted_start_ms
                ]

                # Basic EQ matching using low and high pass filters
                # Low frequency adjustment
                low_freq_source = context_before.low_pass_filter(300)
                low_freq_gen = generated_audio_segment.low_pass_filter(300)

                # High frequency adjustment
                high_freq_source = context_before.high_pass_filter(3000)
                high_freq_gen = generated_audio_segment.high_pass_filter(3000)

                # Calculate relative levels and adjust
                low_level_diff = low_freq_source.dBFS - low_freq_gen.dBFS
                high_level_diff = high_freq_source.dBFS - high_freq_gen.dBFS

                # Create modified low and high components
                adjusted_low = generated_audio_segment.low_pass_filter(300).apply_gain(
                    low_level_diff
                )
                adjusted_high = generated_audio_segment.high_pass_filter(
                    3000
                ).apply_gain(high_level_diff)

                # Create mid component (by removing low and high)
                mid_band = generated_audio_segment.overlay(
                    adjusted_low.apply_gain(-10)
                ).overlay(adjusted_high.apply_gain(-10))

                # Blend components back together with appropriate levels
                generated_audio_segment = adjusted_low.overlay(mid_band).overlay(
                    adjusted_high
                )

                logger.info("Applied spectral EQ matching to generated audio")
            except Exception as e:
                logger.warning(f"EQ matching failed: {e}. Continuing without EQ.")

        # Apply fades with precise timing
        source_segment_before = source_segment_before.fade_out(fade_in_ms)
        generated_audio_segment = generated_audio_segment.fade_in(fade_in_ms).fade_out(
            fade_out_ms
        )
        source_after_with_fade = source_segment_after.fade_in(fade_out_ms)

        # First crossfade: source_before + generated
        position1 = len(source_segment_before) - overlap_ms
        if position1 < 0:
            # Handle case where the beginning segment is too short for overlap
            logger.warning(
                "Beginning segment too short for requested overlap. Reducing overlap."
            )
            position1 = 0
            first_overlap = min(overlap_ms, len(source_segment_before))
        else:
            first_overlap = overlap_ms

        # Create first join
        fused1 = source_segment_before[:position1]
        if first_overlap > 0:
            overlap_segment1 = source_segment_before[position1:].overlay(
                generated_audio_segment[:first_overlap]
            )
            fused1 += overlap_segment1
            fused1 += generated_audio_segment[first_overlap:]
        else:
            fused1 += generated_audio_segment

        # Second crossfade: result + source_after
        position2 = len(fused1) - overlap_ms
        if position2 < 0:
            # Handle case where the middle segment is too short for overlap
            logger.warning(
                "Middle segment too short for requested overlap. Reducing overlap."
            )
            position2 = 0
            second_overlap = min(overlap_ms, len(fused1))
        else:
            second_overlap = overlap_ms

        # Create second join
        final_audio = fused1[:position2]
        if second_overlap > 0:
            overlap_segment2 = fused1[position2:].overlay(
                source_after_with_fade[:second_overlap]
            )
            final_audio += overlap_segment2
            final_audio += source_after_with_fade[second_overlap:]
        else:
            final_audio += source_after_with_fade

        # Export the final result
        logger.info(
            f"Exporting fused audio with fade_in={fade_in_ms}ms, fade_out={fade_out_ms}ms, overlap={overlap_ms}ms"
        )
        final_audio.export(output_path, format="wav")
