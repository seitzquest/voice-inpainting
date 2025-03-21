import os
import tempfile
import numpy as np
import soundfile as sf
from pydub import AudioSegment
from loguru import logger


class AudioProcessor:
    """Audio processing utilities for voice message editing"""

    def match_volume(self, source_path, target_path, output_path=None):
        """Match the volume of source audio to target audio

        Args:
            source_path: Path to the source audio file
            target_path: Path to the target audio file
            output_path: Path to save the processed audio. If None, creates a temporary file.

        Returns:
            Path to the processed audio file
        """
        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

        source_audio = AudioSegment.from_wav(source_path)
        target_audio = AudioSegment.from_wav(target_path)

        # Match volume
        target_dBFS = target_audio.dBFS
        source_dBFS = source_audio.dBFS
        gain_needed = target_dBFS - source_dBFS

        logger.info(f"Adjusting volume by {gain_needed:.2f} dB")
        adjusted_audio = source_audio.apply_gain(gain_needed)
        adjusted_audio.export(output_path, format="wav")

        return output_path

    def analyze_speech_rhythm(self, audio_path, word_timestamps):
        """Analyze speech rhythm for better splicing

        Args:
            audio_path: Path to the audio file
            word_timestamps: List of WordWithTimestamps objects

        Returns:
            Dictionary with speech rhythm metrics
        """
        # Handle empty or single word cases with default values
        if not word_timestamps:
            logger.warning("No word timestamps provided for rhythm analysis")
            return {"speech_rate": 3.0, "pause_ratio": 0.2, "avg_pause": 0.2}

        if len(word_timestamps) <= 1:
            logger.warning(
                "Only one word timestamp provided, using default rhythm metrics"
            )
            return {"speech_rate": 3.0, "pause_ratio": 0.2, "avg_pause": 0.2}

        try:
            # Calculate total duration of speech
            duration = word_timestamps[-1].end - word_timestamps[0].start

            # Handle very short or invalid durations
            if duration <= 0.1:
                logger.warning(
                    f"Very short duration detected: {duration}s, using default values"
                )
                return {"speech_rate": 3.0, "pause_ratio": 0.2, "avg_pause": 0.2}

            # Calculate words per second
            speech_rate = len(word_timestamps) / duration

            # Calculate pauses between words
            pauses = []
            for i in range(1, len(word_timestamps)):
                pause = word_timestamps[i].start - word_timestamps[i - 1].end
                if pause > 0:
                    pauses.append(pause)

            # Calculate speech statistics
            total_pause = sum(pauses) if pauses else 0
            pause_ratio = total_pause / duration if duration > 0 else 0.2
            avg_pause = sum(pauses) / len(pauses) if pauses else 0.2

            # For safety, provide reasonable defaults if calculations result in extreme values
            if (
                speech_rate <= 0 or speech_rate > 10
            ):  # Typical speech is 2-5 words per second
                speech_rate = 3.0

            if (
                pause_ratio < 0 or pause_ratio > 0.8
            ):  # Pauses usually take up 10-30% of speech
                pause_ratio = 0.2

            logger.info(
                f"Speech rhythm analysis: {speech_rate:.1f} words/sec, {pause_ratio:.2f} pause ratio"
            )

            return {
                "speech_rate": speech_rate,
                "pause_ratio": pause_ratio,
                "avg_pause": avg_pause,
                "max_pause": max(pauses) if pauses else 0.3,
                "min_pause": min(pauses) if pauses else 0.1,
            }
        except Exception as e:
            logger.error(f"Error in speech rhythm analysis: {e}")
            return {"speech_rate": 3.0, "pause_ratio": 0.2, "avg_pause": 0.2}

    def detect_prosody(self, audio_path):
        """Detect prosodic features (pitch, intensity, rhythm)

        Args:
            audio_path: Path to the audio file

        Returns:
            Dictionary with prosody metrics
        """
        try:
            import librosa

            # Load audio
            y, sr = librosa.load(audio_path)

            # Extract pitch (F0 contour)
            pitches, magnitudes = librosa.piptrack(y=y, sr=sr)
            pitch_contour = []
            for i in range(pitches.shape[1]):
                index = magnitudes[:, i].argmax()
                pitch_contour.append(pitches[index, i])

            # Extract intensity/volume contour
            rms = librosa.feature.rms(y=y)[0]

            # Basic statistics
            return {
                "pitch_mean": np.mean([p for p in pitch_contour if p > 0]),
                "pitch_std": np.std([p for p in pitch_contour if p > 0]),
                "intensity_mean": np.mean(rms),
                "intensity_std": np.std(rms),
            }
        except Exception as e:
            logger.warning(f"Failed to detect prosody: {e}")
            return {}

    def adjust_timing_to_match_prosody(
        self, source_path, target_path, output_path=None
    ):
        """Adjust timing of target audio to match prosody of source

        Args:
            source_path: Path to the source audio file (prosody reference)
            target_path: Path to the target audio file to be adjusted
            output_path: Path to save the processed audio. If None, creates a temporary file.

        Returns:
            Path to the processed audio file
        """
        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

        try:
            import librosa
            import pyrubberband as pyrb

            # Detect speech rate from both files
            source_prosody = self.detect_prosody(source_path)
            target_prosody = self.detect_prosody(target_path)

            if not source_prosody or not target_prosody:
                logger.warning("Could not detect prosody, skipping timing adjustment")
                # Just copy the file if we can't adjust
                source_audio = AudioSegment.from_wav(target_path)
                source_audio.export(output_path, format="wav")
                return output_path

            # Calculate stretch factor based on pitch
            pitch_ratio = (
                source_prosody["pitch_mean"] / target_prosody["pitch_mean"]
                if target_prosody["pitch_mean"] > 0
                else 1.0
            )

            # Keep the stretch factor within reasonable bounds
            pitch_ratio = max(0.8, min(pitch_ratio, 1.2))

            # Load audio
            y, sr = librosa.load(target_path)

            # Adjust timing
            y_stretched = pyrb.time_stretch(y, sr, pitch_ratio)

            # Save to output
            sf.write(output_path, y_stretched, sr)

            logger.info(f"Adjusted timing with factor {pitch_ratio:.2f}")
            return output_path

        except Exception as e:
            logger.warning(f"Failed to adjust timing: {e}")
            # Just copy the file if we can't adjust
            source_audio = AudioSegment.from_wav(target_path)
            source_audio.export(output_path, format="wav")
            return output_path
