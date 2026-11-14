import os
import time
from pathlib import Path

from dotenv import load_dotenv

# NSE timestamps and the 15:30 market close are IST; cloud hosts default to UTC.
os.environ["TZ"] = "Asia/Kolkata"
time.tzset()

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# Serverless hosts only allow writes under /tmp.
CACHE_DIR = Path(os.getenv("FINN_CACHE_DIR") or ("/tmp/finn-cache" if os.getenv("VERCEL") else BASE_DIR / ".cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Any OpenAI-compatible endpoint works. Default is Gemini's free tier.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY", "")
FAST_MODEL = os.getenv("FAST_MODEL", "gemini-3.5-flash-lite")
SMART_MODEL = os.getenv("SMART_MODEL", "gemini-3.5-flash")
# Tried in order when a model's daily quota is exhausted (free tier allows ~20 requests/day on flash).
SMART_FALLBACKS = [m for m in os.getenv("SMART_FALLBACKS", "gemini-3-flash-preview").split(",") if m]
# Thinking budget per tier; higher effort spent ~5x tokens on our prompts with no change in answers.
FAST_REASONING = os.getenv("FAST_REASONING", "minimal")
SMART_REASONING = os.getenv("SMART_REASONING", "low")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

PORTFOLIO: list[dict] = [
    {"symbol": "RELIANCE", "name": "Reliance", "sector": "Conglomerate"},
    {"symbol": "HDFCBANK", "name": "HDFC Bank", "sector": "Private Bank"},
    {"symbol": "ICICIBANK", "name": "ICICI Bank", "sector": "Private Bank"},
    {"symbol": "BAJFINANCE", "name": "Bajaj Finance", "sector": "NBFC"},
    {"symbol": "TCS", "name": "TCS", "sector": "IT Services"},
    {"symbol": "INFY", "name": "Infosys", "sector": "IT Services"},
    {"symbol": "PERSISTENT", "name": "Persistent", "sector": "IT Services"},
    {"symbol": "ITC", "name": "ITC", "sector": "FMCG"},
    {"symbol": "HINDUNILVR", "name": "Hindustan Unilever", "sector": "FMCG"},
    {"symbol": "TITAN", "name": "Titan", "sector": "Consumer Discretionary"},
    {"symbol": "TRENT", "name": "Trent", "sector": "Retail"},
    {"symbol": "MARUTI", "name": "Maruti Suzuki", "sector": "Automobiles"},
    {"symbol": "SUNPHARMA", "name": "Sun Pharma", "sector": "Pharma"},
    {"symbol": "LT", "name": "L&T", "sector": "Capital Goods"},
    {"symbol": "DIXON", "name": "Dixon", "sector": "Electronics Mfg"},
    {"symbol": "POLYCAB", "name": "Polycab", "sector": "Cables & Wires"},
    {"symbol": "ETERNAL", "name": "Eternal", "sector": "Internet / Quick Commerce"},
    {"symbol": "DEEPAKNTR", "name": "Deepak Nitrite", "sector": "Specialty Chemicals"},
]

RESEARCH_DEMO = ["PIDILITIND", "KAYNES", "CDSL", "ASTRAL"]
