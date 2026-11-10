"""Thin OpenAI-compatible client with model routing, response caching and a usage ledger.

Two tiers:
  fast  -> bulk extraction / classification (cheap model)
  smart -> cross-document reasoning (promised-vs-delivered, bull/bear, Q&A)
Responses are cached on (model, prompt), so re-opening a card never re-bills.
"""

import json
import re
import threading
import time

import httpx

from . import cache
from .config import FAST_MODEL, LLM_API_KEY, LLM_BASE_URL, SMART_MODEL


class LLMUnavailable(RuntimeError):
    pass


_usage_lock = threading.Lock()
_usage = {
    "calls": 0,
    "cache_hits": 0,
    "by_model": {},
}


def available() -> bool:
    return bool(LLM_API_KEY)


def usage() -> dict:
    with _usage_lock:
        return json.loads(json.dumps(_usage))


def _record(model: str, prompt_tokens: int, completion_tokens: int) -> None:
    with _usage_lock:
        _usage["calls"] += 1
        m = _usage["by_model"].setdefault(model, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0})
        m["calls"] += 1
        m["prompt_tokens"] += prompt_tokens
        m["completion_tokens"] += completion_tokens


def _model_for(tier: str) -> str:
    return SMART_MODEL if tier == "smart" else FAST_MODEL


def complete(
    prompt: str,
    *,
    system: str = "",
    tier: str = "fast",
    json_mode: bool = False,
    max_tokens: int = 2048,
    use_cache: bool = True,
) -> str:
    model = _model_for(tier)
    key = json.dumps([model, system, prompt, json_mode, max_tokens])
    if use_cache:
        hit = cache.get_json("llm", key)
        if hit is not None:
            with _usage_lock:
                _usage["cache_hits"] += 1
            return hit["text"]
    if not available():
        raise LLMUnavailable("No LLM_API_KEY / GEMINI_API_KEY configured")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    body: dict = {"model": model, "messages": messages, "temperature": 0, "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    last_err: Exception | None = None
    for attempt in range(4):
        try:
            r = httpx.post(
                f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {LLM_API_KEY}"},
                json=body,
                timeout=120,
            )
            if r.status_code in (429, 500, 502, 503):
                time.sleep(2 * (attempt + 1) ** 2)
                last_err = RuntimeError(f"LLM {r.status_code}: {r.text[:200]}")
                continue
            r.raise_for_status()
            data = r.json()
            text = data["choices"][0]["message"]["content"] or ""
            u = data.get("usage") or {}
            _record(model, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
            if use_cache and text:
                cache.set_json("llm", key, {"text": text})
            return text
        except httpx.HTTPError as e:
            last_err = e
            time.sleep(1 + attempt)
    raise RuntimeError(f"LLM call failed: {last_err}")


def parse_json(text: str):
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
        if start < 0:
            raise
        end = max(text.rfind("}"), text.rfind("]"))
        return json.loads(text[start : end + 1])


def complete_json(prompt: str, *, system: str = "", tier: str = "fast", max_tokens: int = 4096):
    text = complete(prompt, system=system, tier=tier, json_mode=True, max_tokens=max_tokens)
    return parse_json(text)
