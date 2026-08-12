/**
 * Pattern Detection Engine
 * Detects candlestick patterns, chart patterns, and market regimes.
 * All detection logic faithfully converted from the TypeScript reference.
 *
 * @namespace window.TradingPatterns
 */

window.TradingPatterns = (function() {
  'use strict';

  // ============================================================
  // Helpers
  // ============================================================

  /** Absolute difference between two numbers */
  function absDiff(a, b) { return Math.abs(a - b); }

  /** Body of a candle (absolute) */
  function body(c) { return absDiff(c.close, c.open); }

  /** Total range of a candle */
  function range(c) { return c.high - c.low; }

  /** Upper wick length */
  function upperWick(c) { return c.high - Math.max(c.open, c.close); }

  /** Lower wick length */
  function lowerWick(c) { return Math.min(c.open, c.close) - c.low; }

  /** Is candle bullish (close > open) */
  function isBullish(c) { return c.close > c.open; }

  /** Is candle bearish (close < open) */
  function isBearish(c) { return c.close < c.open; }

  /** Clamp a value between min and max */
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  /** Simple moving average over an array */
  function sma(values, period) {
    var slice = values.slice(-period);
    if (slice.length === 0) return 0;
    return slice.reduce(function(a, b) { return a + b; }, 0) / slice.length;
  }

  // ============================================================
  // 1. Candlestick Pattern Detection
  // ============================================================

  /**
   * Detect candlestick patterns on the last 5 candles.
   * Patterns detected: Doji, Hammer, Inverted Hammer, Shooting Star,
   * Hanging Man, Bullish/Bearish Engulfing, Morning/Evening Star, Pin Bar.
   *
   * @param {Array} candles - Array of candle objects
   * @returns {Array<{name:string, direction:string, strength:number, index:number, timestamp:number}>}
   */
  function detectCandlestickPatterns(candles) {
    if (candles.length < 5) return [];

    var patterns = [];
    // Analyze the last 5 candles (indices -5 to -1), with focus on the most recent
    var last = candles.slice(-5);
    var c = last[4];       // current candle
    var c1 = last[3];      // previous candle
    var c2 = last[2];      // 2 candles ago
    var c3 = last[1];      // 3 candles ago
    var c4 = last[0];      // 4 candles ago
    var cIdx = candles.length - 1;

    var cRange = range(c);
    if (cRange === 0) return patterns; // degenerate candle

    var cBody = body(c);
    var cUpperWick = upperWick(c);
    var cLowerWick = lowerWick(c);

    // --- Doji ---
    // Body is less than 10% of the total range
    if (cBody / cRange < 0.10) {
      patterns.push({
        name: 'Doji',
        direction: 'neutral',
        strength: 5,
        index: cIdx,
        timestamp: c.timestamp,
      });
    }

    // --- Hammer ---
    // Small body at top, long lower wick, lower wick >= 2x body, upper wick small
    if (
      cLowerWick >= 2 * cBody &&
      cBody / cRange < 0.35 &&
      cUpperWick / cRange < 0.15 &&
      cBody > 0
    ) {
      var recentLows = [c4.low, c3.low, c2.low, c1.low];
      var minRecentLow = Math.min.apply(null, recentLows);
      var isNearBottom = c.low <= minRecentLow * 1.005;

      if (isNearBottom) {
        patterns.push({
          name: 'Hammer',
          direction: 'bullish',
          strength: clamp(Math.round((cLowerWick / cRange) * 10), 4, 8),
          index: cIdx,
          timestamp: c.timestamp,
        });
      }
    }

    // --- Inverted Hammer ---
    if (
      cUpperWick >= 2 * cBody &&
      cBody / cRange < 0.35 &&
      cLowerWick / cRange < 0.15 &&
      cBody > 0
    ) {
      var recentLows = [c4.low, c3.low, c2.low, c1.low];
      var minRecentLow = Math.min.apply(null, recentLows);
      var isNearBottom = c.low <= minRecentLow * 1.005;

      if (isNearBottom) {
        patterns.push({
          name: 'Inverted Hammer',
          direction: 'bullish',
          strength: clamp(Math.round((cUpperWick / cRange) * 8), 3, 7),
          index: cIdx,
          timestamp: c.timestamp,
        });
      }
    }

    // --- Shooting Star ---
    if (
      cUpperWick >= 2 * cBody &&
      cBody / cRange < 0.35 &&
      cLowerWick / cRange < 0.15 &&
      cBody > 0
    ) {
      var recentHighs = [c4.high, c3.high, c2.high, c1.high];
      var maxRecentHigh = Math.max.apply(null, recentHighs);
      var isNearTop = c.high >= maxRecentHigh * 0.995;

      if (isNearTop) {
        patterns.push({
          name: 'Shooting Star',
          direction: 'bearish',
          strength: clamp(Math.round((cUpperWick / cRange) * 10), 4, 8),
          index: cIdx,
          timestamp: c.timestamp,
        });
      }
    }

    // --- Hanging Man ---
    if (
      cLowerWick >= 2 * cBody &&
      cBody / cRange < 0.35 &&
      cUpperWick / cRange < 0.15 &&
      cBody > 0
    ) {
      var recentHighs = [c4.high, c3.high, c2.high, c1.high];
      var maxRecentHigh = Math.max.apply(null, recentHighs);
      var isNearTop = c.high >= maxRecentHigh * 0.995;

      if (isNearTop) {
        patterns.push({
          name: 'Hanging Man',
          direction: 'bearish',
          strength: clamp(Math.round((cLowerWick / cRange) * 8), 3, 7),
          index: cIdx,
          timestamp: c.timestamp,
        });
      }
    }

    // --- Bullish Engulfing ---
    if (
      isBullish(c) &&
      isBearish(c1) &&
      c.close > c1.open &&
      c.open < c1.close
    ) {
      patterns.push({
        name: 'Bullish Engulfing',
        direction: 'bullish',
        strength: 7,
        index: cIdx,
        timestamp: c.timestamp,
      });
    }

    // --- Bearish Engulfing ---
    if (
      isBearish(c) &&
      isBullish(c1) &&
      c.open > c1.close &&
      c.close < c1.open
    ) {
      patterns.push({
        name: 'Bearish Engulfing',
        direction: 'bearish',
        strength: 7,
        index: cIdx,
        timestamp: c.timestamp,
      });
    }

    // --- Morning Star ---
    var c2Range = range(c2);
    var c1Range = range(c1);
    if (
      c2Range > 0 &&
      c1Range > 0 &&
      cRange > 0 &&
      isBearish(c2) && body(c2) / c2Range > 0.6 &&
      body(c1) / c1Range < 0.30 &&
      isBullish(c) && body(c) / cRange > 0.6 &&
      c.close > (c2.open + c2.close) / 2
    ) {
      patterns.push({
        name: 'Morning Star',
        direction: 'bullish',
        strength: 8,
        index: cIdx,
        timestamp: c.timestamp,
      });
    }

    // --- Evening Star ---
    if (
      c2Range > 0 &&
      c1Range > 0 &&
      cRange > 0 &&
      isBullish(c2) && body(c2) / c2Range > 0.6 &&
      body(c1) / c1Range < 0.30 &&
      isBearish(c) && body(c) / cRange > 0.6 &&
      c.close < (c2.open + c2.close) / 2
    ) {
      patterns.push({
        name: 'Evening Star',
        direction: 'bearish',
        strength: 8,
        index: cIdx,
        timestamp: c.timestamp,
      });
    }

    // --- Pin Bar ---
    if (
      cBody / cRange < 0.20 &&
      (cLowerWick / cRange > 0.60 || cUpperWick / cRange > 0.60)
    ) {
      var direction = cLowerWick > cUpperWick ? 'bullish' : 'bearish';
      var wickPct = Math.max(cLowerWick, cUpperWick) / cRange;
      patterns.push({
        name: 'Pin Bar',
        direction: direction,
        strength: clamp(Math.round(wickPct * 10), 5, 9),
        index: cIdx,
        timestamp: c.timestamp,
      });
    }

    return patterns;
  }

  // ============================================================
  // 2. Chart Pattern Detection
  // ============================================================

  /**
   * Find local peaks and valleys in the given slice.
   *
   * @param {Array} candles - Candle array
   * @param {number} [lookaround=3] - Bars on each side to check
   * @returns {{peaks:Array<{index:number, price:number}>, valleys:Array<{index:number, price:number}>}}
   */
  function findSwingPoints(candles, lookaround) {
    lookaround = lookaround || 3;
    var peaks = [];
    var valleys = [];

    for (var i = lookaround; i < candles.length - lookaround; i++) {
      var isPeak = true;
      var isValley = true;
      for (var j = 1; j <= lookaround; j++) {
        if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isPeak = false;
        if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isValley = false;
      }
      if (isPeak) peaks.push({ index: i, price: candles[i].high });
      if (isValley) valleys.push({ index: i, price: candles[i].low });
    }

    return { peaks: peaks, valleys: valleys };
  }

  /**
   * Detect chart patterns: Double Top, Double Bottom,
   * Ascending Triangle, Descending Triangle.
   *
   * @param {Array} candles - Full candle array (needs at least 50 candles)
   * @returns {Array<{type:string, direction:string, confidence:number, startIndex:number, endIndex:number, timestamp:number}>}
   */
  function detectChartPatterns(candles) {
    if (candles.length < 50) return [];

    var patterns = [];
    var slice = candles.slice(-100);
    var offset = candles.length - slice.length;

    var sw = findSwingPoints(slice, 3);

    if (sw.peaks.length < 2 || sw.valleys.length < 2) return patterns;

    // --- Double Top ---
    for (var i = 0; i < sw.peaks.length - 1; i++) {
      var p1 = sw.peaks[i];
      var p2 = sw.peaks[i + 1];
      var priceRange = slice.reduce(function(max, c) { return Math.max(max, c.high); }, 0)
                     - slice.reduce(function(min, c) { return Math.min(min, c.low); }, Infinity);

      var tolerance = priceRange * 0.03;
      if (
        absDiff(p1.price, p2.price) < tolerance &&
        p2.index - p1.index >= 5
      ) {
        var midValleys = sw.valleys.filter(function(v) { return v.index > p1.index && v.index < p2.index; });
        if (midValleys.length >= 1) {
          var dipPrice = Math.min.apply(null, midValleys.map(function(v) { return v.price; }));
          if ((p1.price + p2.price) / 2 - dipPrice > priceRange * 0.01) {
            patterns.push({
              type: 'double_top',
              direction: 'bearish',
              confidence: clamp(80 - Math.round((absDiff(p1.price, p2.price) / tolerance) * 30), 40, 85),
              startIndex: offset + p1.index,
              endIndex: offset + p2.index,
              timestamp: candles[offset + p2.index].timestamp,
            });
          }
        }
      }
    }

    // --- Double Bottom ---
    for (var i = 0; i < sw.valleys.length - 1; i++) {
      var v1 = sw.valleys[i];
      var v2 = sw.valleys[i + 1];
      var priceRange = slice.reduce(function(max, c) { return Math.max(max, c.high); }, 0)
                     - slice.reduce(function(min, c) { return Math.min(min, c.low); }, Infinity);

      var tolerance = priceRange * 0.03;
      if (
        absDiff(v1.price, v2.price) < tolerance &&
        v2.index - v1.index >= 5
      ) {
        var midPeaks = sw.peaks.filter(function(p) { return p.index > v1.index && p.index < v2.index; });
        if (midPeaks.length >= 1) {
          var risePrice = Math.max.apply(null, midPeaks.map(function(p) { return p.price; }));
          if (risePrice - (v1.price + v2.price) / 2 > priceRange * 0.01) {
            patterns.push({
              type: 'double_bottom',
              direction: 'bullish',
              confidence: clamp(80 - Math.round((absDiff(v1.price, v2.price) / tolerance) * 30), 40, 85),
              startIndex: offset + v1.index,
              endIndex: offset + v2.index,
              timestamp: candles[offset + v2.index].timestamp,
            });
          }
        }
      }
    }

    // --- Ascending Triangle ---
    if (sw.peaks.length >= 2 && sw.valleys.length >= 2) {
      var recentPeaks = sw.peaks.slice(-4);
      var recentValleys = sw.valleys.slice(-4);

      if (recentPeaks.length >= 2 && recentValleys.length >= 2) {
        var peakPrices = recentPeaks.map(function(p) { return p.price; });
        var valleyPrices = recentValleys.map(function(v) { return v.price; });

        var peakVariation = (Math.max.apply(null, peakPrices) - Math.min.apply(null, peakPrices)) / sma(peakPrices, peakPrices.length);
        var firstValley = valleyPrices[0];
        var lastValley = valleyPrices[valleyPrices.length - 1];
        var valleyTrend = (lastValley - firstValley) / firstValley;

        if (peakVariation < 0.02 && valleyTrend > 0.01) {
          var allIndices = recentPeaks.concat(recentValleys).map(function(p) { return p.index; });
          patterns.push({
            type: 'ascending_triangle',
            direction: 'bullish',
            confidence: clamp(Math.round((1 - peakVariation / 0.02) * 50 + valleyTrend * 1000), 40, 80),
            startIndex: offset + Math.min.apply(null, allIndices),
            endIndex: offset + Math.max.apply(null, allIndices),
            timestamp: candles[offset + Math.max.apply(null, allIndices)].timestamp,
          });
        }
      }
    }

    // --- Descending Triangle ---
    if (sw.peaks.length >= 2 && sw.valleys.length >= 2) {
      var recentPeaks = sw.peaks.slice(-4);
      var recentValleys = sw.valleys.slice(-4);

      if (recentPeaks.length >= 2 && recentValleys.length >= 2) {
        var peakPrices = recentPeaks.map(function(p) { return p.price; });
        var valleyPrices = recentValleys.map(function(v) { return v.price; });

        var valleyVariation = (Math.max.apply(null, valleyPrices) - Math.min.apply(null, valleyPrices)) / sma(valleyPrices, valleyPrices.length);
        var firstPeak = peakPrices[0];
        var lastPeak = peakPrices[peakPrices.length - 1];
        var peakTrend = (lastPeak - firstPeak) / firstPeak;

        if (valleyVariation < 0.02 && peakTrend < -0.01) {
          var allIndices = recentPeaks.concat(recentValleys).map(function(p) { return p.index; });
          patterns.push({
            type: 'descending_triangle',
            direction: 'bearish',
            confidence: clamp(Math.round((1 - valleyVariation / 0.02) * 50 + Math.abs(peakTrend) * 1000), 40, 80),
            startIndex: offset + Math.min.apply(null, allIndices),
            endIndex: offset + Math.max.apply(null, allIndices),
            timestamp: candles[offset + Math.max.apply(null, allIndices)].timestamp,
          });
        }
      }
    }

    return patterns;
  }

  // ============================================================
  // 3. Market Regime Detection
  // ============================================================

  /**
   * Calculate a simplified ADX (Average Directional Index) from candle data.
   * Returns ADX value, +DI, and -DI.
   *
   * @param {Array} candles - Candle array
   * @param {number} [period=14] - ADX period
   * @returns {{adx:number, plusDI:number, minusDI:number}}
   */
  function calculateADX(candles, period) {
    period = period || 14;
    if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0 };

    var trueRanges = [];
    var plusDMs = [];
    var minusDMs = [];

    for (var i = 1; i < candles.length; i++) {
      var prev = candles[i - 1];
      var curr = candles[i];

      var highDiff = curr.high - prev.high;
      var lowDiff = prev.low - curr.low;

      var plusDM = highDiff > lowDiff && highDiff > 0 ? highDiff : 0;
      var minusDM = lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0;

      var tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );

      trueRanges.push(tr);
      plusDMs.push(plusDM);
      minusDMs.push(minusDM);
    }

    if (trueRanges.length < period) return { adx: 0, plusDI: 0, minusDI: 0 };

    // Smooth using Wilder's smoothing
    var smoothTR = trueRanges.slice(0, period).reduce(function(a, b) { return a + b; }, 0);
    var smoothPlusDM = plusDMs.slice(0, period).reduce(function(a, b) { return a + b; }, 0);
    var smoothMinusDM = minusDMs.slice(0, period).reduce(function(a, b) { return a + b; }, 0);

    for (var i = period; i < trueRanges.length; i++) {
      smoothTR = smoothTR - smoothTR / period + trueRanges[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];
    }

    var plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    var minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

    var diDiff = Math.abs(plusDI - minusDI);
    var diSum = plusDI + minusDI;
    var dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;

    var adx = dx;

    return { adx: adx, plusDI: plusDI, minusDI: minusDI };
  }

  /**
   * Calculate Average True Range (ATR) for volatility measurement.
   *
   * @param {Array} candles - Candle array
   * @param {number} [period=14] - ATR period
   * @returns {number} ATR value
   */
  function calculateATR(candles, period) {
    period = period || 14;
    if (candles.length < 2) return 0;

    var trueRanges = [];
    for (var i = 1; i < candles.length; i++) {
      var prev = candles[i - 1];
      var curr = candles[i];
      var tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trueRanges.push(tr);
    }

    if (trueRanges.length < period) {
      return trueRanges.length > 0
        ? trueRanges.reduce(function(a, b) { return a + b; }, 0) / trueRanges.length
        : 0;
    }

    var atr = trueRanges.slice(0, period).reduce(function(a, b) { return a + b; }, 0);
    for (var i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }
    return atr;
  }

  /**
   * Detect market regime based on ADX, ATR, and price action.
   *
   * Possible regimes: 'high_volatility', 'low_volatility', 'trending_bullish',
   * 'trending_bearish', 'ranging', 'unclear'
   *
   * @param {Array} candles - Full candle array (needs at least 20)
   * @returns {string} Market regime string
   */
  function detectMarketRegime(candles) {
    if (candles.length < 20) return 'unclear';

    var adxResult = calculateADX(candles);
    var atr = calculateATR(candles);
    var currentPrice = candles[candles.length - 1].close;

    // Volatility assessment: compare ATR to price (ATR as % of price)
    var atrPercent = (atr / currentPrice) * 100;

    // Historical ATR percent for comparison (use older half of data)
    var halfLen = Math.floor(candles.length / 2);
    var olderCandles = candles.slice(0, halfLen);
    var olderATR = calculateATR(olderCandles);
    var olderPrice = olderCandles.length > 0 ? olderCandles[olderCandles.length - 1].close : currentPrice;
    var olderATRPercent = (olderATR / olderPrice) * 100;

    var volatilityRatio = olderATRPercent > 0 ? atrPercent / olderATRPercent : 1;

    // Price direction over recent period
    var lookback = Math.min(20, candles.length - 1);
    var startPrice = candles[candles.length - 1 - lookback].close;
    var priceChange = ((currentPrice - startPrice) / startPrice) * 100;

    // High volatility takes precedence
    if (volatilityRatio > 1.8 && atrPercent > 1.5) {
      return 'high_volatility';
    }

    // Low volatility
    if (volatilityRatio < 0.6 && atrPercent < 0.5) {
      return 'low_volatility';
    }

    // Trending assessment using ADX
    if (adxResult.adx > 25) {
      if (adxResult.plusDI > adxResult.minusDI && priceChange > 0.5) {
        return 'trending_bullish';
      }
      if (adxResult.minusDI > adxResult.plusDI && priceChange < -0.5) {
        return 'trending_bearish';
      }
    }

    // ADX < 20 indicates ranging
    if (adxResult.adx < 20) {
      return 'ranging';
    }

    // Between 20-25 ADX: check price direction to break tie
    if (priceChange > 1) return 'trending_bullish';
    if (priceChange < -1) return 'trending_bearish';

    return 'ranging';
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    detectCandlestickPatterns: detectCandlestickPatterns,
    detectChartPatterns: detectChartPatterns,
    detectMarketRegime: detectMarketRegime,
  };

})();
