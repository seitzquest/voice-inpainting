"""
Memory management utilities for handling GPU memory.
"""

import gc
import torch
from loguru import logger


class MemoryManager:
    """Utility class for managing model memory and clearing GPU cache"""

    @staticmethod
    def log_memory_stats(label="Current"):
        """Log current GPU memory usage"""
        if not torch.cuda.is_available():
            logger.info(f"{label} memory: CUDA not available")
            return

        used_memory = torch.cuda.memory_allocated() / (1024**3)
        total_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        logger.info(f"{label} GPU memory: {used_memory:.2f}GB / {total_memory:.2f}GB")

    @staticmethod
    def clear_gpu_memory():
        """Clear CUDA cache and run garbage collection"""
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
        logger.info("GPU memory cleared")

    @staticmethod
    def to_cpu(model):
        """Move model to CPU and return it"""
        if model is None:
            return None

        try:
            cpu_model = model.cpu()
            return cpu_model
        except Exception as e:
            logger.warning(f"Failed to move model to CPU: {e}")
            return model

    @staticmethod
    def to_device(model, device):
        """Move model to specified device and return it"""
        if model is None:
            return None

        try:
            model_on_device = model.to(device)
            return model_on_device
        except Exception as e:
            logger.warning(f"Failed to move model to {device}: {e}")
            return model

    @staticmethod
    def unload_model(model_ref):
        """Unload model from memory"""
        if model_ref is not None:
            try:
                del model_ref
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                logger.info("Model unloaded")
            except Exception as e:
                logger.warning(f"Failed to unload model: {e}")
