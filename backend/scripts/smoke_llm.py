"""Exercise every LLM path once and dump outputs to /tmp/finn-smoke for review.

uv run python -m scripts.smoke_llm [SYMBOL ...]
"""

import json
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app import llm
from app.main import app

OUT = Path("/tmp/finn-smoke")
OUT.mkdir(exist_ok=True)
c = TestClient(app)


def run(name: str, method: str, path: str, **kw):
    t = time.time()
    try:
        r = c.request(method, path, **kw)
        body = r.json()
        status = r.status_code
    except Exception as e:  # noqa: BLE001
        body, status = {"exception": repr(e)}, 0
    (OUT / f"{name}.json").write_text(json.dumps(body, indent=2, default=str))
    err = body.get("error") or body.get("detail") or body.get("exception") if isinstance(body, dict) else None
    print(f"{'ok ' if status == 200 and not err else 'ERR'} {name:<34} {status} {time.time() - t:5.1f}s {str(err or '')[:120]}", flush=True)
    return body


def main(symbols: list[str]) -> None:
    d = run("digest_7d", "GET", "/api/digest", params={"window": "7d"})
    for s in (d.get("stories") or [])[:8]:
        if s["category"] in ("results", "management_change") or s["tier"] == "notable":
            run(f"enrich_{s['symbol']}_{s['category']}", "POST", "/api/enrich", json=s)
    for sym in symbols:
        for sec in ("promises", "bullbear", "governance", "business"):
            run(f"{sym}_{sec}", "GET", f"/api/research/{sym}/{sec}")
        run(f"{sym}_ask", "POST", f"/api/research/{sym}/ask", json={"question": "What did management say about margins, and did they deliver?"})
    print(json.dumps(llm.usage(), indent=1))


if __name__ == "__main__":
    main(sys.argv[1:] or ["TITAN", "PIDILITIND"])
