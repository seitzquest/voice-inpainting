from typing import Tuple
import string
from pydub import AudioSegment
import whisper


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

    def __init__(self, path: str):
        """Transcribes a voice message

        Args:
            path: path to the audio file
        """
        model = whisper.load_model("base", device="cpu")  # Use MPS for Apple Silicon
        result = model.transcribe(path, word_timestamps=True)

        self.path = path
        self.text = result["text"]
        self.word_list = [WordWithTimestamps(word["word"], word["start"], word["end"]) for segment in result["segments"] for word in segment["words"]]

    def __repr__(self):
        return "\n".join([word.__repr__() for word in self.word_list])

    def _find_subsequence_indices(self, subsequence: str) -> Tuple[int, int]:
        """Find the start and end indices of a subsequence in the voice message

        Args:
            subsequence: subsequence to find

        Returns:
            Start and end indices of the subsequence in the voice message or -1, -1 if not found
        """
        subsequence_words = subsequence.split() 
        start_index = None
        end_index = None
        
        word_sequence = [word.word.strip().lower() for word in self.word_list[:len(subsequence_words)]]
        for i in range(len(self.word_list) - len(subsequence_words) + 1):
            if word_sequence == subsequence_words:
                start_index = i
                end_index = i + len(subsequence_words) - 1
                break  # We found the subsequence, so exit the loop
            
            if i + len(subsequence_words) == len(self.word_list):
                break

            word_sequence = word_sequence[1:]
            word_sequence.append(self.word_list[i + len(subsequence_words)].word.strip().lower().translate(str.maketrans('', '', string.punctuation)))

        if start_index is None or end_index is None:
            return -1, -1  # Return -1, -1 if no subsequence is found
        
        return start_index, end_index

    def fuse_audio(self, start_index: int, end_index: int, generated_audio_path: str, output_path: str) -> None:
        """Fuse the voice message with second message and store to disk

        Args:
            start_index: the start index of the subsequence to replace
            end_index: the end index of the subsequence to replace
            generated_audio_path: path to the generated audio
            output_path: path to save the fused audio
        """
        source_audio_segment = AudioSegment.from_wav(self.path)
        generated_audio_segment = AudioSegment.from_wav(generated_audio_path)

        start_time, end_time = self.word_list[start_index].start, self.word_list[end_index].end
        start_time_ms, end_time_ms = int(start_time * 1000), int(end_time * 1000)

        source_segment_before = source_audio_segment[:start_time_ms]
        source_segment_after = source_audio_segment[end_time_ms:]

        # Apply fade-out and fade-in for smoothing
        fade_duration_ms = 100  # Adjust as needed
        source_segment_after = source_segment_after.fade_in(fade_duration_ms)
        generated_audio_segment = generated_audio_segment.fade_out(fade_duration_ms)

        final_audio = source_segment_before + generated_audio_segment + source_segment_after
        final_audio.export(output_path, format="wav")
