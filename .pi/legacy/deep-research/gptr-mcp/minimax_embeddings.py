"""LangChain adapter for MiniMax's native embedding wire format.

MiniMax chat is OpenAI-compatible, but its embedding endpoint uses
``texts``/``type`` and returns ``vectors`` instead of OpenAI's ``input`` /
``data[].embedding``. This adapter keeps the API key and endpoint in the
existing MiniMax process environment and exposes LangChain's Embeddings API.
"""

import os
from typing import List

import httpx
from langchain_core.embeddings import Embeddings


class MiniMaxEmbeddings(Embeddings):
    def __init__(self, model: str = "embo-01", **kwargs):
        self.model = model
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.minimaxi.com/v1").rstrip("/")
        self.api_key = os.getenv("OPENAI_API_KEY") or os.getenv("MINIMAX_API_KEY")
        if not self.api_key:
            raise ValueError("MINIMAX_API_KEY is required for MiniMax embeddings")
        self.timeout = float(kwargs.pop("request_timeout", os.getenv("MINIMAX_EMBEDDING_TIMEOUT", "60")))

    def _embed(self, texts: List[str], kind: str) -> List[List[float]]:
        response = httpx.post(
            f"{self.base_url}/embeddings",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"model": self.model, "texts": texts, "type": kind},
            timeout=self.timeout,
        )
        response.raise_for_status()
        value = response.json()
        vectors = value.get("vectors")
        if not isinstance(vectors, list) or len(vectors) != len(texts) or not all(isinstance(v, list) for v in vectors):
            base = value.get("base_resp") or {}
            raise ValueError(f"MiniMax embedding response did not contain vectors: {base.get('status_msg', 'unknown error')}")
        return vectors

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self._embed(texts, "db")

    def embed_query(self, text: str) -> List[float]:
        return self._embed([text], "query")[0]
