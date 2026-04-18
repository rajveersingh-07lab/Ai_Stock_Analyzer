from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import numpy as np
import datetime
import time
import os
import traceback
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ─── Models ──────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    company_name: str
    enable_agent: bool = True

class CompareRequest(BaseModel):
    symbols: list[str]

# ─── Helpers ─────────────────────────────────────────────
def safe_yf_call(func, max_retries=3, default=None):
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            if 'rate' in str(e).lower():
                time.sleep((2 ** attempt) * 1.5)
                continue
            return default if default is not None else {}
    return default if default is not None else {}

def get_ticker(company: str):
    try:
        search = None
        for attempt in range(3):
            try:
                search = yf.Search(company, max_results=5)
                break
            except Exception as e:
                if 'rate' in str(e).lower():
                    time.sleep((2 ** attempt) * 1.5)
                    continue
                break
        results = search.quotes if search and hasattr(search, 'quotes') else []
        for r in results:
            if r.get('quoteType') in ['EQUITY', 'ETF']:
                return r['symbol'], r.get('shortname') or r.get('longname') or company
        fallback = company.upper().replace(" ", "")
        return fallback, company
    except Exception:
        return company.upper().replace(" ", ""), company

def calculate_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = -delta.clip(upper=0).rolling(period).mean()
    rs = gain / loss
    return (100 - (100 / (1 + rs))).replace([np.inf, -np.inf], np.nan).fillna(50)

def fmt(val, suffix='', prefix='', decimals=2):
    if val is None or val == 'N/A':
        return 'N/A'
    try:
        f = float(val)
        if abs(f) >= 1e12:
            return f"{prefix}{f/1e12:.{decimals}f}T{suffix}"
        if abs(f) >= 1e9:
            return f"{prefix}{f/1e9:.{decimals}f}B{suffix}"
        if abs(f) >= 1e6:
            return f"{prefix}{f/1e6:.{decimals}f}M{suffix}"
        return f"{prefix}{f:.{decimals}f}{suffix}"
    except:
        return str(val)

def get_ai_analysis(ticker_sym, full_name, metrics, info):
    if not gemini_client:
        return "AI analysis unavailable — GEMINI_API_KEY is missing."
    try:
        prompt = f"""You are a senior equity analyst at a top investment bank. Give a comprehensive, professional analysis of {full_name} ({ticker_sym}).

**Live Data:**
- Current Price: {metrics.get('current_price')}
- 52W Range: {metrics.get('low_52w')} → {metrics.get('high_52w')}
- RSI (14-day): {metrics.get('rsi')}
- Annualised Volatility: {metrics.get('volatility')}
- P/E Ratio: {info.get('trailingPE', 'N/A')}
- Market Cap: {fmt(info.get('marketCap'), prefix='$')}
- Revenue Growth: {info.get('revenueGrowth', 'N/A')}
- Profit Margins: {info.get('profitMargins', 'N/A')}
- Debt/Equity: {info.get('debtToEquity', 'N/A')}
- Return on Equity: {info.get('returnOnEquity', 'N/A')}
- Free Cash Flow: {fmt(info.get('freeCashflow'), prefix='$')}
- Dividend Yield: {info.get('dividendYield', 'N/A')}
- Beta: {info.get('beta', 'N/A')}

**Company Summary:** {info.get('longBusinessSummary', 'N/A')[:500]}

Produce the following sections using Markdown:
## Verdict
State clearly: **BUY**, **HOLD**, or **SELL** and in one sentence why.

## Technical Analysis
Comment on RSI, volatility, price relative to 52W range in 3-4 sentences.

## Fundamental Analysis
Comment on valuation (PE), cashflow, margins, growth in 3-4 sentences.

## Key Risks
3-5 bullet points on the biggest risks for this stock.

## Investment Outlook
Short 2-3 sentence overall conclusion suitable for a retail investor.
"""
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.3, max_output_tokens=1200)
        )
        return response.text
    except Exception as e:
        return f"AI error: {str(e)}"

# ─── Routes ──────────────────────────────────────────────

@app.get("/api/search")
def search_stocks(q: str = Query(..., min_length=1)):
    """Autocomplete: returns list of {symbol, name, exchange} matching query."""
    try:
        search = yf.Search(q, max_results=8)
        results = []
        for r in (search.quotes if hasattr(search, 'quotes') else []):
            if r.get('quoteType') in ['EQUITY', 'ETF', 'MUTUALFUND']:
                results.append({
                    "symbol": r.get('symbol', ''),
                    "name": r.get('shortname') or r.get('longname') or r.get('symbol', ''),
                    "exchange": r.get('exchange', ''),
                    "type": r.get('quoteType', '')
                })
        return results
    except Exception as e:
        return []

@app.post("/api/analyze")
def analyze_stock(req: AnalyzeRequest):
    try:
        ticker_sym, full_name = get_ticker(req.company_name)

        stock = yf.Ticker(ticker_sym)
        info = safe_yf_call(lambda: stock.info, default={})

        # Override name from info if available
        full_name = info.get('longName') or info.get('shortName') or full_name

        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=365 * 2)

        df = yf.download(ticker_sym, start=start_date, end=end_date, auto_adjust=True, progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="No price data found. Yahoo Finance may be rate-limiting or ticker is invalid.")

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        close_s = df['Close'] if isinstance(df['Close'], pd.Series) else df['Close'].iloc[:, 0]
        volume_s = df['Volume'] if isinstance(df['Volume'], pd.Series) else df['Volume'].iloc[:, 0]
        high_s = df['High'] if isinstance(df['High'], pd.Series) else df['High'].iloc[:, 0]
        low_s = df['Low'] if isinstance(df['Low'], pd.Series) else df['Low'].iloc[:, 0]

        daily_ret = close_s.pct_change()
        volatility = float(np.std(daily_ret.dropna()) * np.sqrt(252))
        rsi_series = calculate_rsi(close_s)

        current_price = info.get('currentPrice') or float(close_s.iloc[-1])
        high_52w = info.get('fiftyTwoWeekHigh') or float(close_s.max())
        low_52w = info.get('fiftyTwoWeekLow') or float(close_s.min())
        rsi_val = float(rsi_series.iloc[-1]) if not np.isnan(rsi_series.iloc[-1]) else 50.0

        metrics = {
            'current_price': round(current_price, 2),
            'high_52w': round(high_52w, 2),
            'low_52w': round(low_52w, 2),
            'volatility': round(volatility, 4),
            'rsi': round(rsi_val, 2),
            'pe': info.get('trailingPE', 'N/A'),
            'market_cap': info.get('marketCap', 'N/A'),
            'dividend_yield': info.get('dividendYield', 'N/A'),
            'beta': info.get('beta', 'N/A'),
            'volume': info.get('averageVolume', 'N/A'),
            'eps': info.get('trailingEps', 'N/A'),
            'revenue_growth': info.get('revenueGrowth', 'N/A'),
            'profit_margin': info.get('profitMargins', 'N/A'),
        }

        company_info = {
            'sector': info.get('sector', 'N/A'),
            'industry': info.get('industry', 'N/A'),
            'country': info.get('country', 'N/A'),
            'exchange': info.get('exchange', 'N/A'),
            'website': info.get('website', ''),
            'employees': info.get('fullTimeEmployees', 'N/A'),
            'summary': info.get('longBusinessSummary', 'No company overview available.'),
            'logo_url': f"https://logo.clearbit.com/{info.get('website','').replace('https://','').replace('http://','').split('/')[0]}" if info.get('website') else '',
            'ceo': info.get('companyOfficers', [{}])[0].get('name', 'N/A') if info.get('companyOfficers') else 'N/A',
        }

        # Price chart (last 200 days)
        chart_data = []
        for date, (price, vol, hi, lo, rsi_v) in zip(
            close_s.tail(200).index,
            zip(
                close_s.tail(200).values,
                volume_s.tail(200).values,
                high_s.tail(200).values,
                low_s.tail(200).values,
                rsi_series.tail(200).values,
            )
        ):
            chart_data.append({
                "date": date.strftime("%Y-%m-%d"),
                "price": round(float(price), 2) if not np.isnan(price) else 0.0,
                "volume": int(vol) if not np.isnan(vol) else 0,
                "high": round(float(hi), 2) if not np.isnan(hi) else 0.0,
                "low": round(float(lo), 2) if not np.isnan(lo) else 0.0,
                "rsi": round(float(rsi_v), 2) if not np.isnan(rsi_v) else 50.0,
            })

        # AI analysis
        analysis = get_ai_analysis(ticker_sym, full_name, metrics, info)

        return {
            "symbol": ticker_sym,
            "name": full_name,
            "metrics": metrics,
            "company_info": company_info,
            "analysis": analysis,
            "chart_data": chart_data,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Crash: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/compare")
def compare_stocks(req: CompareRequest):
    """Compare multiple stocks side-by-side."""
    try:
        results = []
        for sym in req.symbols[:3]:  # max 3
            ticker_sym, full_name = get_ticker(sym)
            stock = yf.Ticker(ticker_sym)
            info = safe_yf_call(lambda: stock.info, default={})
            full_name = info.get('longName') or info.get('shortName') or full_name

            end_date = datetime.date.today()
            start_date = end_date - datetime.timedelta(days=365)
            df = yf.download(ticker_sym, start=start_date, end=end_date, auto_adjust=True, progress=False)

            if df.empty:
                continue

            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            close_s = df['Close'] if isinstance(df['Close'], pd.Series) else df['Close'].iloc[:, 0]
            daily_ret = close_s.pct_change().dropna()

            # Normalize prices to % gain from start
            norm = ((close_s / close_s.iloc[0]) - 1) * 100
            chart = [{"date": d.strftime("%Y-%m-%d"), "gain": round(float(v), 2)}
                     for d, v in zip(norm.index, norm.values) if not np.isnan(v)]

            results.append({
                "symbol": ticker_sym,
                "name": full_name,
                "current_price": round(float(close_s.iloc[-1]), 2),
                "ytd_return": round(float(norm.iloc[-1]), 2),
                "pe": info.get('trailingPE', 'N/A'),
                "market_cap": info.get('marketCap', 'N/A'),
                "sector": info.get('sector', 'N/A'),
                "chart": chart,
            })
        return results
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
def health():
    return {"status": "ok", "gemini": bool(gemini_client)}
