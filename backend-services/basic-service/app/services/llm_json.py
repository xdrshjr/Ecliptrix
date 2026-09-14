"""
Robust extraction of a JSON object from free-form LLM output.

LLMs routinely wrap the JSON they were asked for in reasoning blocks
(``<think>…</think>``), Markdown fences with or without a language tag, or a
sentence of prose before/after the object. ``json.loads`` on the raw text
fails on all of those, so callers use :func:`extract_json_object` instead.
"""

import json
import re
from typing import Any, Dict, List, NoReturn, Optional

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE = re.compile(r"```[a-zA-Z]*\s*\n?(.*?)```", re.DOTALL)


def extract_json_object(content: str) -> Dict[str, Any]:
    """Return the first complete JSON object in LLM text.

    Every fenced block is tried in order, then the whole reply. Within a
    candidate, a balanced ``{…}`` that is not valid JSON (prose such as
    ``Plan {draft}:``) is skipped, so it cannot hide the real object after it.

    Raises:
        ValueError: no candidate holds a complete, valid JSON object, or the
            only object uses ``NaN`` / ``Infinity`` (``json.JSONDecodeError``
            is a ValueError).
    """
    text = _THINK_BLOCK.sub("", content or "").strip()
    candidates: List[str] = [
        match.group(1) for match in _FENCE.finditer(text)
    ]
    candidates.append(text)
    last_error: Optional[ValueError] = None
    unterminated = False
    for candidate in candidates:
        start = candidate.find("{")
        while start >= 0:
            end = _find_object_end(candidate, start)
            if end is None:
                unterminated = True
                start = candidate.find("{", start + 1)
                continue
            try:
                return json.loads(
                    candidate[start:end + 1],
                    parse_constant=_reject_non_finite,
                )
            except ValueError as error:
                last_error = error
                start = candidate.find("{", end + 1)
    if last_error is not None:
        raise last_error
    if unterminated:
        raise ValueError("unterminated JSON object in LLM output")
    raise ValueError("no JSON object in LLM output")


def _reject_non_finite(token: str) -> NoReturn:
    """``json.loads`` hook: NaN / Infinity would poison every comparison."""
    raise ValueError(f"non-finite number {token} in LLM output")


def _find_object_end(text: str, start: int) -> Optional[int]:
    """Index of the brace closing the object opened at ``start``.

    Braces inside string literals (including escaped quotes) do not count.
    """
    depth, in_string, escaped = 0, False, False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return None
