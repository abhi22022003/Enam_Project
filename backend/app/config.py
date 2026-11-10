import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

CACHE_DIR = Path(os.getenv("FINN_CACHE_DIR", BASE_DIR / ".cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Any OpenAI-compatible endpoint works. Default is Gemini's free tier.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY", "")
FAST_MODEL = os.getenv("FAST_MODEL", "gemini-2.5-flash-lite")
SMART_MODEL = os.getenv("SMART_MODEL", "gemini-2.5-flash")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

PORTFOLIO: list[dict] = [
    {"symbol": "RELIANCE", "sector": "Conglomerate"},
    {"symbol": "HDFCBANK", "sector": "Private Bank"},
    {"symbol": "ICICIBANK", "sector": "Private Bank"},
    {"symbol": "BAJFINANCE", "sector": "NBFC"},
    {"symbol": "TCS", "sector": "IT Services"},
    {"symbol": "INFY", "sector": "IT Services"},
    {"symbol": "PERSISTENT", "sector": "IT Services"},
    {"symbol": "ITC", "sector": "FMCG"},
    {"symbol": "HINDUNILVR", "sector": "FMCG"},
    {"symbol": "TITAN", "sector": "Consumer Discretionary"},
    {"symbol": "TRENT", "sector": "Retail"},
    {"symbol": "MARUTI", "sector": "Automobiles"},
    {"symbol": "SUNPHARMA", "sector": "Pharma"},
    {"symbol": "LT", "sector": "Capital Goods"},
    {"symbol": "DIXON", "sector": "Electronics Mfg"},
    {"symbol": "POLYCAB", "sector": "Cables & Wires"},
    {"symbol": "ETERNAL", "sector": "Internet / Quick Commerce"},
    {"symbol": "DEEPAKNTR", "sector": "Specialty Chemicals"},
]

RESEARCH_DEMO = ["PIDILITIND", "KAYNES", "CDSL", "ASTRAL"]
