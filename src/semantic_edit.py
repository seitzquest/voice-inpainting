"""
Semantic editing module for voice inpainting.
Identifies token sequences to replace based on edit prompts.
"""

import json
from typing import Tuple, Optional
from dataclasses import dataclass
from llama_cpp import Llama
from loguru import logger

from src.tokenization import AudioTokenizer, TokenizedAudio


@dataclass
class EditOperation:
    """Represents an edit operation"""

    original_text: str
    edited_text: str
    start_token_idx: int
    end_token_idx: int
    confidence: float = 1.0


class SemanticEditor:
    """Identifies token sequences to edit based on prompts"""

    def __init__(self, tokenizer: AudioTokenizer, model_path: Optional[str] = None):
        """Initialize the semantic editor

        Args:
            model_path: Path to the LLM model for editing
        """
        self.tokenizer = tokenizer
        self.model = self._initialize_llm(model_path)

    def _initialize_llm(self, model_path: Optional[str] = None) -> Llama:
        """Initialize the LLM for semantic editing

        Args:
            model_path: Path to the LLM model

        Returns:
            Initialized LLM model
        """
        # Default to a small model if none specified
        if model_path is None:
            model_path = "QuantFactory/Meta-Llama-3-8B-Instruct-GGUF"
            filename = "*Q8_0.gguf"
        else:
            filename = None

        logger.info(f"Initializing LLM for semantic editing: {model_path}")
        model = Llama.from_pretrained(
            repo_id=model_path, filename=filename, chat_format="chatml", verbose=False
        )
        return model

    def find_edit_region(
        self, tokenized_audio: TokenizedAudio, edit_prompt: str
    ) -> EditOperation:
        """Find the token range to edit based on the prompt

        Args:
            tokenized_audio: TokenizedAudio object
            edit_prompt: Description of the edit to make

        Returns:
            EditOperation with token range and edit details
        """
        text = tokenized_audio.text

        # Query LLM to find what to replace
        subseq_original, subseq_edited = self._find_edit_substring(text, edit_prompt)
        logger.info(f"Edit proposal: '{subseq_original}' -> '{subseq_edited}'")

        # Find the token range for the edit
        # First locate the text indices
        try:
            start_char_idx = text.index(subseq_original)
            end_char_idx = start_char_idx + len(subseq_original)
        except ValueError:
            logger.warning(
                f"Could not find '{subseq_original}' in text, using fuzzy matching"
            )
            start_char_idx, end_char_idx = self._fuzzy_find_substring(
                text, subseq_original
            )

        # Now map the character indices to token indices
        # Use text_to_token_map from the tokenized audio
        start_token_idx, end_token_idx = self.tokenizer.find_token_range(
            tokenized_audio, (start_char_idx, end_char_idx)
        )

        return EditOperation(
            original_text=subseq_original,
            edited_text=subseq_edited,
            start_token_idx=start_token_idx,
            end_token_idx=end_token_idx,
        )

    def _find_edit_substring(self, text: str, query: str) -> Tuple[str, str]:
        """Queries LLM for the minimal subsequence in the original message that needs
        to be replaced and the text to replace it with.

        Args:
            text: original message
            query: edit prompt

        Returns:
            subseq_original: minimal subsequence in the original message that needs to be replaced
            subseq_edited: text to replace the subsequence with
        """
        prompt = (
            f"Given an original message and an edit prompt. Identify the minimal subsequence in the original message `subseq_original` that needs to be replaced and text `subseq_edited` to replace `subseq_original` with.\n"
            "Make sure that subseq_original is a contiguous substring of the original message.\n"
            "Make sure that the message resulting from replacing subseq_original in the original message with subseq_edited is syntactically and semantically correct.\n\n"
            "Example:\n"
            "Original Message: 'The quick brown fox jumps over the lazy dog.'\n"
            "Edit Prompt: 'Turn the fox into a funny yellow cow'\n"
            "Note: The subsequence 'quick brown fox' in the original message needs to be replaced with 'funny yellow cow' to facilitate the change.\n\n"
            "JSON Output: {'subseq_original': 'fox', 'subseq_edited': 'funny yellow cow'}\n\n"
            "Example:\n"
            f"Original Message: '{text}'\n"
            f"Edit Prompt: '{query}'\n"
        )

        # Use response format to enforce JSON output with specific schema
        output = self.model.create_chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that outputs in JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            response_format={
                "type": "json_object",
                "schema": {
                    "type": "object",
                    "properties": {
                        "subseq_original": {"type": "string"},
                        "subseq_edited": {"type": "string"},
                    },
                    "required": ["subseq_original", "subseq_edited"],
                },
            },
            temperature=0.7,
        )

        try:
            result = output["choices"][0]["message"]["content"]
            result = json.loads(result)
            return result["subseq_original"], result["subseq_edited"]
        except json.JSONDecodeError:
            logger.error("Error parsing LLM response")
            raise ValueError("Error parsing the generated text.")
        except KeyError:
            logger.error("Expected keys missing in LLM response")
            raise ValueError(
                "Expected keys `subseq_original` and `subseq_edited` are missing."
            )

    def _fuzzy_find_substring(self, text: str, substring: str) -> Tuple[int, int]:
        """Find the best match for a substring using fuzzy matching

        Args:
            text: Text to search in
            substring: Substring to search for

        Returns:
            Tuple of (start_idx, end_idx)
        """
        from difflib import SequenceMatcher

        # Try different positions and find the best match
        best_ratio = 0
        best_pos = (0, len(substring))

        for i in range(len(text) - len(substring) + 1):
            test_str = text[i : i + len(substring)]
            ratio = SequenceMatcher(None, test_str, substring).ratio()

            if ratio > best_ratio:
                best_ratio = ratio
                best_pos = (i, i + len(substring))

        if best_ratio < 0.7:
            logger.warning(f"Low confidence fuzzy match: {best_ratio:.2f}")

        return best_pos
