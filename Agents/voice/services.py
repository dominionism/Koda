"""Custom LLM services with retry logic and fallback support."""

from __future__ import annotations

import asyncio
from functools import wraps
from typing import Any

from loguru import logger
from openai import RateLimitError, APITimeoutError
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    RetryError,
)

from pipecat.services.groq.llm import GroqLLMService
from pipecat.services.ollama.llm import OllamaLLMSettings, OLLamaLLMService


def with_retry(func):
    """Decorator that retries LLM calls with exponential backoff on transient errors."""

    @wraps(func)
    async def wrapper(self, *args, **kwargs):
        last_error = None
        for attempt in range(1, 4):  # 3 attempts total
            try:
                return await func(self, *args, **kwargs)
            except (RateLimitError, APITimeoutError) as e:
                last_error = e
                if attempt < 3:
                    wait_time = 2 ** attempt  # 2s, 4s
                    logger.warning(
                        f"{self}: attempt {attempt} failed with {type(e).__name__}. "
                        f"Retrying in {wait_time}s..."
                    )
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"{self}: all 3 attempts failed, last error: {e}")
        # After 3 failures on Groq, try fallback to Ollama
        if isinstance(self, RetryableGroqLLMService) and self._fallback_llm:
            logger.info(f"{self}: Groq failed, attempting Ollama fallback...")
            return await self._fallback_llm.get_chat_completions(*args, **kwargs)
        raise last_error

    return wrapper


class RetryableGroqLLMService(GroqLLMService):
    """GroqLLMService with automatic retry and Ollama fallback.

    Retries on RateLimitError (429) and APITimeoutError with exponential backoff.
    After 3 failures, falls back to local Ollama if configured.
    """

    def __init__(
        self,
        *,
        fallback_llm: OLLamaLLMService | None = None,
        **kwargs,
    ):
        """Initialize with optional Ollama fallback.

        Args:
            fallback_llm: OLLamaLLMService instance to use if Groq fails.
            **kwargs: Passed to GroqLLMService parent.
        """
        super().__init__(**kwargs)
        self._fallback_llm = fallback_llm

    async def get_chat_completions(self, context: Any):
        """Get chat completions with retry + fallback to Ollama on failure."""
        last_error = None

        for attempt in range(1, 4):
            try:
                return await super().get_chat_completions(context)
            except RateLimitError as e:
                last_error = e
                logger.warning(
                    f"{self}: Groq rate limit hit (attempt {attempt}/3). "
                    f"Waiting {2**attempt}s before retry..."
                )
                if attempt < 3:
                    await asyncio.sleep(2 ** attempt)
            except APITimeoutError as e:
                last_error = e
                logger.warning(
                    f"{self}: Groq timeout (attempt {attempt}/3). "
                    f"Waiting {2**attempt}s before retry..."
                )
                if attempt < 3:
                    await asyncio.sleep(2 ** attempt)

        # All retries exhausted
        if self._fallback_llm:
            logger.warning(f"{self}: Groq failed after 3 attempts. Falling back to Ollama.")
            try:
                return await self._fallback_llm.get_chat_completions(context)
            except Exception as fallback_error:
                logger.error(f"{self}: Ollama fallback also failed: {fallback_error}")
                raise last_error from fallback_error
        else:
            logger.error(f"{self}: Groq failed after 3 attempts with no fallback configured.")
            raise last_error


def create_llm_service(
    groq_api_key: str | None = None,
    groq_model: str = "llama-3.3-70b-versatile",
    ollama_model: str | None = None,
    ollama_base_url: str = "http://localhost:11434/v1",
) -> tuple[GroqLLMService | RetryableGroqLLMService, OLLamaLLMService | None]:
    """Create LLM service with Groq + optional Ollama fallback.

    Args:
        groq_api_key: Groq API key. If None, Ollama-only mode is used.
        groq_model: Groq model name (default: llama-3.3-70b-versatile).
        ollama_model: Ollama model name. If None, no Ollama fallback is configured.
        ollama_base_url: Ollama server URL (default: http://localhost:11434/v1).

    Returns:
        Tuple of (primary_llm, fallback_llm). fallback_llm is None if not configured.
    """
    fallback_llm: OLLamaLLMService | None = None

    if ollama_model:
        fallback_llm = OLLamaLLMService(
            model=ollama_model,
            base_url=ollama_base_url,
            settings=OllamaLLMSettings(model=ollama_model),
        )
        logger.info(f"Ollama fallback configured: {ollama_model} at {ollama_base_url}")

    if groq_api_key:
        primary_llm = RetryableGroqLLMService(
            api_key=groq_api_key,
            model=groq_model,
            fallback_llm=fallback_llm,
        )
        logger.info(f"Primary LLM: Groq {groq_model} with Ollama fallback")
        return primary_llm, fallback_llm
    elif fallback_llm:
        logger.info(f"Primary LLM: Ollama {ollama_model} (no Groq configured)")
        return fallback_llm, None
    else:
        raise ValueError("At least one of groq_api_key or ollama_model must be provided")