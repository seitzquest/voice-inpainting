import string
import whisper
from pydub import AudioSegment
from tts import F5TTS
import soundfile as sf
from text_edit import LLM

class WordWithTimestamps:
    def __init__(self, word, start, end):
        self.word = word
        self.start = start
        self.end = end

    def __repr__(self):
        return f"{self.word} ({self.start:.2f}s - {self.end:.2f}s)"

class VoiceMessage:
    def __init__(self, path: str):
        model = whisper.load_model("base", device="cpu")  # Use MPS for Apple Silicon
        result = model.transcribe(path, word_timestamps=True)

        self.path = path
        self.text = result["text"]
        self.word_list = [WordWithTimestamps(word["word"], word["start"], word["end"]) for segment in result["segments"] for word in segment["words"]]

    def __repr__(self):
        return "\n".join([word.__repr__() for word in self.word_list])

    def _find_subsequence_indices(self, subsequence):
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

def fuse_audio(source_audio: VoiceMessage, start_index: int, end_index: int, generated_audio_path: str, output_path: str):
    source_audio_segment = AudioSegment.from_wav(source_audio.path)
    generated_audio_segment = AudioSegment.from_wav(generated_audio_path)

    start_time, end_time = source_audio.word_list[start_index].start, source_audio.word_list[end_index].end
    start_time_ms, end_time_ms = int(start_time * 1000), int(end_time * 1000)

    source_segment_before = source_audio_segment[:start_time_ms]
    source_segment_after = source_audio_segment[end_time_ms:]

    # Apply fade-out and fade-in for smoothing
    fade_duration_ms = 100  # Adjust as needed
    source_segment_after = source_segment_after.fade_in(fade_duration_ms)
    generated_audio_segment = generated_audio_segment.fade_out(fade_duration_ms)

    final_audio = source_segment_before + generated_audio_segment + source_segment_after
    final_audio.export(output_path, format="wav")

def tts(gen_text: str, ref_audio: str, ref_text: str, output_path: str) -> None:
    final_wave, final_sample_rate = F5TTS().infer(ref_audio, ref_text, gen_text)
    sf.write(output_path, final_wave, final_sample_rate)

def find_edit_substring(source_audio: VoiceMessage, query: str):
    subseq_original, subseq_edited = LLM().find_edit_substring(source_audio.text, query)
    start_index, end_index = source_audio._find_subsequence_indices(subseq_original)
    return start_index, end_index, subseq_edited
