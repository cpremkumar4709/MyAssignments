# MyAssignments

## 🇮🇳 Indian Market Signal Dashboard (trading-app)

A live **Buy & Sell Signal** web application for Indian stock market indices — **Nifty 50**, **Bank Nifty**, and **Sensex**. Generates trading signals with confidence percentages based on multiple technical analysis indicators.

### Features

- **Indian Market Indices** — Nifty 50 (NSE), Bank Nifty (NSE), Sensex (BSE)
- **Live Market Data** — Real-time index levels from Yahoo Finance API
- **Market Status Indicator** — Shows whether NSE/BSE is Open, Closed, or in Pre-Open session (IST timezone)
- **Buy / Sell Buttons** — Large, visual buttons showing confidence percentages (up to 99%)
- **7 Technical Indicators** calculated in real time:
  - RSI (Relative Strength Index)
  - MACD (Moving Average Convergence Divergence)
  - EMA Crossover (9/21)
  - Bollinger Bands
  - Stochastic Oscillator
  - Price vs SMA (30)
  - Volume Trend Analysis
- **Signal Strength Meter** — Visual gauge from Strong Sell to Strong Buy
- **Auto-Refresh** — Data updates every 60 seconds
- **INR Currency Formatting** — Prices displayed in ₹ with Indian numbering (Lakhs, Crores)
- **Responsive Design** — Works on desktop and mobile
- **Dark Theme** — Professional trading-style UI

### How to Use

1. Open `trading-app/index.html` in any modern web browser
2. Select an index from the dropdown (Nifty 50, Bank Nifty, or Sensex)
3. View the buy/sell signal and confidence percentage
4. Check individual technical indicators for detailed analysis
5. Click the Buy or Sell button to see the current recommendation

### ⚠️ Disclaimer

This tool is for **educational and informational purposes only**. Trading signals are based on technical analysis indicators and do not guarantee future results. This is NOT SEBI-registered investment advice. Always do your own research (DYOR) before making any trading decisions.