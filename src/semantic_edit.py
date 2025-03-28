"""
Semantic editing module for voice inpainting.
Identifies token sequences to replace based on edit prompts,
with focus on pre-padding context for better voice generation.
"""

import json
from typing import Tuple, Optional
from dataclasses import dataclass
from llama_cpp import Llama
from loguru import logger

from src.tokenization import AudioTokenizer, TokenizedAudio


@dataclass
class EditOperation:
    """Represents an edit operation

    Note: While both pre-padding and post-padding context are maintained for
    compatibility, the improved voice inpainting primarily uses pre-padding context.
    Post-padding is now less important for generation quality.
    """

    original_text: str
    edited_text: str
    start_token_idx: int
    end_token_idx: int
    confidence: float = 1.0

    # Pre-padding context (text before the edit that provides context but isn't replaced)
    # This is the primary context used for improved voice generation
    prepadding_text: str = ""
    prepadding_start_token_idx: int = -1
    prepadding_end_token_idx: int = -1

    # Post-padding context (maintained for compatibility but less important now)
    postpadding_text: str = ""
    postpadding_start_token_idx: int = -1
    postpadding_end_token_idx: int = -1


class SemanticEditor:
    """Identifies token sequences to edit based on prompts"""

    def __init__(
        self,
        tokenizer: AudioTokenizer,
        model_path: Optional[str] = None,
        load_llm: bool = True,
    ):
        """Initialize the semantic editor

        Args:
            tokenizer: AudioTokenizer instance
            model_path: Path to the LLM model for editing
            load_llm: Whether to load the LLM model (can be set to False for manual edit mode)
        """
        self.tokenizer = tokenizer
        self.model = None
        if load_llm:
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

        This method now prioritizes pre-padding context for improved voice generation.
        Post-padding context is still identified but is less important for generation quality.

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
        start_token_idx, end_token_idx = self.tokenizer.find_token_range(
            tokenized_audio, (start_char_idx, end_char_idx)
        )

        # Focus primarily on finding appropriate pre-padding context (text before the edit)
        # This is the most important context for improved voice generation
        prepadding_text, prepadding_start_char_idx = self.find_prepadding_context(
            text, start_char_idx
        )

        # Map prepadding character indices to token indices
        prepadding_start_token_idx, prepadding_end_token_idx = -1, -1
        if prepadding_text:
            prepadding_start_token_idx, prepadding_end_token_idx = (
                self.tokenizer.find_token_range(
                    tokenized_audio, (prepadding_start_char_idx, start_char_idx)
                )
            )
            # The end of prepadding is the start of the edit
            prepadding_end_token_idx = start_token_idx

            logger.info(
                f"Pre-padding context: '{prepadding_text}' "
                f"(tokens {prepadding_start_token_idx} to {prepadding_end_token_idx})"
            )

        # For compatibility, still identify post-padding context but note it's less important now
        postpadding_text, postpadding_end_char_idx = self.find_postpadding_context(
            text, end_char_idx
        )

        # Map postpadding character indices to token indices
        postpadding_start_token_idx, postpadding_end_token_idx = -1, -1
        if postpadding_text:
            postpadding_start_token_idx, postpadding_end_token_idx = (
                self.tokenizer.find_token_range(
                    tokenized_audio, (end_char_idx, postpadding_end_char_idx)
                )
            )
            # The start of postpadding is the end of the edit
            postpadding_start_token_idx = end_token_idx

            logger.info(
                f"Post-padding context (less important now): '{postpadding_text}' "
                f"(tokens {postpadding_start_token_idx} to {postpadding_end_token_idx})"
            )

        # Handle edge cases for edit operations
        # If original text is empty (insertion), use a minimal token range at the position
        if not subseq_original.strip():
            # For insertion, end_token_idx should equal start_token_idx
            end_token_idx = start_token_idx
            logger.info(f"Edit is an insertion at token {start_token_idx}")

        # If edited text is empty (deletion), make sure we have proper token range
        if not subseq_edited.strip():
            logger.info(
                f"Edit is a deletion of tokens {start_token_idx} to {end_token_idx}"
            )

        # Create the EditOperation with a focus on pre-padding context
        return EditOperation(
            original_text=subseq_original,
            edited_text=subseq_edited,
            start_token_idx=start_token_idx,
            end_token_idx=end_token_idx,
            confidence=1.0,
            prepadding_text=prepadding_text,
            prepadding_start_token_idx=prepadding_start_token_idx,
            prepadding_end_token_idx=prepadding_end_token_idx,
            postpadding_text=postpadding_text,
            postpadding_start_token_idx=postpadding_start_token_idx,
            postpadding_end_token_idx=postpadding_end_token_idx,
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
        if self.model is None:
            logger.error("LLM model not loaded but _find_edit_substring was called")
            raise ValueError("Cannot find edit substring: LLM model not loaded")

        prompt = (
            f"Given an original message and an edit prompt. Identify the minimal subsequence in the original message `subseq_original` that needs to be replaced and text `subseq_edited` to replace `subseq_original` with.\n"
            "Make sure that subseq_original is a contiguous substring of the original message.\n"
            "Make sure that the message resulting from replacing subseq_original in the original message with subseq_edited is syntactically and semantically correct.\n\n"
            "Example:\n"
            "Original Message: 'The quick brown fox jumps over the lazy dog.'\n"
            "Edit Prompt: 'Turn the fox into a funny yellow cow'\n"
            "Note: The subsequence 'fox' in the original message needs to be replaced with 'funny yellow cow' to facilitate the change.\n\n"
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

    def find_prepadding_context(
        self, text: str, edit_start_char_idx: int
    ) -> Tuple[str, int]:
        """Find appropriate pre-padding context before the edit position.
        Attempts to get a complete sentence or phrase that ends at the edit position.
        This method is public so it can be called directly for manual edit operations.

        This is the primary context used for improved voice generation.

        Args:
            text: Full transcript text
            edit_start_char_idx: Character index where the edit starts

        Returns:
            Tuple of (prepadding_text, prepadding_start_char_idx)
        """
        # Get text before the edit point
        text_before = text[:edit_start_char_idx].strip()

        if not text_before:
            # No text before the edit point
            return "", 0

        # Define patterns for sentence boundaries (periods, question marks, exclamation points)
        sentence_boundaries = [". ", "? ", "! ", "\n"]

        # Find the last sentence boundary
        last_boundary_idx = -1
        for boundary in sentence_boundaries:
            idx = text_before.rfind(boundary)
            if idx > last_boundary_idx:
                last_boundary_idx = idx

        if last_boundary_idx != -1:
            # Found a sentence boundary, use everything after it as context
            # Add the length of the boundary itself (e.g., ". " is 2 chars)
            boundary_length = 1
            if (
                text_before[last_boundary_idx : last_boundary_idx + 2].rstrip()
                in sentence_boundaries
            ):
                boundary_length = 2

            prepadding_start_idx = last_boundary_idx + boundary_length
            prepadding_text = text_before[prepadding_start_idx:]

            # Calculate the actual character index in the original text
            actual_start_idx = (
                edit_start_char_idx - len(text_before) + prepadding_start_idx
            )

            return prepadding_text, actual_start_idx
        else:
            # No sentence boundary found, use the last few words for context
            words = text_before.split()
            if len(words) <= 3:
                # Use all words if there are 3 or fewer
                return text_before, edit_start_char_idx - len(text_before)
            else:
                # Use the last 3 words as context
                context_words = words[-3:]

                # Find where these words start in the original text
                context_start_idx = text_before.rfind(" " + context_words[0] + " ")
                if context_start_idx == -1:
                    # If not found with spaces, try just finding the first word
                    context_start_idx = text_before.rfind(context_words[0])
                    if context_start_idx == -1:
                        # If still not found, just use a fixed character count
                        return text_before[-30:], max(0, edit_start_char_idx - 30)

                # Add 1 to skip the leading space if found with space
                if text_before[context_start_idx] == " ":
                    context_start_idx += 1

                # Calculate the actual character index in the original text
                actual_start_idx = (
                    edit_start_char_idx - len(text_before) + context_start_idx
                )
                return text_before[context_start_idx:], actual_start_idx

    def find_postpadding_context(
        self, text: str, edit_end_char_idx: int
    ) -> Tuple[str, int]:
        """Find appropriate post-padding context after the edit position.
        Attempts to get a complete sentence or phrase that starts at the edit position.
        This method is public so it can be called directly for manual edit operations.

        Note: Post-padding is kept for compatibility but is less important now,
        as the improved voice inpainting primarily relies on pre-padding context.

        Args:
            text: Full transcript text
            edit_end_char_idx: Character index where the edit ends

        Returns:
            Tuple of (postpadding_text, postpadding_end_char_idx)
        """
        # Get text after the edit point
        text_after = text[edit_end_char_idx:].strip()

        if not text_after:
            # No text after the edit point
            return "", len(text)

        # Define patterns for sentence boundaries (periods, question marks, exclamation points)
        sentence_boundaries = [". ", "? ", "! ", "\n"]

        # Find the first sentence boundary
        first_boundary_idx = len(text_after)
        for boundary in sentence_boundaries:
            idx = text_after.find(boundary)
            if idx != -1 and idx < first_boundary_idx:
                first_boundary_idx = idx

        if first_boundary_idx < len(text_after):
            # Found a sentence boundary, use everything up to it as context
            # Add the length of the boundary itself (e.g., ". " is 2 chars)
            boundary_length = 1
            if (
                text_after[first_boundary_idx : first_boundary_idx + 2].rstrip()
                in sentence_boundaries
            ):
                boundary_length = 2

            postpadding_text = text_after[: first_boundary_idx + boundary_length]

            # Calculate the actual character index in the original text
            actual_end_idx = edit_end_char_idx + first_boundary_idx + boundary_length

            return postpadding_text, actual_end_idx
        else:
            # No sentence boundary found, use the first few words for context
            words = text_after.split()
            if len(words) <= 3:
                # Use all words if there are 3 or fewer
                return text_after, len(text)
            else:
                # Use the first 3 words as context
                context_words = words[:3]
                context_end_idx = 0
                for word in context_words:
                    context_end_idx = text_after.find(word, context_end_idx) + len(word)

                # Calculate the actual character index in the original text
                actual_end_idx = edit_end_char_idx + context_end_idx

                return " ".join(context_words), actual_end_idx

    # Private alias for backward compatibility
    _find_prepadding_context = find_prepadding_context

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
