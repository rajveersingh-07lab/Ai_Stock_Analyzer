import React, { useState } from 'react';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, BrainCircuit, Activity, TrendingUp, AlertTriangle } from 'lucide-react';
import './index.css';

function App() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchAnalysis = async (e) => {
    e.preventDefault();
    if (!query) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post('https://ai-stock-analyzer-6js4.onrender.com/api/analyze', {
        company_name: query,
        enable_agent: true
      });
      setData(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch data.');
    } finally {
      setLoading(false);
    }
  };

  const parseVerdict = (text) => {
    if (text.includes('BUY')) return 'BUY';
    if (text.includes('SELL')) return 'SELL';
    if (text.includes('HOLD')) return 'HOLD';
    return 'ANALYZING';
  };

  return (
    <div className="app-container">
      <div className="search-container">
        <h1 className="search-title">AI Stock Analyzer</h1>
        <form className="search-box" onSubmit={fetchAnalysis}>
          <input 
            type="text" 
            className="search-input"
            placeholder="Search any company (e.g., Apple, Tesla)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? <span className="loading-spinner"></span> : 'Analyze'}
          </button>
        </form>
        {error && <p style={{ color: 'var(--sell-red)', marginTop: '10px' }}>{error}</p>}
      </div>

      {data && (
        <>
          <div className="metrics-grid">
            <div className="glass-panel metric-card">
              <span className="metric-label">Current Price</span>
              <span className="metric-value">${data.metrics.current_price?.toFixed(2)}</span>
            </div>
            <div className="glass-panel metric-card">
              <span className="metric-label">52W High</span>
              <span className="metric-value">${data.metrics.high_52w?.toFixed(2)}</span>
            </div>
            <div className="glass-panel metric-card">
              <span className="metric-label">Volatility</span>
              <span className="metric-value">{data.metrics.volatility ? (data.metrics.volatility * 100).toFixed(2) + '%' : 'N/A'}</span>
            </div>
            <div className="glass-panel metric-card">
              <span className="metric-label">RSI (14)</span>
              <span className="metric-value" style={{ color: data.metrics.rsi > 70 ? 'var(--sell-red)' : data.metrics.rsi < 30 ? 'var(--buy-green)' : 'inherit' }}>
                {data.metrics.rsi?.toFixed(1)}
              </span>
            </div>
          </div>

          <div className="content-grid">
            <div className="glass-panel chart-container">
              <div className="chart-header">
                <h3 className="chart-title">{data.name} ({data.symbol})</h3>
                <TrendingUp color="var(--accent-secondary)" />
              </div>
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.chart_data}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent-secondary)" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="var(--accent-secondary)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} minTickGap={30} />
                    <YAxis domain={['auto', 'auto']} stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--panel-border)', borderRadius: '8px' }}
                      itemStyle={{ color: 'var(--accent-secondary)' }}
                    />
                    <Area type="monotone" dataKey="price" stroke="var(--accent-secondary)" fillOpacity={1} fill="url(#colorPrice)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-panel ai-insights">
              <div className="ai-header">
                <BrainCircuit /> AI Agent Insights
              </div>
              
              <div className={`ai-verdict verdict-${parseVerdict(data.analysis)}`}>
                {parseVerdict(data.analysis)}
              </div>

              <div className="ai-analysis-text">
                {data.analysis}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
