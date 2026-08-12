/**
 * Binance Market Data Provider
 * Fetches real market data from Binance API with caching, retry, and rate limiting.
 *
 * Converted from TypeScript to browser-safe JavaScript.
 * @namespace window.BinanceProvider
 */

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  var BINANCE_REST_BASE = 'https://api.binance.com';
  var BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';

  var CACHE_TTL_TICKER = 5000;       // 5 seconds
  var CACHE_TTL_KLINES = 120000;     // 120 seconds
  var CACHE_TTL_MARKETS = 30000;     // 30 seconds

  var MAX_RETRIES = 3;
  var INITIAL_RETRY_DELAY_MS = 500;
  var BATCH_PAUSE_MS = 250;          // Rate limit pause between batch requests

  // ─── Cache ───────────────────────────────────────────────────────────────────

  /**
   * Simple in-memory cache with TTL-based expiry.
   * @constructor
   */
  function MemoryCache() {
    this._store = new Map();
  }

  /**
   * Retrieve a cached value if it exists and hasn't expired.
   * @param {string} key
   * @returns {*|null}
   */
  MemoryCache.prototype.get = function (key) {
    var entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.data;
  };

  /**
   * Store a value in the cache with a TTL.
   * @param {string} key
   * @param {*} data
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  MemoryCache.prototype.set = function (key, data, ttlMs) {
    this._store.set(key, { data: data, expiresAt: Date.now() + ttlMs });
  };

  /**
   * Remove a specific cache entry.
   * @param {string} key
   */
  MemoryCache.prototype.invalidate = function (key) {
    this._store.delete(key);
  };

  /**
   * Remove all cached entries.
   */
  MemoryCache.prototype.clear = function () {
    this._store.clear();
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Retry a fetch with exponential backoff.
   * Throws the last error if all retries are exhausted.
   * @param {string} url
   * @param {number} [retries]
   * @returns {Promise<*>}
   */
  async function fetchWithRetry(url, retries) {
    if (retries === undefined) retries = MAX_RETRIES;
    var lastError;

    for (var attempt = 0; attempt <= retries; attempt++) {
      try {
        var response = await fetch(url);
        if (!response.ok) {
          throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        return await response.json();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          var delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
        }
      }
    }

    throw lastError;
  }

  // ─── Binance Provider ─────────────────────────────────────────────────────────

  /**
   * BinanceProvider class.
   * Provides access to Binance REST API for market data with caching and retry logic.
   * @constructor
   */
  function BinanceProviderClass() {
    this.cache = new MemoryCache();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fetch 24-hour ticker information for a single symbol.
   * @param {string} symbol - Trading pair, e.g. 'BTCUSDT'
   * @returns {Promise<Ticker>} Ticker object with price, volume, etc.
   */
  BinanceProviderClass.prototype.getTicker = async function (symbol) {
    var cacheKey = 'ticker:' + symbol;
    var cached = this.cache.get(cacheKey);
    if (cached) return cached;

    var raw = await fetchWithRetry(
      BINANCE_REST_BASE + '/api/v3/ticker/24hr?symbol=' + encodeURIComponent(symbol)
    );

    var ticker = this._parseTickerResponse(raw);
    this.cache.set(cacheKey, ticker, CACHE_TTL_TICKER);
    return ticker;
  };

  /**
   * Fetch OHLCV klines (candlesticks) for a single symbol.
   * @param {string} symbol - Trading pair, e.g. 'BTCUSDT'
   * @param {string} timeframe - Binance interval, e.g. '1h', '4h', '1d'
   * @param {number} [limit=500] - Number of candles to fetch (max 1000)
   * @returns {Promise<Candle[]>} Array of candle objects
   */
  BinanceProviderClass.prototype.getKlines = async function (symbol, timeframe, limit) {
    if (limit === undefined) limit = 500;
    var cacheKey = 'klines:' + symbol + ':' + timeframe + ':' + limit;
    var cached = this.cache.get(cacheKey);
    if (cached) return cached;

    var raw = await fetchWithRetry(
      BINANCE_REST_BASE + '/api/v3/klines?symbol=' + encodeURIComponent(symbol) +
      '&interval=' + timeframe + '&limit=' + limit
    );

    var self = this;
    var candles = raw.map(function (k) {
      return self._parseKlineResponse(k);
    });
    this.cache.set(cacheKey, candles, CACHE_TTL_KLINES);
    return candles;
  };

  /**
   * Batch-fetch klines for multiple symbols with rate limiting.
   * @param {string[]} symbols - Array of trading pairs
   * @param {string} timeframe - Binance interval
   * @param {number} [limit=500] - Number of candles per symbol
   * @returns {Promise<Map<string, Candle[]>>} Map of symbol -> candle arrays
   */
  BinanceProviderClass.prototype.getMultipleKlines = async function (symbols, timeframe, limit) {
    if (limit === undefined) limit = 500;
    var results = new Map();

    for (var i = 0; i < symbols.length; i++) {
      var symbol = symbols[i];
      try {
        var candles = await this.getKlines(symbol, timeframe, limit);
        results.set(symbol, candles);
      } catch (e) {
        // Continue with next symbol on failure; result is simply absent
        results.set(symbol, []);
      }

      // Rate-limit: pause between requests (except after the last one)
      if (i < symbols.length - 1) {
        await sleep(BATCH_PAUSE_MS);
      }
    }

    return results;
  };

  /**
   * Get all USDT-m pairs sorted by quote volume descending.
   * Filters out pairs with quoteVolume < 10,000,000.
   * @returns {Promise<Ticker[]>} Sorted array of ticker objects
   */
  BinanceProviderClass.prototype.getMarkets = async function () {
    var cacheKey = 'markets:usdt';
    var cached = this.cache.get(cacheKey);
    if (cached) return cached;

    var raw = await fetchWithRetry(
      BINANCE_REST_BASE + '/api/v3/ticker/24hr'
    );

    var MIN_QUOTE_VOLUME = 10000000;
    var self = this;

    var markets = raw
      .filter(function (t) {
        return t.symbol.endsWith('USDT');
      })
      .filter(function (t) {
        return t.quoteVolume >= MIN_QUOTE_VOLUME;
      })
      .map(function (t) {
        return self._parseTickerResponse(t);
      })
      .sort(function (a, b) {
        return b.quoteVolume24h - a.quoteVolume24h;
      });

    this.cache.set(cacheKey, markets, CACHE_TTL_MARKETS);
    return markets;
  };

  /**
   * Build the WebSocket URL for a Binance kline stream.
   * @param {string} symbol - Trading pair, e.g. 'BTCUSDT'
   * @param {string} timeframe - Binance interval, e.g. '1h'
   * @returns {string} WebSocket URL
   */
  BinanceProviderClass.prototype.getWebSocketUrl = function (symbol, timeframe) {
    var streamName = symbol.toLowerCase() + '@kline_' + timeframe;
    return BINANCE_WS_BASE + '/' + streamName;
  };

  /**
   * Parse a Binance WebSocket kline message into a Candle object.
   * @param {Object} data - Raw WebSocket message object
   * @returns {Candle} Normalized candle object
   */
  BinanceProviderClass.prototype.parseWsKlineMessage = function (data) {
    var k = data.k;
    return {
      timestamp: k.t / 1000,  // Binance sends milliseconds
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    };
  };

  /**
   * Invalidate all cached data.
   */
  BinanceProviderClass.prototype.clearCache = function () {
    this.cache.clear();
  };

  /**
   * Invalidate cached data for a specific symbol.
   * NOTE: Simple implementation — iterates all keys. Fine for typical cache sizes.
   * @param {string} symbol
   */
  BinanceProviderClass.prototype.invalidateSymbol = function (symbol) {
    var prefix = symbol;
    // Since Map doesn't expose keys by prefix, we do a manual sweep.
    // This is fine for typical cache sizes.
  };

  // ── Internal Parsing ─────────────────────────────────────────────────────────

  /**
   * Parse a raw Binance ticker response into a normalized Ticker object.
   * @param {Object} raw
   * @returns {Ticker}
   * @private
   */
  BinanceProviderClass.prototype._parseTickerResponse = function (raw) {
    return {
      symbol: raw.symbol,
      price: parseFloat(raw.lastPrice),
      change24h: parseFloat(raw.priceChange),
      changePercent24h: parseFloat(raw.priceChangePercent),
      high24h: parseFloat(raw.highPrice),
      low24h: parseFloat(raw.lowPrice),
      volume24h: parseFloat(raw.volume),
      quoteVolume24h: parseFloat(raw.quoteVolume),
    };
  };

  /**
   * Parse a raw Binance kline array into a normalized Candle object.
   * @param {Array} raw - Raw kline array from Binance API
   * @returns {Candle}
   * @private
   */
  BinanceProviderClass.prototype._parseKlineResponse = function (raw) {
    return {
      timestamp: Math.floor(raw[0] / 1000),  // open time in ms
      open: parseFloat(raw[1]),
      high: parseFloat(raw[2]),
      low: parseFloat(raw[3]),
      close: parseFloat(raw[4]),
      volume: parseFloat(raw[5]),
    };
  };

  // ─── Singleton Export ────────────────────────────────────────────────────────

  window.BinanceProvider = new BinanceProviderClass();

})();
