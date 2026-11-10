import threading

import httpx

from .config import USER_AGENT

_local = threading.local()


def client() -> httpx.Client:
    c = getattr(_local, "client", None)
    if c is None:
        c = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
        )
        _local.client = c
    return c
