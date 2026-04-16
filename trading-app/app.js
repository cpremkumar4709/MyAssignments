/**
 * Market Signal Dashboard
 * Fetches live market data and calculates buy/sell signals
 * based on multiple technical analysis indicators.
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    API_BASE: 'https://api.coingecko.com/api/v3',
    REFRESH_INTERVAL_MS: 30000, // Auto-refresh every 30 seconds
    PRICE_HISTORY_DAYS: 30,     // Days of historical data for analysis
};

// ============================================
// State
// ============================================
let state = {
    currentSymbol: 'bitcoin',
    priceHistory: [],
    currentData: null,
    autoRefreshTimer: null,
};

// ============================================
// DOM Elements
// ============================================
const elements = {
    marketSelect: () => document.getElementById('market-select'),
    refreshBtn: () => document.getElementById('refresh-btn'),
    lastUpdated: () => document.getElementById('last-updated'),
    currentPrice: () => document.getElementById('current-price'),
    priceChange: () => document.getElementById('price-change'),
    highPrice: () => document.getElementById('high-price'),
    lowPrice: () => document.getElementById('low-price'),
    volume: () => document.getElementById('volume'),
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
 * Fetch current market data for a given coin.
 */
async function fetchCurrentData(coinId) {
    const url = `${CONFIG.API_BASE}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

/**
 * Fetch price history for technical analysis.
 */
async function fetchPriceHistory(coinId, days) {
    const url = `${CONFIG.API_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
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

    // Calculate signal line (9-period EMA of MACD values)
    // Simplified: use the MACD line value directly
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
    if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(6)}`;
}

function formatVolume(volume) {
    if (volume >= 1e9) return `$${(volume / 1e9).toFixed(2)}B`;
    if (volume >= 1e6) return `$${(volume / 1e6).toFixed(2)}M`;
    if (volume >= 1e3) return `$${(volume / 1e3).toFixed(2)}K`;
    return `$${volume.toFixed(2)}`;
}

function updatePriceDisplay(data) {
    const price = data.market_data.current_price.usd;
    const change24h = data.market_data.price_change_percentage_24h;
    const high24h = data.market_data.high_24h.usd;
    const low24h = data.market_data.low_24h.usd;
    const totalVolume = data.market_data.total_volume.usd;

    elements.currentPrice().textContent = formatPrice(price);

    const changeEl = elements.priceChange();
    const changeSign = change24h >= 0 ? '+' : '';
    changeEl.textContent = `${changeSign}${change24h.toFixed(2)}% (24h)`;
    changeEl.className = `change ${change24h >= 0 ? 'positive' : 'negative'}`;

    elements.highPrice().textContent = formatPrice(high24h);
    elements.lowPrice().textContent = formatPrice(low24h);
    elements.volume().textContent = formatVolume(totalVolume);
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
// Main Data Flow
// ============================================

async function loadMarketData() {
    const coinId = state.currentSymbol;

    try {
        elements.refreshBtn().textContent = '⏳ Loading...';
        elements.refreshBtn().disabled = true;

        // Fetch current data and price history in parallel
        const [currentData, historyData] = await Promise.all([
            fetchCurrentData(coinId),
            fetchPriceHistory(coinId, CONFIG.PRICE_HISTORY_DAYS),
        ]);

        state.currentData = currentData;

        // Extract prices and volumes from history
        const prices = historyData.prices.map(p => p[1]);
        const volumes = historyData.total_volumes.map(v => v[1]);
        state.priceHistory = prices;

        const currentPrice = currentData.market_data.current_price.usd;

        // Update price display
        updatePriceDisplay(currentData);

        // Generate signals
        const signals = generateSignals(prices, volumes, currentPrice);

        // Update all UI components
        updateSignalDisplay(signals);
        updateButtons(signals);
        updateIndicators(signals);
        updateMeter(signals);

        // Update timestamp
        const now = new Date();
        elements.lastUpdated().textContent = `Last updated: ${now.toLocaleTimeString()}`;

    } catch (error) {
        console.error('Error loading market data:', error);
        showError(`Failed to load data: ${error.message}`);
    } finally {
        elements.refreshBtn().textContent = '🔄 Refresh';
        elements.refreshBtn().disabled = false;
    }
}

function startAutoRefresh() {
    if (state.autoRefreshTimer) {
        clearInterval(state.autoRefreshTimer);
    }
    state.autoRefreshTimer = setInterval(loadMarketData, CONFIG.REFRESH_INTERVAL_MS);
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
    elements.marketSelect().addEventListener('change', (e) => {
        state.currentSymbol = e.target.value;
        loadMarketData();
    });

    elements.refreshBtn().addEventListener('click', () => {
        loadMarketData();
    });

    // Buy/Sell button click handlers - show alert with trade info
    elements.buyBtn().addEventListener('click', () => {
        if (!state.currentData) return;
        const price = state.currentData.market_data.current_price.usd;
        const name = state.currentData.name;
        alert(`🟢 BUY Signal for ${name}\nCurrent Price: ${formatPrice(price)}\n\n⚠️ This is not financial advice. Always do your own research.`);
    });

    elements.sellBtn().addEventListener('click', () => {
        if (!state.currentData) return;
        const price = state.currentData.market_data.current_price.usd;
        const name = state.currentData.name;
        alert(`🔴 SELL Signal for ${name}\nCurrent Price: ${formatPrice(price)}\n\n⚠️ This is not financial advice. Always do your own research.`);
    });
}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadMarketData();
    startAutoRefresh();
});
