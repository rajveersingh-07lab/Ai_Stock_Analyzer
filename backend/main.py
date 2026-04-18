from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import numpy as np
import datetime
import time
import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google import genai
from google.genai import types
import threading

load_dotenv()

# Initialize FastAPI app
app = FastAPI()

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ─── Fix Yahoo Finance Rate Limiting ────────────
_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
try:
    import yfinance.utils as _yf_utils
    _yf_utils.user_agent_headers = {'User-Agent': _BROWSER_UA}
except Exception:
    pass
try:
    import yfinance.data as _yf_data
    if hasattr(_yf_data, 'YfData'):
        _orig_init = _yf_data.YfData.__init__
        def _patched_init(self, *args, **kwargs):
            _orig_init(self, *args, **kwargs)
            if hasattr(self, '_session') and self._session:
                self._session.headers.update({'User-Agent': _BROWSER_UA})
        _yf_data.YfData.__init__ = _patched_init
except Exception:
    pass

class AnalyzeRequest(BaseModel):
    company_name: str
    enable_agent: bool = False

def safe_yf_call(func, *args, max_retries=3, default=None, **kwargs):
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if 'RateLimit' in str(type(e).__name__) or 'rate' in str(e).lower():
                time.sleep((2 ** attempt) * 2)
                continue
            return default if default is not None else {}
    return default if default is not None else {}

def get_ticker(company):
    try:
        search = None
        for attempt in range(3):
            try:
                search = yf.Search(company, max_results=10)
                break
            except Exception as e:
                if 'RateLimit' in str(type(e).__name__) or 'rate' in str(e).lower():
                    time.sleep((2 ** attempt) * 2)
                    continue
                break

        results = search.quotes if search and hasattr(search, 'quotes') else []
        for r in results:
            if r.get('quoteType') in ['EQUITY', 'ETF']:
                return r['symbol'], r.get('shortname', r.get('longname', company))

        ticker = yf.Ticker(company.upper().replace(" ", ""))
        info = safe_yf_call(lambda: ticker.info) or {}
        if info.get('symbol'):
            return info['symbol'], info.get('shortName', company)
        
        # Super fallback
        return company.upper().replace(" ", ""), company
    except Exception:
        return company.upper().replace(" ", ""), company

def calculate_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = -delta.clip(upper=0).rolling(period).mean()
    rs = gain / loss
    return (100 - (100 / (1 + rs))).replace([np.inf, -np.inf], np.nan).fillna(50)

def fetch_financial_details(ticker_sym):
    stock = yf.Ticker(ticker_sym)
    info = safe_yf_call(lambda: stock.info) or {}
    
    financials = {
        'revenue': info.get('totalRevenue', 'N/A'),
        'profit_margins': info.get('profitMargins', 'N/A'),
        'debt_to_equity': info.get('debtToEquity', 'N/A'),
        'return_on_equity': info.get('returnOnEquity', 'N/A'),
        'free_cash_flow': info.get('freeCashflow', 'N/A'),
        'revenue_growth': info.get('revenueGrowth', 'N/A'),
        'forward_pe': info.get('forwardPE', 'N/A'),
        'summary': info.get('longBusinessSummary', 'N/A'),
    }
    return financials

def get_ai_analysis(ticker_sym, full_name, metrics, financials):
    if not gemini_client:
        return "AI analysis unavailable - API key missing."
    
    fin_text = ""
    for k, v in financials.items():
        if v != 'N/A' and k != 'summary':
            fin_text += f"{k}: {v}\n"

    prompt = f"""You are a senior equity analyst. Produce a short, highly professional, direct evaluation of {full_name} ({ticker_sym}).
Metrics:
- Current Price: {metrics.get('current_price')}
- High 52W: {metrics.get('high_52w')}
- Low 52W: {metrics.get('low_52w')}
- RSI: {metrics.get('rsi')}
- Volatility: {metrics.get('volatility')}

Financials:
{fin_text}

Provide:
1. Verdict (BUY/HOLD/SELL) clearly at the top.
2. Short 2-sentence rationale based on technicals (RSI) and financials.
3. Key Risks (bullet points).
Format cleanly in Markdown."""
    
    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.4, max_output_tokens=800)
        )
        return response.text
    except Exception as e:
        return f"AI error (Check your GEMINI_API_KEY on Render): {str(e)}"

@app.post("/api/analyze")
def analyze_stock(req: AnalyzeRequest):
    try:
        ticker_sym, full_name = get_ticker(req.company_name)
        if not ticker_sym:
            raise HTTPException(status_code=404, detail="Company not found.")
            
        stock = yf.Ticker(ticker_sym)
        
        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=365*2)
        
        df = yf.download(ticker_sym, start=start_date, end=end_date, auto_adjust=True, progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="Yahoo Finance returned no price data (rate limit or invalid ticker).")
            
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
            
        close_s = df['Close']
        if isinstance(close_s, pd.DataFrame):
            close_s = close_s.iloc[:, 0]
            
        vols = df['Volume']
        if isinstance(vols, pd.DataFrame):
            vols = vols.iloc[:, 0]
            
        daily_ret = close_s.pct_change()
        volatility = float(np.std(daily_ret.dropna()) * np.sqrt(252))
        rsi = calculate_rsi(close_s)
        
        info = safe_yf_call(lambda: stock.info) or {}
        current_price = info.get('currentPrice') or float(close_s.iloc[-1])
        high = info.get('fiftyTwoWeekHigh') or float(close_s.max())
        low = info.get('fiftyTwoWeekLow') or float(close_s.min())
        rsi_val = float(rsi.iloc[-1]) if not np.isnan(rsi.iloc[-1]) else 50.0
        
        metrics = {
            'current_price': current_price,
            'high_52w': high,
            'low_52w': low,
            'volatility': volatility,
            'rsi': rsi_val,
            'pe': info.get('trailingPE', 'N/A'),
            'market_cap': info.get('marketCap', 'N/A'),
        }
        
        financials = fetch_financial_details(ticker_sym)
        analysis = get_ai_analysis(ticker_sym, full_name, metrics, financials)
        
        chart_data = []
        prices_subset = close_s.tail(100) # last 100 days
        for date, price in prices_subset.items():
            chart_data.append({
                "date": date.strftime("%Y-%m-%d"),
                "price": float(price) if not np.isnan(price) else 0.0
            })

        return {
            "symbol": ticker_sym,
            "name": full_name,
            "metrics": metrics,
            "analysis": analysis,
            "chart_data": chart_data
        }
    except Exception as e:
        import traceback
        error_msg = f"Crash inside backend logic: {str(e)}\n\nTrace: {traceback.format_exc()}"
        print(error_msg)
        raise HTTPException(status_code=500, detail=str(e))
