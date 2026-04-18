import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts';
import './index.css';

const API = 'https://ai-stock-analyzer-6js4.onrender.com';

// ── Helpers ──────────────────────────────────────────────────────
const fmt = (v, pre = '$', suf = '') => {
  if (v === null || v === undefined || v === 'N/A') return 'N/A';
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  if (Math.abs(n) >= 1e12) return `${pre}${(n / 1e12).toFixed(2)}T${suf}`;
  if (Math.abs(n) >= 1e9) return `${pre}${(n / 1e9).toFixed(2)}B${suf}`;
  if (Math.abs(n) >= 1e6) return `${pre}${(n / 1e6).toFixed(2)}M${suf}`;
  return `${pre}${n.toFixed(2)}${suf}`;
};

const pct = v => (v === 'N/A' || v == null) ? 'N/A' : `${(parseFloat(v) * 100).toFixed(2)}%`;

const parseVerdict = text => {
  if (!text) return 'ANALYZING';
  if (text.includes('**BUY**') || text.includes('VERDICT\nBUY') || /verdict.*buy/i.test(text)) return 'BUY';
  if (text.includes('**SELL**') || /verdict.*sell/i.test(text)) return 'SELL';
  if (text.includes('**HOLD**') || /verdict.*hold/i.test(text)) return 'HOLD';
  if (text.toUpperCase().includes('BUY')) return 'BUY';
  if (text.toUpperCase().includes('SELL')) return 'SELL';
  if (text.toUpperCase().includes('HOLD')) return 'HOLD';
  return 'ANALYZING';
};

const verdictEmoji = { BUY: '🚀', SELL: '🔴', HOLD: '⚖️', ANALYZING: '🤖' };

// Simple markdown-ish renderer
const MarkdownText = ({ text }) => {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="ai-content">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) return <h2 key={i}>{line.replace('## ', '')}</h2>;
        if (line.startsWith('# ')) return <h2 key={i}>{line.replace('# ', '')}</h2>;
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <ul key={i}>
              <li dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
            </ul>
          );
        }
        if (line.trim() === '') return <br key={i} />;
        return (
          <p key={i} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
        );
      })}
    </div>
  );
};

// ── Custom Tooltip ────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(16,20,30,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 16px', fontSize: '0.85rem' }}>
      <div style={{ color: '#6E7A9A', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#00D4FF', fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
};

// ── RSI Bar ───────────────────────────────────────────────────────
const RSIBar = ({ value }) => {
  const pctVal = Math.min(Math.max(value, 0), 100);
  const cls = pctVal > 70 ? 'rsi-overbought' : pctVal < 30 ? 'rsi-oversold' : 'rsi-neutral';
  return (
    <div className="rsi-indicator">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: '0.8rem', color: '#6E7A9A', textTransform: 'uppercase', letterSpacing: 1 }}>RSI (14)</span>
        <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{value.toFixed(1)}</span>
      </div>
      <div className="rsi-bar-wrap">
        <div className={`rsi-bar ${cls}`} style={{ width: `${pctVal}%` }} />
      </div>
      <div className="rsi-labels">
        <span style={{ color: '#00E676' }}>Oversold &lt;30</span>
        <span>Neutral 30–70</span>
        <span style={{ color: '#FF4444' }}>Overbought &gt;70</span>
      </div>
    </div>
  );
};

// ── COMPARE SECTION ───────────────────────────────────────────────
const CompareColors = ['#9D50BB', '#00D4FF', '#00E676'];

function CompareSection() {
  const [inputs, setInputs] = useState(['', '', '']);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const run = async () => {
    const syms = inputs.map(s => s.trim()).filter(Boolean);
    if (syms.length < 2) { setErr('Enter at least 2 stocks to compare.'); return; }
    setLoading(true); setErr(null);
    try {
      const r = await axios.post(`${API}/api/compare`, { symbols: syms });
      setResults(r.data);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Compare failed.');
    } finally { setLoading(false); }
  };

  // Build combined chart
  const combined = results?.length > 0
    ? results[0].chart.map(pt => {
        const row = { date: pt.date };
        results.forEach(s => {
          const found = s.chart.find(c => c.date === pt.date);
          if (found) row[s.symbol] = found.gain;
        });
        return row;
      })
    : [];

  return (
    <section id="compare" style={{ marginBottom: 32 }}>
      <div className="section-head">
        <div className="section-icon">⚖️</div>
        <h2>Compare Stocks</h2>
      </div>

      <div className="card">
        <div className="compare-inputs">
          {inputs.map((v, i) => (
            <input
              key={i}
              className="compare-input"
              placeholder={`Stock ${i + 1} (e.g. AAPL)`}
              value={v}
              onChange={e => setInputs(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
            />
          ))}
          <button className="btn btn-primary" onClick={run} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Compare'}
          </button>
        </div>

        {err && <div className="error-box">{err}</div>}

        {results && results.length > 0 && (
          <>
            <div style={{ height: 280, marginBottom: 28 }}>
              <div className="chart-title">📈 Relative Performance (1 Year)</div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={combined}>
                  <XAxis dataKey="date" stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} minTickGap={40} />
                  <YAxis tickFormatter={v => `${v.toFixed(0)}%`} stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                  <Legend wrapperStyle={{ fontSize: '0.85rem', paddingTop: 12 }} />
                  {results.map((s, i) => (
                    <Line key={s.symbol} type="monotone" dataKey={s.symbol} stroke={CompareColors[i]}
                      dot={false} strokeWidth={2} name={s.symbol} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <table className="compare-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Price</th>
                  <th>1Y Return</th>
                  <th>P/E Ratio</th>
                  <th>Market Cap</th>
                  <th>Sector</th>
                </tr>
              </thead>
              <tbody>
                {results.map((s, i) => (
                  <tr key={s.symbol}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: CompareColors[i] }} />
                        <div>
                          <div style={{ fontWeight: 700 }}>{s.symbol}</div>
                          <div style={{ fontSize: '0.78rem', color: '#6E7A9A' }}>{s.name}</div>
                        </div>
                      </div>
                    </td>
                    <td>${s.current_price?.toFixed(2)}</td>
                    <td style={{ color: s.ytd_return >= 0 ? '#00E676' : '#FF4444', fontWeight: 700 }}>
                      {s.ytd_return >= 0 ? '+' : ''}{s.ytd_return?.toFixed(2)}%
                    </td>
                    <td>{fmt(s.pe, '')}</td>
                    <td>{fmt(s.market_cap)}</td>
                    <td style={{ color: '#6E7A9A', fontSize:'0.85rem' }}>{s.sector}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('price');
  const searchRef = useRef(null);
  const acTimer = useRef(null);

  // Autocomplete
  useEffect(() => {
    if (!query || query.length < 1) { setSuggestions([]); return; }
    clearTimeout(acTimer.current);
    acTimer.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/api/search`, { params: { q: query } });
        setSuggestions(r.data || []);
        setShowSugg(true);
      } catch { setSuggestions([]); }
    }, 280);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowSugg(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const analyze = useCallback(async (name) => {
    if (!name) return;
    setQuery(name);
    setShowSugg(false);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await axios.post(`${API}/api/analyze`, { company_name: name, enable_agent: true });
      setData(r.data);
      setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to fetch data. Try again.');
    } finally { setLoading(false); }
  }, []);

  const onSubmit = e => { e.preventDefault(); analyze(query); };

  const verdict = data ? parseVerdict(data.analysis) : null;
  const priceChange = data ? (() => {
    const first = data.chart_data[0]?.price;
    const last = data.chart_data[data.chart_data.length - 1]?.price;
    return first ? ((last - first) / first * 100) : 0;
  })() : 0;

  return (
    <>
      {/* Navbar */}
      <nav className="navbar">
        <span className="nav-logo">⚡ AI Stock Analyzer</span>
        <div className="nav-links">
          <a href="#results">Dashboard</a>
          <a href="#overview">Company</a>
          <a href="#compare">Compare</a>
        </div>
      </nav>

      <div className="page">

        {/* Hero + Search */}
        <div className="hero">
          <div className="hero-badge"><span />AI-Powered • Real-time • Free</div>
          <h1>Analyze Any Stock<br />with AI in Seconds</h1>
          <p className="hero-sub">Search any company. Get live price charts, technical indicators, financials, and a full AI verdict instantly.</p>

          <div className="search-wrapper" ref={searchRef}>
            <form onSubmit={onSubmit}>
              <div className="search-row">
                <div className="search-icon-wrap">
                  <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                </div>
                <input
                  className="search-input"
                  placeholder="Search any company (e.g., Apple, Tata Power)"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSugg(true)}
                  autoComplete="off"
                />
                <button type="submit" className="search-btn" disabled={loading}>
                  {loading ? <span className="spinner" /> : 'Analyze'}
                </button>
              </div>
            </form>

            {/* Autocomplete Dropdown */}
            {showSugg && suggestions.length > 0 && (
              <div className="autocomplete-dropdown">
                {suggestions.map((s, i) => (
                  <div key={i} className="ac-item" onClick={() => analyze(s.name || s.symbol)}>
                    <div>
                      <div className="ac-name">{s.name}</div>
                      <div className="ac-exchange">{s.exchange} · {s.type}</div>
                    </div>
                    <div className="ac-symbol">{s.symbol}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="error-box" style={{ maxWidth: 600, margin: '16px auto 0' }}>⚠️ {error}</div>}
        </div>

        {/* ── Results ── */}
        {data && (
          <div id="results">

            {/* Ticker Header */}
            <div className="ticker-header">
              <div className="ticker-logo">
                {data.company_info?.logo_url
                  ? <img src={data.company_info.logo_url} alt={data.name} onError={e => e.target.style.display = 'none'} />
                  : data.symbol?.slice(0, 2)}
              </div>
              <div className="ticker-name">
                <h2>{data.name}</h2>
                <span>{data.symbol} · {data.company_info?.exchange} · {data.company_info?.sector}</span>
              </div>
              <div className="ticker-price-block">
                <div className={`ticker-price ${priceChange >= 0 ? 'price-up' : 'price-dn'}`}>
                  ${data.metrics.current_price?.toFixed(2)}
                </div>
                <div style={{ fontSize: '0.9rem', color: priceChange >= 0 ? '#00E676' : '#FF4444', fontWeight: 600, marginTop: 4 }}>
                  {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}% (200d)
                </div>
              </div>
            </div>

            {/* Metrics Row */}
            <div className="metrics-grid">
              {[
                { label: '52W High', val: `$${data.metrics.high_52w?.toFixed(2)}` },
                { label: '52W Low', val: `$${data.metrics.low_52w?.toFixed(2)}` },
                { label: 'Volatility', val: pct(data.metrics.volatility), cls: data.metrics.volatility > 0.4 ? 'red' : 'gold' },
                { label: 'RSI (14)', val: data.metrics.rsi?.toFixed(1), cls: data.metrics.rsi > 70 ? 'red' : data.metrics.rsi < 30 ? 'green' : '' },
                { label: 'P/E Ratio', val: fmt(data.metrics.pe, '') },
                { label: 'Market Cap', val: fmt(data.metrics.market_cap) },
                { label: 'EPS', val: fmt(data.metrics.eps, '$') },
                { label: 'Dividend Yield', val: pct(data.metrics.dividend_yield) },
                { label: 'Beta', val: data.metrics.beta !== 'N/A' ? parseFloat(data.metrics.beta).toFixed(2) : 'N/A', cls: parseFloat(data.metrics.beta) > 1.5 ? 'red' : '' },
                { label: 'Revenue Growth', val: pct(data.metrics.revenue_growth), cls: parseFloat(data.metrics.revenue_growth) > 0 ? 'green' : 'red' },
                { label: 'Profit Margin', val: pct(data.metrics.profit_margin), cls: parseFloat(data.metrics.profit_margin) > 0 ? 'green' : 'red' },
                { label: 'Avg Volume', val: fmt(data.metrics.volume, '') },
              ].map(({ label, val, cls }, i) => (
                <div className="metric-card" key={i}>
                  <div className="metric-label">{label}</div>
                  <div className={`metric-value ${cls || ''}`}>{val}</div>
                </div>
              ))}
            </div>

            {/* Charts Section */}
            <div className="section-head">
              <div className="section-icon">📊</div>
              <h2>Price & Technical Charts</h2>
            </div>

            {/* Tab Nav */}
            <div className="tab-nav">
              {[['price', '📈 Price'], ['volume', '📊 Volume'], ['rsi', '🔬 RSI']].map(([k, label]) => (
                <button key={k} className={`tab-btn ${activeTab === k ? 'active' : ''}`} onClick={() => setActiveTab(k)}>
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'price' && (
              <div className="chart-card" style={{ marginBottom: 24 }}>
                <div className="chart-title">{data.name} — Price History (200 Days)</div>
                <div style={{ height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.chart_data}>
                      <defs>
                        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} minTickGap={30} />
                      <YAxis domain={['auto', 'auto']} stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="price" stroke="#00D4FF" strokeWidth={2} fillOpacity={1} fill="url(#pg)" name="Price ($)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeTab === 'volume' && (
              <div className="chart-card" style={{ marginBottom: 24 }}>
                <div className="chart-title">{data.name} — Trading Volume (200 Days)</div>
                <div style={{ height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.chart_data}>
                      <XAxis dataKey="date" stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} minTickGap={30} />
                      <YAxis tickFormatter={v => fmt(v, '')} stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="volume" fill="#9D50BB" opacity={0.8} name="Volume" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeTab === 'rsi' && (
              <div className="chart-card" style={{ marginBottom: 24 }}>
                <div className="chart-title">{data.name} — RSI (14-Day) Indicator</div>
                <div style={{ height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.chart_data}>
                      <XAxis dataKey="date" stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} minTickGap={30} />
                      <YAxis domain={[0, 100]} stroke="#6E7A9A" tick={{ fill: '#6E7A9A', fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine y={70} stroke="#FF4444" strokeDasharray="5 5" label={{ value: 'Overbought 70', fill: '#FF4444', fontSize: 11 }} />
                      <ReferenceLine y={30} stroke="#00E676" strokeDasharray="5 5" label={{ value: 'Oversold 30', fill: '#00E676', fontSize: 11 }} />
                      <Line type="monotone" dataKey="rsi" stroke="#F7971E" strokeWidth={2} dot={false} name="RSI" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* AI Verdict + Analysis */}
            <div className="section-head" style={{ marginTop: 8 }}>
              <div className="section-icon">🤖</div>
              <h2>AI Agent Insights</h2>
            </div>

            <div className="ai-grid">
              {/* Verdict Box */}
              <div className={`verdict-box verdict-${verdict}`}>
                <div className="verdict-label">AI Verdict</div>
                <div className="verdict-emoji">{verdictEmoji[verdict]}</div>
                <div className="verdict-text">{verdict}</div>
                <RSIBar value={data.metrics.rsi} />
              </div>

              {/* Full Analysis */}
              <div className="ai-analysis-card">
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1, color: '#6E7A9A', marginBottom: 16 }}>
                  🔬 Full AI Analysis — {data.name} ({data.symbol})
                </div>
                <MarkdownText text={data.analysis} />
              </div>
            </div>

            {/* Company Overview */}
            <div id="overview" className="section-head" style={{ marginTop: 8 }}>
              <div className="section-icon">🏢</div>
              <h2>Company Overview</h2>
            </div>

            <div className="overview-grid card" style={{ marginBottom: 32 }}>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1, color: '#6E7A9A', marginBottom: 16 }}>
                  About {data.name}
                </div>
                <p className="overview-summary">{data.company_info?.summary || 'No company overview available.'}</p>
              </div>

              <div className="overview-facts">
                {[
                  ['Sector', data.company_info?.sector],
                  ['Industry', data.company_info?.industry],
                  ['Country', data.company_info?.country],
                  ['Employees', data.company_info?.employees !== 'N/A' ? parseInt(data.company_info?.employees)?.toLocaleString() : 'N/A'],
                  ['CEO', data.company_info?.ceo],
                  ['Website', data.company_info?.website
                    ? <a href={data.company_info.website} target="_blank" rel="noreferrer">🌐 Visit</a>
                    : 'N/A'],
                ].map(([label, val], i) => (
                  <div className="fact-row" key={i}>
                    <span className="fact-label">{label}</span>
                    <span className="fact-value">{val || 'N/A'}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* Compare Stocks Section — always visible */}
        <CompareSection />

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#6E7A9A', fontSize: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          ⚡ AI Stock Analyzer · Data from Yahoo Finance · AI by Google Gemini · Not financial advice.
        </div>
      </div>
    </>
  );
}
