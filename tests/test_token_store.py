import os
import sys
import pytest
import torch
from pathlib import Path

# Adjust path to import from src
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.token_store import TokenStore
from src.semantic_edit import EditOperation


# Fixtures
@pytest.fixture(scope="module")
def sample_audio():
    """Use real audio file with known transcript"""
    return Path("tests/../data/examples/onepiece.wav")


@pytest.fixture(scope="module")
def device():
    """Determine which device to use for tests"""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Running tests on device: {device}")
    return device


@pytest.fixture
def token_store(device, tmp_path):
    """Create a fresh TokenStore for each test"""
    store = TokenStore(device=device, session_dir=tmp_path)
    yield store
    store.cleanup()


@pytest.fixture
def initialized_store(token_store, sample_audio):
    """Initialize the TokenStore using real audio with known transcript"""
    token_store.initialize(sample_audio)
    return token_store


@pytest.fixture
def word_token_indices(initialized_store):
    """Fixture to find token indices for specific words in the text"""

    def find_indices(word):
        """Find the token indices for a specific word in the text"""
        text = initialized_store.current_state.text.lower()
        word = word.lower()
        word_start_pos = text.find(word)

        if word_start_pos == -1:
            raise ValueError(f"Word '{word}' not found in text")

        word_end_pos = word_start_pos + len(word)

        # Use the tokenizer's find_token_range method to get token indices
        start_token_idx, end_token_idx = initialized_store.tokenizer.find_token_range(
            initialized_store.current_state, (word_start_pos, word_end_pos)
        )

        return start_token_idx, end_token_idx

    return find_indices


# Tests
def test_transcript_correctness(initialized_store):
    expected_transcript = "One piece of chocolate, please."
    actual_transcript = initialized_store.current_state.text.strip()
    assert expected_transcript.lower() == actual_transcript.lower()


def test_basic_edit(initialized_store, word_token_indices):
    """Test editing the word 'chocolate' to 'vanilla'"""
    # Get token indices for 'chocolate'
    start_token_idx, end_token_idx = word_token_indices("chocolate")
    new_text = "vanilla"

    original_text = initialized_store.current_state.text
    modified_state = initialized_store.apply_edit(
        start_token_idx, end_token_idx, new_text
    )

    assert modified_state is not None
    assert "vanilla" in modified_state.text
    assert "chocolate" not in modified_state.text
    assert initialized_store.current_version_index == 1
    assert len(initialized_store.versions) == 2
    assert initialized_store.original_state.text == original_text


def test_multiple_edits(initialized_store, word_token_indices):
    """Test multiple consecutive edits"""
    # Get token indices for each word to edit
    one_start, one_end = word_token_indices("One")
    piece_start, piece_end = word_token_indices("piece")
    please_start, please_end = word_token_indices("please")

    # Apply the edits using dynamic indices
    initialized_store.apply_edit(one_start, one_end, "Two")  # "One" -> "Two"
    initialized_store.apply_edit(
        piece_start, piece_end, "slices"
    )  # "piece" -> "slices"
    initialized_store.apply_edit(please_start, please_end, "now")  # "please" -> "now"

    final_text = initialized_store.current_state.text
    assert "Two" in final_text
    assert "slices" in final_text
    assert "now" in final_text
    assert initialized_store.current_version_index == 3
    assert len(initialized_store.versions) == 4


def test_version_navigation(initialized_store, word_token_indices):
    """Test restoring previous versions"""
    original_text = initialized_store.versions[0].token_data.text

    one_start, one_end = word_token_indices("One")
    initialized_store.apply_edit(one_start, one_end, "Two")  # "One" -> "Two"

    # Restore original
    initialized_store.restore_version(version_index=0)
    assert initialized_store.current_state.text == original_text
    # Restore latest
    initialized_store.restore_version(version_index=1)
    assert "Two" in initialized_store.current_state.text


def test_multiple_edit_operations(initialized_store, word_token_indices):
    """Test applying multiple edit operations at once"""
    initialized_store.restore_version(version_index=0)

    # Get token indices for the words to edit
    piece_start, piece_end = word_token_indices("piece")
    please_start, please_end = word_token_indices("please")

    ops = [
        EditOperation(
            original_text="piece",
            edited_text="bar",
            start_token_idx=piece_start,
            end_token_idx=piece_end,
        ),
        EditOperation(
            original_text="please",
            edited_text="thanks",
            start_token_idx=please_start,
            end_token_idx=please_end,
        ),
    ]

    initialized_store.apply_edit_operations(ops)

    updated_text = initialized_store.current_state.text
    assert "bar" in updated_text
    assert "thanks" in updated_text
    assert initialized_store.current_version_index == 1
    assert len(initialized_store.versions) == 2
