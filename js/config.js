/**
 * Trading Platform Configuration Constants
 * Centralized configuration for timeframes, symbols, indicator parameters,
 * signal weights, risk management, and scoring thresholds.
 *
 * @namespace window.TradingConfig
 */
window.TradingConfig = {

  // ─── Timeframes ───────────────────────────────────────────────────────────
  /** Supported timeframe options with label, API value, and duration in seconds */
  TIMEFRAMES: [
    { label: '1m',  value: '1m',  seconds: 60 },
    { label: '3m',  value: '3m',  seconds: 180 },
    { label: '5m',  value: '5m',  seconds: 300 },
    { label: '15m', value: '15m', seconds: 900 },
    { label: '30m', value: '30m', seconds: 1800 },
    { label: '1H',  value: '1h',  seconds: 3600 },
    { label: '2H',  value: '2h',  seconds: 7200 },
    { label: '4H',  value: '4h',  seconds: 14400 },
    { label: '6H',  value: '6h',  seconds: 21600 },
    { label: '12H', value: '12h', seconds: 43200 },
    { label: '1D',  value: '1d',  seconds: 86400 },
    { label: '1W',  value: '1w',  seconds: 604800 },
  ],

  // ─── Default Symbols ──────────────────────────────────────────────────────
  /** Default list of Binance USDT trading pairs to scan */
  DEFAULT_SYMBOLS: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
    'LINKUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT',
    'XLMUSDT', 'NEARUSDT', 'AAVEUSDT', 'FILUSDT', 'APTUSDT',
  ],

  // ─── Default Configuration ─────────────────────────────────────────────────
  /** Full default configuration object */
  DEFAULT_CONFIG: {
    indicatorParams: {
      emaPeriods: [9, 20, 50, 100, 200],
      smaPeriods: [20, 50, 100, 200],
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      bollingerPeriod: 20,
      bollingerStdDev: 2,
      atrPeriod: 14,
      stochasticK: 14,
      stochasticD: 3,
      adxPeriod: 14,
      swingLookback: 3,
    },
    signalWeights: {
      trend: 25,
      momentum: 20,
      volume: 15,
      structure: 15,
      priceAction: 15,
      volatility: 10,
    },
    scoreThresholds: {
      noTrade: 40,
      weak: 55,
      watch: 70,
      validSetup: 80,
      strongSignal: 90,
      veryStrong: 100,
    },
    risk: {
      accountBalance: 10000,
      riskPerTrade: 1,
      maxOpenTrades: 5,
      maxDailyLoss: 5,
      minRiskReward: 1.5,
      fee: 0.001,
      slippage: 0.0005,
    },
    defaultSymbol: 'BTCUSDT',
    defaultTimeframe: '1h',
    defaultExchange: 'binance',
    multiTimeframe: {
      higher: '1d',
      trend: '4h',
      setup: '1h',
      entry: '15m',
    },
    ai: {
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
  },

  // ─── Scoring Utilities ─────────────────────────────────────────────────────

  /**
   * Convert a numeric score to a human-readable strength label.
   * @param {number} score - Signal score (0-100)
   * @param {Object} [thresholds] - Optional custom threshold overrides
   * @returns {string} Strength label string
   */
  getScoreStrength: function(score, thresholds) {
    thresholds = thresholds || this.DEFAULT_CONFIG.scoreThresholds;
    if (score >= thresholds.veryStrong)  return 'VERY STRONG SETUP';
    if (score >= thresholds.strongSignal) return 'STRONG SIGNAL';
    if (score >= thresholds.validSetup)  return 'VALID SETUP';
    if (score >= thresholds.watch)       return 'WATCH';
    if (score >= thresholds.weak)        return 'WEAK';
    return 'NO TRADE';
  },

  /**
   * Get a color hex string for a given signal score.
   * Green for strong, yellow for moderate, red for weak/no-trade.
   * @param {number} score - Signal score (0-100)
   * @returns {string} Hex color string
   */
  getScoreColor: function(score) {
    if (score >= 80) return '#34d399';
    if (score >= 70) return '#4ade80';
    if (score >= 55) return '#facc15';
    if (score >= 40) return '#fb923c';
    return '#f87171';
  },

  /**
   * Get a color hex string for a trade direction.
   * @param {string} direction - 'LONG', 'SHORT', 'bullish', 'bearish', etc.
   * @returns {string} Hex color string
   */
  getDirectionColor: function(direction) {
    if (direction === 'LONG' || direction === 'bullish') return '#34d399';
    if (direction === 'SHORT' || direction === 'bearish') return '#f87171';
    return '#a1a1aa';
  },
};
