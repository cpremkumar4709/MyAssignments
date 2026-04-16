/**
 * Indian Market Signal Dashboard
 * Fetches live Nifty 50, Bank Nifty & Sensex data and calculates
 * buy/sell signals based on multiple technical analysis indicators.
 *
 * Dual-refresh strategy:
 *   - Live price: fetched every 1 second (lightweight 1d/1m chart)
 *   - Full analysis: fetched every 30 seconds (3-month daily data)
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    LIVE_REFRESH_MS: 1000,           // Live price every 1 second
    FULL_REFRESH_MS: 30000,          // Full analysis every 30 seconds
    PRICE_HISTORY_RANGE: '3mo',      // 3 months of historical data for indicators
    PRICE_HISTORY_INTERVAL: '1d',    // Daily intervals for indicators
    LIVE_RANGE: '1d',                // 1-day range for live price
    LIVE_INTERVAL: '1m',             // 1-minute candles for near-real-time price
    // CORS proxies to try (in order of preference)
    CORS_PROXIES: [
        'https://corsproxy.io/?url=',
        'https://api.allorigins.win/raw?url=',
    ],
    YAHOO_CHART_BASE: 'https://query1.finance.yahoo.com/v8/finance/chart/',
};

// Index metadata for display
const INDEX_INFO = {
    '^NSEI': { name: 'Nifty 50', exchange: 'NSE', shortName: 'NIFTY' },
    '^NSEBANK': { name: 'Bank Nifty', exchange: 'NSE', shortName: 'BANKNIFTY' },
    '^BSESN': { name: 'Sensex', exchange: 'BSE', shortName: 'SENSEX' },
};

// ============================================
// State
// ============================================
let state = {
    currentSymbol: '^NSEI',
    priceHistory: [],
    currentData: null,
    lastPrice: null,
    lastLiveUpdate: null,
    autoRefreshTimer: null,
    liveTickerTimer: null,
    liveTimerInterval: null,
    isFetchingLive: false,
    isFetchingFull: false,
    workingProxyIndex: 0,
    liveErrorCount: 0,
};

// ============================================
// DOM Elements
// ============================================
const elements = {
    marketSelect: () => document.getElementById('market-select'),
    refreshBtn: () => document.getElementById('refresh-btn'),
    lastUpdated: () => document.getElementById('last-updated'),
    marketStatus: () => document.getElementById('market-status'),
    liveIndicator: () => document.getElementById('live-indicator'),
    liveTimer: () => document.getElementById('live-timer'),
    currentPrice: () => document.getElementById('current-price'),
    priceChange: () => document.getElementById('price-change'),
    highPrice: () => document.getElementById('high-price'),
    lowPrice: () => document.getElementById('low-price'),
    prevClose: () => document.getElementById('prev-close'),
    signalContainer: () => document.getElementById('signal-container'),
    buyBtn: () => document.getElementById('buy-btn'),
    sellBtn: () => document.getElementById('sell-btn'),
    buyConfidence: () => document.getElementById('buy-confidence'),
    sellConfidence: () => document.getElementById('sell-confidence'),
    indicatorsGrid: () => document.getElementById('indicators-grid'),
    meterNeedle: () => document.getElementById('meter-needle'),
    meterValue: () => document.getElementById('meter-value'),
};

// ============================================
// API Functions
// ============================================

/**
 * Fetch chart data from Yahoo Finance via CORS proxy.
 * Returns historical OHLCV data and current quote info.
 */
async function fetchChartData(symbol, range, interval) {
    const encodedSymbol = encodeURIComponent(symbol);
    const yahooUrl = `${CONFIG.YAHOO_CHART_BASE}${encodedSymbol}?range=${range}&interval=${interval}&includePrePost=false`;

    // Try each CORS proxy in sequence
    let lastError = null;
    for (let i = 0; i < CONFIG.CORS_PROXIES.length; i++) {
        const proxyIndex = (state.workingProxyIndex + i) % CONFIG.CORS_PROXIES.length;
        const proxy = CONFIG.CORS_PROXIES[proxyIndex];
        const url = proxy + encodeURIComponent(yahooUrl);

        try {
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' },
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (data.chart && data.chart.result && data.chart.result.length > 0) {
                state.workingProxyIndex = proxyIndex;
                return data.chart.result[0];
            }
            throw new Error('Invalid response structure');
        } catch (err) {
            lastError = err;
        }
    }

    throw new Error(`Failed to fetch data from all sources: ${lastError ? lastError.message : 'Unknown error'}`);
}

/**
 * Fetch only live price (lightweight 1d/1m chart).
 * Returns just the meta with regularMarketPrice and latest candle data.
 */
async function fetchLivePrice(symbol) {
    return fetchChartData(symbol, CONFIG.LIVE_RANGE, CONFIG.LIVE_INTERVAL);
}

// ============================================
// Technical Analysis Functions
// ============================================

/**
 * Calculate Simple Moving Average (SMA).
 */
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Calculate Exponential Moving Average (EMA).
 */
function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = calculateSMA(prices.slice(0, period), period);

    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
}

/**
 * Calculate Relative Strength Index (RSI).
 */
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/**
 * Calculate MACD (Moving Average Convergence Divergence).
 */
function calculateMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);

    if (ema12 === null || ema26 === null) return null;

    const macdLine = ema12 - ema26;

    const macdValues = [];
    const multiplier12 = 2 / 13;
    const multiplier26 = 2 / 27;

    let ema12Running = calculateSMA(prices.slice(0, 12), 12);
    let ema26Running = calculateSMA(prices.slice(0, 26), 26);

    for (let i = 26; i < prices.length; i++) {
        ema12Running = (prices[i] - ema12Running) * multiplier12 + ema12Running;
        ema26Running = (prices[i] - ema26Running) * multiplier26 + ema26Running;
        macdValues.push(ema12Running - ema26Running);
    }

    if (macdValues.length < 9) return { macdLine, signalLine: 0, histogram: macdLine };

    const signalLine = calculateEMA(macdValues, 9);
    const histogram = macdLine - (signalLine || 0);

    return { macdLine, signalLine: signalLine || 0, histogram };
}

/**
 * Calculate Bollinger Bands.
 */
function calculateBollingerBands(prices, period = 20, multiplier = 2) {
    if (prices.length < period) return null;

    const sma = calculateSMA(prices, period);
    const slice = prices.slice(-period);
    const squaredDiffs = slice.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
        upper: sma + multiplier * stdDev,
        middle: sma,
        lower: sma - multiplier * stdDev,
        bandwidth: ((sma + multiplier * stdDev) - (sma - multiplier * stdDev)) / sma * 100,
    };
}

/**
 * Calculate Stochastic Oscillator.
 */
function calculateStochastic(prices, period = 14) {
    if (prices.length < period) return null;

    const slice = prices.slice(-period);
    const high = Math.max(...slice);
    const low = Math.min(...slice);

    if (high === low) return 50;

    const currentPrice = prices[prices.length - 1];
    return ((currentPrice - low) / (high - low)) * 100;
}

/**
 * Calculate Average True Range (ATR) - simplified for daily close prices.
 */
function calculateATR(prices, period = 14) {
    if (prices.length < period + 1) return null;

    const trueRanges = [];
    for (let i = 1; i < prices.length; i++) {
        trueRanges.push(Math.abs(prices[i] - prices[i - 1]));
    }

    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((sum, tr) => sum + tr, 0) / period;
}

/**
 * Calculate Volume Weighted trend.
 */
function analyzeVolumeTrend(volumes) {
    if (!volumes || volumes.length < 10) return null;

    const recentAvg = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
    const olderAvg = volumes.slice(-10, -5).reduce((s, v) => s + v, 0) / 5;

    return {
        trend: recentAvg > olderAvg ? 'increasing' : 'decreasing',
        ratio: olderAvg > 0 ? recentAvg / olderAvg : 1,
    };
}

// ============================================
// Signal Generation
// ============================================

/**
 * Generate trading signals from all indicators.
 * Returns an object with individual signals and overall recommendation.
 */
function generateSignals(prices, volumes, currentPrice) {
    const indicators = [];
    let buyScore = 0;
    let sellScore = 0;
    let totalWeight = 0;

    // 1. RSI Analysis (weight: 20)
    const rsi = calculateRSI(prices);
    if (rsi !== null) {
        const weight = 20;
        totalWeight += weight;
        let signal, description;

        if (rsi < 30) {
            signal = 'buy';
            buyScore += weight * ((30 - rsi) / 30 + 0.5);
            description = 'Oversold - potential reversal upward';
        } else if (rsi > 70) {
            signal = 'sell';
            sellScore += weight * ((rsi - 70) / 30 + 0.5);
            description = 'Overbought - potential reversal downward';
        } else {
            signal = 'neutral';
            if (rsi < 50) buyScore += weight * 0.3;
            else sellScore += weight * 0.3;
            description = 'Neutral range';
        }

        indicators.push({
            name: 'RSI (14)',
            value: rsi.toFixed(2),
            signal,
            description,
        });
    }

    // 2. MACD Analysis (weight: 20)
    const macd = calculateMACD(prices);
    if (macd !== null) {
        const weight = 20;
        totalWeight += weight;
        let signal, description;

        if (macd.histogram > 0 && macd.macdLine > 0) {
            signal = 'buy';
            buyScore += weight * 0.8;
            description = 'Bullish momentum - MACD above signal';
        } else if (macd.histogram < 0 && macd.macdLine < 0) {
            signal = 'sell';
            sellScore += weight * 0.8;
            description = 'Bearish momentum - MACD below signal';
        } else if (macd.histogram > 0) {
            signal = 'buy';
            buyScore += weight * 0.5;
            description = 'Emerging bullish crossover';
        } else {
            signal = 'sell';
            sellScore += weight * 0.5;
            description = 'Emerging bearish crossover';
        }

        indicators.push({
            name: 'MACD',
            value: macd.macdLine.toFixed(2),
            signal,
            description,
        });
    }

    // 3. Moving Average Crossover: EMA 9 vs EMA 21 (weight: 15)
    const ema9 = calculateEMA(prices, 9);
    const ema21 = calculateEMA(prices, 21);
    if (ema9 !== null && ema21 !== null) {
        const weight = 15;
        totalWeight += weight;
        let signal, description;

        if (ema9 > ema21) {
            signal = 'buy';
            const diff = ((ema9 - ema21) / ema21) * 100;
            buyScore += weight * Math.min(0.9, 0.5 + diff / 5);
            description = `EMA9 above EMA21 (+${diff.toFixed(2)}%)`;
        } else {
            signal = 'sell';
            const diff = ((ema21 - ema9) / ema21) * 100;
            sellScore += weight * Math.min(0.9, 0.5 + diff / 5);
            description = `EMA9 below EMA21 (-${diff.toFixed(2)}%)`;
        }

        indicators.push({
            name: 'EMA Cross (9/21)',
            value: `${ema9.toFixed(2)} / ${ema21.toFixed(2)}`,
            signal,
            description,
        });
    }

    // 4. Bollinger Bands (weight: 15)
    const bb = calculateBollingerBands(prices);
    if (bb !== null) {
        const weight = 15;
        totalWeight += weight;
        let signal, description;

        if (currentPrice <= bb.lower) {
            signal = 'buy';
            buyScore += weight * 0.85;
            description = 'Price at lower band - potential bounce';
        } else if (currentPrice >= bb.upper) {
            signal = 'sell';
            sellScore += weight * 0.85;
            description = 'Price at upper band - potential pullback';
        } else {
            const position = (currentPrice - bb.lower) / (bb.upper - bb.lower);
            if (position < 0.4) {
                signal = 'buy';
                buyScore += weight * 0.4;
                description = 'Price in lower zone of bands';
            } else if (position > 0.6) {
                signal = 'sell';
                sellScore += weight * 0.4;
                description = 'Price in upper zone of bands';
            } else {
                signal = 'neutral';
                description = 'Price in middle of bands';
            }
        }

        indicators.push({
            name: 'Bollinger Bands',
            value: `${bb.lower.toFixed(2)} - ${bb.upper.toFixed(2)}`,
            signal,
            description,
        });
    }

    // 5. Stochastic Oscillator (weight: 10)
    const stoch = calculateStochastic(prices);
    if (stoch !== null) {
        const weight = 10;
        totalWeight += weight;
        let signal, description;

        if (stoch < 20) {
            signal = 'buy';
            buyScore += weight * 0.8;
            description = 'Oversold territory';
        } else if (stoch > 80) {
            signal = 'sell';
            sellScore += weight * 0.8;
            description = 'Overbought territory';
        } else {
            signal = 'neutral';
            if (stoch < 50) buyScore += weight * 0.2;
            else sellScore += weight * 0.2;
            description = 'Neutral range';
        }

        indicators.push({
            name: 'Stochastic (14)',
            value: stoch.toFixed(2),
            signal,
            description,
        });
    }

    // 6. Price vs SMA 30 (weight: 10)
    const sma30 = calculateSMA(prices, Math.min(prices.length, 30));
    if (sma30 !== null) {
        const weight = 10;
        totalWeight += weight;
        let signal, description;
        const diff = ((currentPrice - sma30) / sma30) * 100;

        if (currentPrice > sma30) {
            signal = 'buy';
            buyScore += weight * Math.min(0.8, 0.4 + Math.abs(diff) / 10);
            description = `Price ${diff.toFixed(2)}% above SMA`;
        } else {
            signal = 'sell';
            sellScore += weight * Math.min(0.8, 0.4 + Math.abs(diff) / 10);
            description = `Price ${Math.abs(diff).toFixed(2)}% below SMA`;
        }

        indicators.push({
            name: 'Price vs SMA (30)',
            value: sma30.toFixed(2),
            signal,
            description,
        });
    }

    // 7. Volume Analysis (weight: 10)
    const volumeTrend = analyzeVolumeTrend(volumes);
    if (volumeTrend !== null) {
        const weight = 10;
        totalWeight += weight;
        let signal, description;

        // Combine volume trend with price direction
        const priceDirection = prices[prices.length - 1] > prices[prices.length - 2] ? 'up' : 'down';

        if (volumeTrend.trend === 'increasing' && priceDirection === 'up') {
            signal = 'buy';
            buyScore += weight * 0.7;
            description = 'Rising volume with upward price - bullish';
        } else if (volumeTrend.trend === 'increasing' && priceDirection === 'down') {
            signal = 'sell';
            sellScore += weight * 0.7;
            description = 'Rising volume with downward price - bearish';
        } else if (volumeTrend.trend === 'decreasing' && priceDirection === 'up') {
            signal = 'neutral';
            buyScore += weight * 0.2;
            description = 'Declining volume on rally - weakening';
        } else {
            signal = 'neutral';
            sellScore += weight * 0.2;
            description = 'Declining volume on drop - exhaustion possible';
        }

        indicators.push({
            name: 'Volume Trend',
            value: `${volumeTrend.ratio.toFixed(2)}x`,
            signal,
            description,
        });
    }

    // Calculate overall signal
    const maxPossible = totalWeight;
    const buyPercentage = maxPossible > 0 ? Math.min(99, Math.round((buyScore / maxPossible) * 100)) : 50;
    const sellPercentage = maxPossible > 0 ? Math.min(99, Math.round((sellScore / maxPossible) * 100)) : 50;

    let overallSignal;
    let confidence;

    if (buyPercentage > sellPercentage + 10) {
        overallSignal = 'buy';
        confidence = buyPercentage;
    } else if (sellPercentage > buyPercentage + 10) {
        overallSignal = 'sell';
        confidence = sellPercentage;
    } else {
        overallSignal = 'neutral';
        confidence = Math.max(buyPercentage, sellPercentage);
    }

    return {
        indicators,
        overallSignal,
        confidence,
        buyPercentage,
        sellPercentage,
        meterPosition: maxPossible > 0
            ? ((buyScore - sellScore) / maxPossible + 1) / 2 * 100
            : 50,
    };
}

// ============================================
// UI Update Functions
// ============================================

function formatPrice(price) {
    return '₹' + price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVolume(volume) {
    if (volume >= 1e7) return `${(volume / 1e7).toFixed(2)} Cr`;
    if (volume >= 1e5) return `${(volume / 1e5).toFixed(2)} L`;
    if (volume >= 1e3) return `${(volume / 1e3).toFixed(2)} K`;
    return volume.toFixed(0);
}

/**
 * Check if Indian market is currently open.
 * NSE/BSE trading hours: 9:15 AM - 3:30 PM IST, Mon-Fri.
 */
function getMarketStatus() {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const istMs = utcMs + 5.5 * 3600000;
    const ist = new Date(istMs);

    const day = ist.getDay(); // 0=Sun, 6=Sat
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    const preOpenStart = 9 * 60;       // 9:00 AM
    const marketOpen = 9 * 60 + 15;    // 9:15 AM
    const marketClose = 15 * 60 + 30;  // 3:30 PM

    if (day === 0 || day === 6) {
        return { status: 'closed', text: '🔴 Market Closed (Weekend)' };
    }

    if (timeInMinutes >= preOpenStart && timeInMinutes < marketOpen) {
        return { status: 'pre-open', text: '🟡 Pre-Open Session (9:00 - 9:15 AM IST)' };
    }

    if (timeInMinutes >= marketOpen && timeInMinutes < marketClose) {
        return { status: 'open', text: '🟢 Market Open (9:15 AM - 3:30 PM IST)' };
    }

    return { status: 'closed', text: '🔴 Market Closed' };
}

function updateMarketStatus() {
    const { status, text } = getMarketStatus();
    const badge = elements.marketStatus();
    badge.textContent = text;
    badge.className = `status-badge ${status}`;
}

/**
 * Extract day high from quote candle data.
 */
function extractDayHigh(quote, fallback) {
    if (quote.high) {
        const vals = quote.high.filter(v => v !== null && v !== undefined);
        if (vals.length > 0) return Math.max(...vals);
    }
    return fallback;
}

/**
 * Extract day low from quote candle data.
 */
function extractDayLow(quote, fallback) {
    if (quote.low) {
        const vals = quote.low.filter(v => v !== null && v !== undefined);
        if (vals.length > 0) return Math.min(...vals);
    }
    return fallback;
}

function updatePriceDisplay(meta, quote) {
    const currentPrice = meta.regularMarketPrice;
    const previousClose = meta.previousClose || meta.chartPreviousClose;
    const change = currentPrice - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    // Price flash animation on change
    const priceEl = elements.currentPrice();
    const oldPrice = state.lastPrice;
    priceEl.textContent = formatPrice(currentPrice);

    if (oldPrice !== null && currentPrice !== oldPrice) {
        priceEl.classList.remove('price-flash-up', 'price-flash-down');
        // Force reflow to restart animation
        void priceEl.offsetWidth;
        priceEl.classList.add(currentPrice > oldPrice ? 'price-flash-up' : 'price-flash-down');
    }
    state.lastPrice = currentPrice;

    const changeEl = elements.priceChange();
    const changeSign = change >= 0 ? '+' : '';
    changeEl.textContent = `${changeSign}${change.toFixed(2)} (${changeSign}${changePercent.toFixed(2)}%)`;
    changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;

    elements.highPrice().textContent = formatPrice(extractDayHigh(quote, currentPrice));
    elements.lowPrice().textContent = formatPrice(extractDayLow(quote, currentPrice));
    elements.prevClose().textContent = formatPrice(previousClose);
}

/**
 * Lightweight live-price-only update.
 * Updates price card, change %, and day high/low without regenerating signals.
 */
function updateLivePriceOnly(meta, quote) {
    const currentPrice = meta.regularMarketPrice;
    const previousClose = meta.previousClose || meta.chartPreviousClose;
    const change = currentPrice - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    // Price flash animation on change
    const priceEl = elements.currentPrice();
    const oldPrice = state.lastPrice;
    priceEl.textContent = formatPrice(currentPrice);

    if (oldPrice !== null && currentPrice !== oldPrice) {
        priceEl.classList.remove('price-flash-up', 'price-flash-down');
        void priceEl.offsetWidth;
        priceEl.classList.add(currentPrice > oldPrice ? 'price-flash-up' : 'price-flash-down');
    }
    state.lastPrice = currentPrice;

    const changeEl = elements.priceChange();
    const changeSign = change >= 0 ? '+' : '';
    changeEl.textContent = `${changeSign}${change.toFixed(2)} (${changeSign}${changePercent.toFixed(2)}%)`;
    changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;

    // Update day high/low from the latest 1-minute candles
    elements.highPrice().textContent = formatPrice(extractDayHigh(quote, currentPrice));
    elements.lowPrice().textContent = formatPrice(extractDayLow(quote, currentPrice));
    elements.prevClose().textContent = formatPrice(previousClose);

    // Update stored current data meta for button clicks
    if (state.currentData) {
        state.currentData.meta = meta;
        state.currentData.quote = quote;
    }

    // Update live timer
    state.lastLiveUpdate = Date.now();
    updateLiveTimerDisplay();
}

function updateSignalDisplay(signals) {
    const container = elements.signalContainer();
    const { overallSignal, confidence, buyPercentage, sellPercentage } = signals;

    let signalClass, signalLabel, description;

    if (overallSignal === 'buy') {
        signalClass = 'buy-signal';
        signalLabel = '🟢 BUY SIGNAL';
        description = `Technical indicators suggest a buying opportunity with ${confidence}% confidence`;
    } else if (overallSignal === 'sell') {
        signalClass = 'sell-signal';
        signalLabel = '🔴 SELL SIGNAL';
        description = `Technical indicators suggest a selling opportunity with ${confidence}% confidence`;
    } else {
        signalClass = 'neutral-signal';
        signalLabel = '🟡 HOLD / NEUTRAL';
        description = `Market is neutral. Buy: ${buyPercentage}% | Sell: ${sellPercentage}%`;
    }

    container.className = `signal-container ${signalClass}`;
    container.innerHTML = `
        <div class="signal-text ${overallSignal}">${signalLabel}</div>
        <div class="signal-confidence ${overallSignal}">${confidence}%</div>
        <div class="signal-description">${description}</div>
    `;
}

function updateButtons(signals) {
    const buyBtn = elements.buyBtn();
    const sellBtn = elements.sellBtn();

    buyBtn.disabled = false;
    sellBtn.disabled = false;

    elements.buyConfidence().textContent = `${signals.buyPercentage}% confidence`;
    elements.sellConfidence().textContent = `${signals.sellPercentage}% confidence`;

    // Highlight the recommended action
    buyBtn.classList.remove('active');
    sellBtn.classList.remove('active');

    if (signals.overallSignal === 'buy') {
        buyBtn.classList.add('active');
    } else if (signals.overallSignal === 'sell') {
        sellBtn.classList.add('active');
    }
}

function updateIndicators(signals) {
    const grid = elements.indicatorsGrid();

    grid.innerHTML = signals.indicators.map(ind => `
        <div class="indicator-card">
            <div class="indicator-info">
                <span class="indicator-name">${ind.name}</span>
                <span class="indicator-value">${ind.value}</span>
            </div>
            <div class="indicator-details">
                <span class="indicator-signal ${ind.signal}">${ind.signal}</span>
            </div>
        </div>
    `).join('');
}

function updateMeter(signals) {
    const position = Math.max(5, Math.min(95, signals.meterPosition));
    elements.meterNeedle().style.left = `${position}%`;

    let label;
    if (position < 25) label = 'Strong Sell';
    else if (position < 40) label = 'Sell';
    else if (position < 60) label = 'Neutral';
    else if (position < 75) label = 'Buy';
    else label = 'Strong Buy';

    elements.meterValue().textContent = `${label} (${Math.round(position)}%)`;
}

function showError(message) {
    elements.signalContainer().innerHTML = `
        <div class="signal-loading" style="color: var(--red-light);">
            ❌ ${message}<br>
            <small style="color: var(--text-secondary);">Will retry automatically or click Refresh</small>
        </div>
    `;
}

// ============================================
// Live Timer Display
// ============================================

function updateLiveTimerDisplay() {
    const timerEl = elements.liveTimer();
    if (!state.lastLiveUpdate) {
        timerEl.textContent = 'Waiting for data...';
        return;
    }
    const elapsed = Math.floor((Date.now() - state.lastLiveUpdate) / 1000);
    if (elapsed < 1) {
        timerEl.textContent = 'Updated just now';
    } else if (elapsed === 1) {
        timerEl.textContent = '1 second ago';
    } else if (elapsed < 60) {
        timerEl.textContent = `${elapsed} seconds ago`;
    } else {
        const minutes = Math.floor(elapsed / 60);
        timerEl.textContent = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }
}

// ============================================
// Main Data Flow
// ============================================

/**
 * Full market data load — fetches 3-month history, recalculates all
 * technical indicators, and regenerates signals.
 */
async function loadMarketData() {
    if (state.isFetchingFull) return;
    state.isFetchingFull = true;

    const symbol = state.currentSymbol;
    const indexInfo = INDEX_INFO[symbol];

    try {
        elements.refreshBtn().textContent = '⏳ Loading...';
        elements.refreshBtn().disabled = true;

        // Update market status
        updateMarketStatus();

        // Fetch chart data (includes current price + history)
        const chartResult = await fetchChartData(
            symbol,
            CONFIG.PRICE_HISTORY_RANGE,
            CONFIG.PRICE_HISTORY_INTERVAL
        );

        const meta = chartResult.meta;
        const quote = chartResult.indicators.quote[0];

        // Extract close prices (filter out null values)
        const closePrices = (quote.close || []).filter(p => p !== null && p !== undefined);
        const volumes = (quote.volume || []).filter(v => v !== null && v !== undefined);

        if (closePrices.length < 2) {
            throw new Error('Insufficient price data received');
        }

        state.priceHistory = closePrices;
        state.currentData = { meta, quote, indexInfo };

        const currentPrice = meta.regularMarketPrice;

        // Update price display
        updatePriceDisplay(meta, quote);

        // Generate signals from historical close prices
        const signals = generateSignals(closePrices, volumes, currentPrice);

        // Update all UI components
        updateSignalDisplay(signals);
        updateButtons(signals);
        updateIndicators(signals);
        updateMeter(signals);

        // Update timestamp
        state.lastLiveUpdate = Date.now();
        const now = new Date();
        elements.lastUpdated().textContent = `Full analysis: ${now.toLocaleTimeString()}`;

        // Mark live indicator as active
        const liveEl = elements.liveIndicator();
        liveEl.textContent = '🟢 LIVE';
        liveEl.classList.add('active');

        // Reset error counter on success
        state.liveErrorCount = 0;

    } catch (error) {
        console.error('Error loading market data:', error);
        showError(`Failed to load ${indexInfo.name} data: ${error.message}`);
    } finally {
        elements.refreshBtn().textContent = '🔄 Refresh';
        elements.refreshBtn().disabled = false;
        state.isFetchingFull = false;
    }
}

/**
 * Live price tick — lightweight fetch for near-real-time price update.
 * Runs every 1 second. Skips if a fetch is already in progress.
 */
async function liveTickUpdate() {
    // Skip if another live fetch or full fetch is running
    if (state.isFetchingLive || state.isFetchingFull) return;
    state.isFetchingLive = true;

    const symbol = state.currentSymbol;

    try {
        const chartResult = await fetchLivePrice(symbol);
        const meta = chartResult.meta;
        const quote = chartResult.indicators.quote[0];

        // Update only the price display (no signal regeneration)
        updateLivePriceOnly(meta, quote);

        // Update market status
        updateMarketStatus();

        // Reset error counter on success
        state.liveErrorCount = 0;

        // Mark live as active
        const liveEl = elements.liveIndicator();
        liveEl.textContent = '🟢 LIVE';
        liveEl.classList.add('active');

    } catch (error) {
        state.liveErrorCount++;
        console.warn(`Live tick error (${state.liveErrorCount}):`, error.message);

        // After 5 consecutive errors, show degraded status
        if (state.liveErrorCount >= 5) {
            const liveEl = elements.liveIndicator();
            liveEl.textContent = '🔴 DELAYED';
            liveEl.classList.remove('active');
        }
    } finally {
        state.isFetchingLive = false;
    }
}

// ============================================
// Timers
// ============================================

function startLiveTicker() {
    stopLiveTicker();
    // Immediate first tick
    liveTickUpdate();
    state.liveTickerTimer = setInterval(liveTickUpdate, CONFIG.LIVE_REFRESH_MS);
}

function stopLiveTicker() {
    if (state.liveTickerTimer) {
        clearInterval(state.liveTickerTimer);
        state.liveTickerTimer = null;
    }
}

function startFullRefresh() {
    if (state.autoRefreshTimer) {
        clearInterval(state.autoRefreshTimer);
    }
    state.autoRefreshTimer = setInterval(loadMarketData, CONFIG.FULL_REFRESH_MS);
}

function startLiveTimerDisplay() {
    if (state.liveTimerInterval) {
        clearInterval(state.liveTimerInterval);
    }
    state.liveTimerInterval = setInterval(updateLiveTimerDisplay, 1000);
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
    elements.marketSelect().addEventListener('change', (e) => {
        state.currentSymbol = e.target.value;
        state.lastPrice = null;
        state.liveErrorCount = 0;
        // Full reload on symbol change, then resume live ticker
        loadMarketData().then(() => {
            startLiveTicker();
        });
    });

    elements.refreshBtn().addEventListener('click', () => {
        state.liveErrorCount = 0;
        loadMarketData();
    });

    // Buy/Sell button click handlers - show alert with trade info
    elements.buyBtn().addEventListener('click', () => {
        if (!state.currentData) return;
        const price = state.currentData.meta.regularMarketPrice;
        const name = state.currentData.indexInfo.name;
        alert(`🟢 BUY Signal for ${name}\nCurrent Level: ${formatPrice(price)}\n\n⚠️ This is not SEBI-registered investment advice. Always do your own research.`);
    });

    elements.sellBtn().addEventListener('click', () => {
        if (!state.currentData) return;
        const price = state.currentData.meta.regularMarketPrice;
        const name = state.currentData.indexInfo.name;
        alert(`🔴 SELL Signal for ${name}\nCurrent Level: ${formatPrice(price)}\n\n⚠️ This is not SEBI-registered investment advice. Always do your own research.`);
    });

    // Pause live ticker when tab is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopLiveTicker();
        } else {
            startLiveTicker();
            // Also do a full refresh when coming back
            loadMarketData();
        }
    });
}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    updateMarketStatus();

    // Load full data first, then start live ticker
    loadMarketData().then(() => {
        startLiveTicker();
    });

    // Full analysis refresh every 30 seconds
    startFullRefresh();

    // Live "seconds ago" timer display
    startLiveTimerDisplay();
});
