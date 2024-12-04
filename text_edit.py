from llama_cpp import Llama
import json

class LLM:
    def __init__(self):
        self.model = Llama.from_pretrained(
            repo_id="QuantFactory/Meta-Llama-3-8B-Instruct-GGUF", #"Qwen/Qwen2-0.5B-Instruct-GGUF",
            filename="*Q8_0.gguf",
            chat_format="chatml",
            verbose=False
        )

    def find_edit_substring(self, text: str, query: str):
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
                    "properties": {"subseq_original": {"type": "string"}, "subseq_edited": {"type": "string"}},
                    "required": ["subseq_original", "subseq_edited"],
                },
            },
            temperature=0.7,
        )
        result = output["choices"][0]["message"]["content"]
        print("Input:", text)
        print("Output:", result)

        try:
            result = json.loads(result)
            return result["subseq_original"], result["subseq_edited"]
        except json.JSONDecodeError:
            raise ValueError("Error parsing the generated text.")
        except KeyError:
            raise ValueError("Expected keys `subseq_original` and `subseq_edited` are missing.")