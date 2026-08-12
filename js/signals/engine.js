/**
 * Signal Scoring Engine
 * Combines indicators, market structure, patterns, and strategies into a final
 * scored Signal object with entry, stop-loss, take-profit levels, and risk/reward.
 *
 * The engine:
 *   1. Calculates all 18 technical indicators
 *   2. Detects market structure (BOS/CHoCH, swings, sweeps)
 *   3. Detects candlestick and chart patterns
 *   4. Detects market regime
 *   5. Runs all 7 trading strategies
 *   6. Scores across 6 categories: Trend, Momentum, Volume, Structure, Price Action, Volatility
 *   7. Detects conflicts between categories
 *   8. Computes final signal with SL/TP/R:R
 *
 * @namespace window.TradingSignalEngine
 * @requires window.TradingConfig
 * @requires window.TradingIndicators
 * @requires window.TradingMarketStructure
 * @requires window.TradingPatterns
 * @requires window.TradingStrategies
 */
window.TradingSignalEngine = (function() {
  'use strict';

  // Shorthand references
  function getIndicators() { return window.TradingIndicators; }
  function getMarketStructure() { return window.TradingMarketStructure; }
  function getPatterns() { return window.TradingPatterns; }
  function getStrategies() { return window.TradingStrategies; }
  function getConfig() { return window.TradingConfig; }

  // ============================================================
  // Indicator format adapter
  // ============================================================

  /**
   * The indicators module returns a *flat* IndicatorResultSet while the
   * strategies expect a *nested* shape (e.g. `ema[9].values[]`).
   * This adapter bridges the two formats.
   *
   * @param {Object} flat - Flat indicator result set from calculateAllIndicators
   * @param {number} rsiPeriod - RSI period for keying
   * @param {number} atrPeriod - ATR period for keying
   * @returns {Object} Adapted indicator set in nested format
   */
  function adaptIndicatorsForStrategies(flat, rsiPeriod, atrPeriod) {
    var wrap = function(arr) { return { values: arr }; };
    var getLatest = getIndicators().getLatestValue;

    var emaAdapted = {};
    var emaKeys = Object.keys(flat.ema);
    for (var i = 0; i < emaKeys.length; i++) {
      emaAdapted[Number(emaKeys[i])] = wrap(flat.ema[emaKeys[i]]);
    }

    var smaAdapted = {};
    var smaKeys = Object.keys(flat.sma);
    for (var i = 0; i < smaKeys.length; i++) {
      smaAdapted[Number(smaKeys[i])] = wrap(flat.sma[smaKeys[i]]);
    }

    var rsiAdapted = {};
    rsiAdapted[rsiPeriod] = wrap(flat.rsi);

    var result = {
      ema: emaAdapted,
      sma: smaAdapted,
      rsi: rsiAdapted,
    };

    result.macd = {
      macd: flat.macd.line,
      signal: flat.macd.signal,
      histogram: flat.macd.histogram,
    };

    result.bollingerBands = {
      upper: flat.bollinger.upper,
      middle: flat.bollinger.middle,
      lower: flat.bollinger.lower,
      width: flat.bollinger.bandwidth,
    };

    result.atr = {};
    result.atr[atrPeriod] = wrap(flat.atr);

    result.stochastic = flat.stochastic;
    result.vwap = wrap(flat.vwap);
    result.obv = wrap(flat.obv);
    result.volumeSma = { 20: wrap(flat.volumeSma) };
    result.cci = wrap(flat.cci);
    result.williamsR = wrap(flat.williamsR);
    result.mfi = wrap(flat.mfi);
    result.adx = flat.adx;
    result.keltnerChannel = flat.keltner;

    result.pivotPoints = {
      pp: getLatest(flat.pivotPoints.pp) || 0,
      r1: getLatest(flat.pivotPoints.r1) || 0,
      r2: getLatest(flat.pivotPoints.r2) || 0,
      r3: getLatest(flat.pivotPoints.r3) || 0,
      s1: getLatest(flat.pivotPoints.s1) || 0,
      s2: getLatest(flat.pivotPoints.s2) || 0,
      s3: getLatest(flat.pivotPoints.s3) || 0,
    };

    result.fibonacciRetracement = {
      levels: [
        { level: 0, price: getLatest(flat.fibonacciRetracement.level0) || 0 },
        { level: 0.236, price: getLatest(flat.fibonacciRetracement.level236) || 0 },
        { level: 0.382, price: getLatest(flat.fibonacciRetracement.level382) || 0 },
        { level: 0.5, price: getLatest(flat.fibonacciRetracement.level500) || 0 },
        { level: 0.618, price: getLatest(flat.fibonacciRetracement.level618) || 0 },
        { level: 0.786, price: getLatest(flat.fibonacciRetracement.level786) || 0 },
        { level: 1.0, price: getLatest(flat.fibonacciRetracement.level1000) || 0 },
      ],
    };

    result.fibonacciExtension = {
      levels: [
        { level: 1.272, price: getLatest(flat.fibonacciExtension.level1272) || 0 },
        { level: 1.618, price: getLatest(flat.fibonacciExtension.level1618) || 0 },
        { level: 2.618, price: getLatest(flat.fibonacciExtension.level2618) || 0 },
        { level: 4.236, price: getLatest(flat.fibonacciExtension.level4236) || 0 },
      ],
    };

    return result;
  }

  // ============================================================
  // Scoring helpers
  // ============================================================

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /** Normalise a raw value in [rawMin, rawMax] to [-100, +100]. */
  function normalise(value, rawMin, rawMax) {
    if (rawMax === rawMin) return 0;
    return ((value - rawMin) / (rawMax - rawMin)) * 200 - 100;
  }

  // ============================================================
  // Category scorers
  // ============================================================

  /** Score the Trend category (25%). */
  function scoreTrend(flat, structure) {
    var r = { score: 0, reasons: [], warnings: [], bullish: [], bearish: [] };
    var getLatest = getIndicators().getLatestValue;

    var close = flat.ema[9] ? (flat.ema[9].find(function(v) { return v !== null; }) || 0) : 0;
    if (close === 0) return r;

    // EMA alignment
    var e9 = getLatest(flat.ema[9]);
    var e20 = getLatest(flat.ema[20]);
    var e50 = getLatest(flat.ema[50]);
    var e200 = getLatest(flat.ema[200]);

    if (e9 !== null && e20 !== null && e50 !== null) {
      if (e200 !== null) {
        if (e9 > e20 && e20 > e50 && e50 > e200) {
          r.score += 40; r.bullish.push('Full bullish EMA alignment'); r.reasons.push('Full bullish EMA alignment (9>20>50>200)');
        } else if (e9 < e20 && e20 < e50 && e50 < e200) {
          r.score -= 40; r.bearish.push('Full bearish EMA alignment'); r.reasons.push('Full bearish EMA alignment (9<20<50<200)');
        }
      }
      if (e9 > e20 && e20 > e50) {
        r.score += 20; if (r.bullish.indexOf('Partial bullish EMA') === -1) r.bullish.push('Partial bullish EMA alignment');
      } else if (e9 < e20 && e20 < e50) {
        r.score -= 20; if (r.bearish.indexOf('Partial bearish EMA') === -1) r.bearish.push('Partial bearish EMA alignment');
      }
      if (close > e9 && close > e20) { r.score += 10; r.bullish.push('Price above short-term EMAs'); }
      else if (close < e9 && close < e20) { r.score -= 10; r.bearish.push('Price below short-term EMAs'); }
    }

    // ADX
    var adxVal = getLatest(flat.adx.adx);
    var plusDI = getLatest(flat.adx.plusDi);
    var minusDI = getLatest(flat.adx.minusDi);
    if (adxVal !== null && adxVal > 20) {
      var trendStrength = clamp((adxVal - 20) / 30, 0, 1);
      if (plusDI !== null && minusDI !== null) {
        if (plusDI > minusDI) {
          r.score += Math.round(trendStrength * 20); r.bullish.push('ADX ' + adxVal.toFixed(1) + ' bullish (+DI > -DI)');
        } else {
          r.score -= Math.round(trendStrength * 20); r.bearish.push('ADX ' + adxVal.toFixed(1) + ' bearish (-DI > +DI)');
        }
      }
      r.reasons.push('ADX ' + adxVal.toFixed(1) + ' - ' + (adxVal > 40 ? 'strong' : adxVal > 25 ? 'moderate' : 'weak') + ' trend');
    } else if (adxVal !== null) {
      r.warnings.push('ADX ' + adxVal.toFixed(1) + ' - no clear trend');
    }

    // Market structure trend
    if (structure.trend === 'bullish') { r.score += 15; r.bullish.push('Structure: bullish trend'); r.reasons.push('Market structure bullish'); }
    else if (structure.trend === 'bearish') { r.score -= 15; r.bearish.push('Structure: bearish trend'); r.reasons.push('Market structure bearish'); }
    else { r.warnings.push('Market structure neutral - no clear trend'); }

    // Price vs 200 EMA
    if (e200 !== null) {
      if (close > e200) { r.score += 5; r.bullish.push('Price above 200 EMA'); }
      else { r.score -= 5; r.bearish.push('Price below 200 EMA'); }
    }

    r.score = clamp(r.score, -100, 100);
    return r;
  }

  /** Score the Momentum category (20%). */
  function scoreMomentum(flat) {
    var r = { score: 0, reasons: [], warnings: [], bullish: [], bearish: [] };
    var getLatest = getIndicators().getLatestValue;

    // RSI
    var rsi = getLatest(flat.rsi);
    if (rsi !== null) {
      if (rsi < 30) { r.score += 25; r.bullish.push('RSI oversold (' + rsi.toFixed(1) + ')'); r.reasons.push('RSI oversold at ' + rsi.toFixed(1)); }
      else if (rsi < 40) { r.score += 10; r.bullish.push('RSI low (' + rsi.toFixed(1) + ')'); }
      else if (rsi > 70) { r.score -= 25; r.bearish.push('RSI overbought (' + rsi.toFixed(1) + ')'); r.reasons.push('RSI overbought at ' + rsi.toFixed(1)); }
      else if (rsi > 60) { r.score -= 10; r.bearish.push('RSI high (' + rsi.toFixed(1) + ')'); }
      else { r.reasons.push('RSI neutral at ' + rsi.toFixed(1)); }
    }

    // MACD
    var macdLine = getLatest(flat.macd.line);
    var macdSignal = getLatest(flat.macd.signal);
    var macdHist = getLatest(flat.macd.histogram);
    var prevHist = null;
    for (var i = flat.macd.histogram.length - 2; i >= 0; i--) {
      if (flat.macd.histogram[i] !== null) { prevHist = flat.macd.histogram[i]; break; }
    }

    if (macdHist !== null) {
      if (macdHist > 0 && prevHist !== null && prevHist <= 0) {
        r.score += 20; r.bullish.push('MACD bullish crossover'); r.reasons.push('MACD bullish crossover');
      } else if (macdHist < 0 && prevHist !== null && prevHist >= 0) {
        r.score -= 20; r.bearish.push('MACD bearish crossover'); r.reasons.push('MACD bearish crossover');
      }
      if (macdHist > 0) { r.score += 10; r.bullish.push('MACD histogram positive'); }
      else if (macdHist < 0) { r.score -= 10; r.bearish.push('MACD histogram negative'); }
      if (prevHist !== null && Math.abs(macdHist) > Math.abs(prevHist)) {
        r.score += macdHist > 0 ? 5 : -5;
      }
    }

    // Stochastic
    var stochK = getLatest(flat.stochastic.k);
    var stochD = getLatest(flat.stochastic.d);
    if (stochK !== null && stochD !== null) {
      if (stochK < 20 && stochD < 20) { r.score += 15; r.bullish.push('Stoch oversold (K=' + stochK.toFixed(1) + ')'); }
      else if (stochK > 80 && stochD > 80) { r.score -= 15; r.bearish.push('Stoch overbought (K=' + stochK.toFixed(1) + ')'); }
      if (stochK > stochD && stochK < 50) { r.score += 5; r.bullish.push('Stoch %K crossed above %D in lower zone'); }
      else if (stochK < stochD && stochK > 50) { r.score -= 5; r.bearish.push('Stoch %K crossed below %D in upper zone'); }
    }

    // CCI
    var cci = getLatest(flat.cci);
    if (cci !== null) {
      if (cci < -100) { r.score += 10; r.bullish.push('CCI oversold (' + cci.toFixed(0) + ')'); }
      else if (cci > 100) { r.score -= 10; r.bearish.push('CCI overbought (' + cci.toFixed(0) + ')'); }
    }

    r.score = clamp(r.score, -100, 100);
    return r;
  }

  /** Score the Volume category (15%). */
  function scoreVolume(flat, candles) {
    var r = { score: 0, reasons: [], warnings: [], bullish: [], bearish: [] };
    var getLatest = getIndicators().getLatestValue;
    if (candles.length < 2) return r;

    var lastCandle = candles[candles.length - 1];
    var volSma = getLatest(flat.volumeSma);
    var currentVol = lastCandle.volume;

    if (volSma !== null && volSma > 0) {
      var volRatio = currentVol / volSma;
      if (volRatio > 2) {
        r.reasons.push('Volume ' + volRatio.toFixed(1) + 'x above average - strong participation');
        if (lastCandle.close > lastCandle.open) { r.score += 25; r.bullish.push('High volume on bullish candle'); }
        else { r.score -= 25; r.bearish.push('High volume on bearish candle'); }
      } else if (volRatio > 1.3) {
        r.reasons.push('Volume ' + volRatio.toFixed(1) + 'x above average');
        if (lastCandle.close > lastCandle.open) { r.score += 15; r.bullish.push('Above-average volume on bullish candle'); }
        else { r.score -= 15; r.bearish.push('Above-average volume on bearish candle'); }
      } else if (volRatio < 0.5) {
        r.warnings.push('Volume below average - low conviction');
        r.score += lastCandle.close > lastCandle.open ? 3 : -3;
      } else {
        r.score += lastCandle.close > lastCandle.open ? 5 : -5;
      }
    }

    // OBV direction
    var obv = flat.obv;
    var obvNow = getLatest(obv);
    var obvPrev = null;
    for (var i = obv.length - 2; i >= 0; i--) { if (obv[i] !== null) { obvPrev = obv[i]; break; } }
    if (obvNow !== null && obvPrev !== null) {
      if (obvNow > obvPrev) { r.score += 10; r.bullish.push('OBV rising'); r.reasons.push('OBV trending higher'); }
      else if (obvNow < obvPrev) { r.score -= 10; r.bearish.push('OBV falling'); r.reasons.push('OBV trending lower'); }
    }

    // MFI
    var mfi = getLatest(flat.mfi);
    if (mfi !== null) {
      if (mfi < 20) { r.score += 10; r.bullish.push('MFI oversold (' + mfi.toFixed(1) + ')'); }
      else if (mfi > 80) { r.score -= 10; r.bearish.push('MFI overbought (' + mfi.toFixed(1) + ')'); }
    }

    r.score = clamp(r.score, -100, 100);
    return r;
  }

  /** Score the Structure category (15%). */
  function scoreStructure(structure) {
    var r = { score: 0, reasons: [], warnings: [], bullish: [], bearish: [] };

    var recentBreaks = structure.structureBreaks.slice(-5);
    for (var i = 0; i < recentBreaks.length; i++) {
      var b = recentBreaks[i];
      if (b.type === 'BOS') {
        if (b.direction === 'bullish') { r.score += 15; r.bullish.push('Bullish BOS'); r.reasons.push('Bullish Break of Structure'); }
        else { r.score -= 15; r.bearish.push('Bearish BOS'); r.reasons.push('Bearish Break of Structure'); }
      } else if (b.type === 'CHoCH') {
        if (b.direction === 'bullish') { r.score += 25; r.bullish.push('Bullish CHoCH'); r.reasons.push('Bullish Change of Character'); }
        else { r.score -= 25; r.bearish.push('Bearish CHoCH'); r.reasons.push('Bearish Change of Character'); }
      }
    }

    if (structure.hh.length > 0) { r.score += 10; r.bullish.push(structure.hh.length + ' Higher High(s)'); r.reasons.push(structure.hh.length + ' Higher High(s) detected'); }
    if (structure.hl.length > 0) { r.score += 10; r.bullish.push(structure.hl.length + ' Higher Low(s)'); r.reasons.push(structure.hl.length + ' Higher Low(s) detected'); }
    if (structure.lh.length > 0) { r.score -= 10; r.bearish.push(structure.lh.length + ' Lower High(s)'); r.reasons.push(structure.lh.length + ' Lower High(s) detected'); }
    if (structure.ll.length > 0) { r.score -= 10; r.bearish.push(structure.ll.length + ' Lower Low(s)'); r.reasons.push(structure.ll.length + ' Lower Low(s) detected'); }

    for (var i = 0; i < structure.liquiditySweeps.slice(-3).length; i++) {
      var sweep = structure.liquiditySweeps.slice(-3)[i];
      if (sweep.sweepType === 'high') { r.score -= 10; r.bearish.push('High-side liquidity sweep'); r.reasons.push('High-side liquidity swept - potential bearish reversal'); }
      else { r.score += 10; r.bullish.push('Low-side liquidity sweep'); r.reasons.push('Low-side liquidity swept - potential bullish reversal'); }
    }

    if (structure.trend === 'bullish') { r.score += 5; }
    else if (structure.trend === 'bearish') { r.score -= 5; }

    r.score = clamp(r.score, -100, 100);
    return r;
  }

  /** Score the Price Action category (15%). */
  function scorePriceAction(candles, patterns, chartPatterns) {
    var r = { score: 0, reasons: [], warnings: [], bullish: [], bearish: [] };

    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (p.direction === 'bullish') {
        r.score += p.strength * 2;
        r.bullish.push(p.name + ' (str ' + p.strength + ')');
        r.reasons.push('Bullish candlestick: ' + p.name);
      } else if (p.direction === 'bearish') {
        r.score -= p.strength * 2;
        r.bearish.push(p.name + ' (str ' + p.strength + ')');
        r.reasons.push('Bearish candlestick: ' + p.name);
      } else {
        r.reasons.push('Neutral candlestick: ' + p.name);
      }
    }

    for (var i = 0; i < chartPatterns.length; i++) {
      var cp = chartPatterns[i];
      var pts = Math.round(cp.confidence * 0.3);
      if (cp.direction === 'bullish') {
        r.score += pts;
        r.bullish.push(cp.type + ' (' + cp.confidence + '%)');
        r.reasons.push('Bullish chart pattern: ' + cp.type);
      } else if (cp.direction === 'bearish') {
        r.score -= pts;
        r.bearish.push(cp.type + ' (' + cp.confidence + '%)');
        r.reasons.push('Bearish chart pattern: ' + cp.type);
      }
    }

    if (candles.length >= 2) {
      var last = candles[candles.length - 1];
      var prev = candles[candles.length - 2];
      var body = Math.abs(last.close - last.open);
      var range = last.high - last.low;

      if (range > 0) {
        var bodyRatio = body / range;
        if (bodyRatio > 0.7) {
          if (last.close > last.open) { r.score += 8; r.bullish.push('Strong bullish candle body'); }
          else { r.score -= 8; r.bearish.push('Strong bearish candle body'); }
        }
      }

      if (last.close > last.open && prev.close < prev.open && last.close > prev.open && last.open < prev.close) {
        r.score += 5; r.bullish.push('Bullish engulfing confirmation');
      } else if (last.close < last.open && prev.close > prev.open && last.open > prev.close && last.close < prev.open) {
        r.score -= 5; r.bearish.push('Bearish engulfing confirmation');
      }
    }

    r.score = clamp(r.score, -100, 100);
    return r;
  }

  /** Score the Volatility category (10%). */
  function scoreVolatility(flat, candles) {
    var r = { score: 0, reasons: [], warnings: [], bullish: [], bearish: [] };
    var getLatest = getIndicators().getLatestValue;
    if (candles.length < 2) return r;

    var close = candles[candles.length - 1].close;
    if (close <= 0) return r;

    var atr = getLatest(flat.atr);
    if (atr !== null) {
      var atrPct = (atr / close) * 100;
      r.reasons.push('ATR ' + atr.toFixed(2) + ' (' + atrPct.toFixed(2) + '% of price)');

      if (atrPct > 0.2 && atrPct < 2) {
        r.score += 10;
      } else if (atrPct >= 2) {
        r.warnings.push('Very high volatility - increased risk');
        r.score -= 5;
      } else if (atrPct <= 0.2) {
        r.warnings.push('Very low volatility - potential squeeze');
        r.score += 5;
      }
    }

    var bbWidth = getLatest(flat.bollinger.bandwidth);
    if (bbWidth !== null) {
      var bbPrev = null;
      for (var i = flat.bollinger.bandwidth.length - 2; i >= 0; i--) {
        if (flat.bollinger.bandwidth[i] !== null) { bbPrev = flat.bollinger.bandwidth[i]; break; }
      }
      if (bbPrev !== null && bbWidth < bbPrev * 0.8) {
        r.reasons.push('Bollinger Bands squeezing - breakout potential');
        r.score += 10;
      }

      var bbUpper = getLatest(flat.bollinger.upper);
      var bbLower = getLatest(flat.bollinger.lower);
      var bbMiddle = getLatest(flat.bollinger.middle);
      if (bbUpper !== null && bbLower !== null && bbMiddle !== null) {
        var bbRange = bbUpper - bbLower;
        if (bbRange > 0) {
          var position = (close - bbLower) / bbRange;
          if (position > 0.85) {
            r.score -= 15; r.bearish.push('Price near upper Bollinger Band'); r.warnings.push('Price near upper Bollinger Band - potential reversal');
          } else if (position < 0.15) {
            r.score += 15; r.bullish.push('Price near lower Bollinger Band'); r.warnings.push('Price near lower Bollinger Band - potential bounce');
          }
        }
      }
    }

    var keltnerUpper = getLatest(flat.keltner.upper);
    var keltnerLower = getLatest(flat.keltner.lower);
    var keltnerMiddle = getLatest(flat.keltner.middle);
    if (keltnerUpper !== null && keltnerLower !== null && keltnerMiddle !== null) {
      if (close > keltnerUpper) { r.score -= 8; r.bearish.push('Price above Keltner upper channel'); }
      else if (close < keltnerLower) { r.score += 8; r.bullish.push('Price below Keltner lower channel'); }
    }

    r.score = clamp(r.score, -100, 100);
    return r;
  }

  // ============================================================
  // Conflict detection
  // ============================================================

  /**
   * Detect conflicts between scoring categories.
   *
   * @param {Array} categories - Array of category results
   * @returns {Array<{category:string, bullish:Array, bearish:Array, severity:string}>}
   */
  function detectConflicts(categories) {
    var conflicts = [];
    var names = ['Trend', 'Momentum', 'Volume', 'Structure', 'Price Action', 'Volatility'];

    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      if (cat.bullish.length > 0 && cat.bearish.length > 0) {
        conflicts.push({
          category: names[i],
          bullish: cat.bullish,
          bearish: cat.bearish,
          severity: (cat.bullish.length >= 2 && cat.bearish.length >= 2) ? 'high' : 'medium',
        });
      }
    }

    // Cross-category conflicts
    var bullishCategories = categories.filter(function(c) { return c.score > 15; }).length;
    var bearishCategories = categories.filter(function(c) { return c.score < -15; }).length;
    if (bullishCategories >= 3 && bearishCategories >= 3) {
      conflicts.push({
        category: 'Overall',
        bullish: categories.filter(function(c) { return c.score > 15; }).reduce(function(arr, c) { return arr.concat(c.bullish); }, []),
        bearish: categories.filter(function(c) { return c.score < -15; }).reduce(function(arr, c) { return arr.concat(c.bearish); }, []),
        severity: 'high',
      });
    }

    return conflicts;
  }

  // ============================================================
  // Main signal generation
  // ============================================================

  /**
   * Generate a complete trading signal for a symbol/timeframe.
   * This is the main entry point of the Signal Engine.
   *
   * @param {string} symbol - Trading pair (e.g. 'BTCUSDT')
   * @param {string} timeframe - Timeframe (e.g. '1h')
   * @param {Array} candles - Array of candle objects {open, high, low, close, volume, timestamp}
   * @param {Object} [config] - Optional config overrides (defaults to TradingConfig.DEFAULT_CONFIG)
   * @returns {Object} Complete Signal object with direction, score, entry, SL, TPs, R:R, etc.
   */
  function generateSignal(symbol, timeframe, candles, config) {
    var cfg = config || (getConfig() ? getConfig().DEFAULT_CONFIG : null);
    if (!cfg) {
      return {
        symbol: symbol, timeframe: timeframe,
        direction: 'NO_TRADE', score: 0, confidence: 0, strength: 'NO_TRADE',
        entry: candles.length > 0 ? candles[candles.length - 1].close : 0,
        stopLoss: 0, takeProfits: [], riskReward: 0,
        reasons: ['Configuration unavailable'], warnings: [],
        scoreBreakdown: {}, indicators: {}, marketStructure: {}, patterns: [], chartPatterns: [],
        regime: 'unclear', conflicts: [], timestamp: Date.now(),
      };
    }

    function emptySignal() {
      return {
        symbol: symbol, timeframe: timeframe,
        direction: 'NO_TRADE', score: 0, confidence: 0, strength: 'NO_TRADE',
        entry: candles.length > 0 ? candles[candles.length - 1].close : 0,
        stopLoss: 0, takeProfits: [], riskReward: 0,
        reasons: ['Insufficient data to generate signal'],
        warnings: [],
        scoreBreakdown: {
          trend: { score: 0, max: 100, weight: cfg.signalWeights.trend },
          momentum: { score: 0, max: 100, weight: cfg.signalWeights.momentum },
          volume: { score: 0, max: 100, weight: cfg.signalWeights.volume },
          structure: { score: 0, max: 100, weight: cfg.signalWeights.structure },
          priceAction: { score: 0, max: 100, weight: cfg.signalWeights.priceAction },
          volatility: { score: 0, max: 100, weight: cfg.signalWeights.volatility },
        },
        indicators: {},
        marketStructure: { swings: [], structureBreaks: [], liquiditySweeps: [], trend: 'neutral', hh: [], hl: [], lh: [], ll: [] },
        patterns: [], chartPatterns: [], regime: 'unclear', conflicts: [], timestamp: Date.now(),
      };
    }

    if (candles.length < 50) return emptySignal();

    // 1. Calculate all indicators
    var indicators = getIndicators().calculateAllIndicators(candles, cfg.indicatorParams);

    // 2. Detect market structure
    var structure = getMarketStructure().analyzeMarketStructure(candles, cfg.indicatorParams.swingLookback);

    // 3. Detect candlestick patterns
    var candlePatterns = getPatterns().detectCandlestickPatterns(candles);

    // 4. Detect chart patterns
    var chartPats = getPatterns().detectChartPatterns(candles);

    // 5. Detect market regime
    var regime = getPatterns().detectMarketRegime(candles);

    // 6. Run all strategies (adapt indicators to nested format)
    var adaptedIndicators = adaptIndicatorsForStrategies(
      indicators,
      cfg.indicatorParams.rsiPeriod,
      cfg.indicatorParams.atrPeriod
    );
    var strategySignals = getStrategies().runAllStrategies(
      candles, adaptedIndicators, structure, candlePatterns, chartPats
    );

    // 7. Calculate score breakdown
    var trendResult = scoreTrend(indicators, structure);
    var momentumResult = scoreMomentum(indicators);
    var volumeResult = scoreVolume(indicators, candles);
    var structureResult = scoreStructure(structure);
    var priceActionResult = scorePriceAction(candles, candlePatterns, chartPats);
    var volatilityResult = scoreVolatility(indicators, candles);

    var categories = [trendResult, momentumResult, volumeResult, structureResult, priceActionResult, volatilityResult];
    var weights = [
      cfg.signalWeights.trend,
      cfg.signalWeights.momentum,
      cfg.signalWeights.volume,
      cfg.signalWeights.structure,
      cfg.signalWeights.priceAction,
      cfg.signalWeights.volatility,
    ];

    // Weighted raw score (-100 to +100)
    var totalWeight = weights.reduce(function(a, b) { return a + b; }, 0);
    var rawScore = 0;
    for (var i = 0; i < categories.length; i++) {
      rawScore += categories[i].score * (weights[i] / totalWeight);
    }
    rawScore = clamp(Math.round(rawScore), -100, 100);

    // 8. Detect conflicts
    var conflicts = detectConflicts(categories);

    // 9. Determine direction and final score
    var DIRECTION_THRESHOLD = 8;
    var direction;
    var finalScore;

    if (rawScore > DIRECTION_THRESHOLD) {
      direction = 'LONG';
      finalScore = clamp(Math.round(50 + (rawScore / 2)), 50, 100);
    } else if (rawScore < -DIRECTION_THRESHOLD) {
      direction = 'SHORT';
      finalScore = clamp(Math.round(50 + (rawScore / 2)), 0, 50);
    } else {
      direction = 'NO_TRADE';
      finalScore = clamp(Math.round(50 - Math.abs(rawScore)), 0, 50);
    }

    // Strategy agreement bonus/penalty
    var longStrategies = strategySignals.filter(function(s) { return s.direction === 'LONG'; });
    var shortStrategies = strategySignals.filter(function(s) { return s.direction === 'SHORT'; });
    var strategyAgreement = direction === 'LONG'
      ? longStrategies.length / strategySignals.length
      : direction === 'SHORT'
        ? shortStrategies.length / strategySignals.length
        : 0;

    finalScore = clamp(Math.round(finalScore * 0.7 + strategyAgreement * 30), 0, 100);

    // 10. Confidence calculation
    var confirmations = categories.filter(function(c) {
      if (direction === 'LONG') return c.score > 10;
      if (direction === 'SHORT') return c.score < -10;
      return false;
    }).length;

    var conflictCount = categories.filter(function(c) {
      if (direction === 'LONG') return c.score < -15;
      if (direction === 'SHORT') return c.score > 15;
      return false;
    }).length;

    var confidence = clamp(
      Math.round((finalScore * 0.6) + (confirmations / 6) * 20 + (1 - conflictCount / 6) * 20),
      0, 100
    );

    // 11. Signal strength
    var thresholds = cfg.scoreThresholds;
    var strength;
    if (finalScore >= thresholds.veryStrong) strength = 'VERY_STRONG_SETUP';
    else if (finalScore >= thresholds.strongSignal) strength = 'STRONG_SIGNAL';
    else if (finalScore >= thresholds.validSetup) strength = 'VALID_SETUP';
    else if (finalScore >= thresholds.watch) strength = 'WATCH';
    else if (finalScore >= thresholds.weak) strength = 'WEAK';
    else strength = 'NO_TRADE';

    if (direction === 'NO_TRADE') strength = 'NO_TRADE';

    // 12. Entry price
    var entry = candles[candles.length - 1].close;

    // 13. Stop loss (ATR-based)
    var getLatest = getIndicators().getLatestValue;
    var atr = getLatest(indicators.atr) || entry * 0.015;
    var stopLoss;
    if (direction === 'LONG') {
      stopLoss = entry - atr * 1.5;
    } else if (direction === 'SHORT') {
      stopLoss = entry + atr * 1.5;
    } else {
      stopLoss = entry - atr * 1.5;
    }
    stopLoss = Math.max(stopLoss, 0);

    // 14. Take profits (1:1, 1:2, 1:3 R:R)
    var risk = Math.abs(entry - stopLoss);
    var takeProfits = [];
    if (direction === 'LONG') {
      takeProfits = [entry + risk * 1, entry + risk * 2, entry + risk * 3];
    } else if (direction === 'SHORT') {
      takeProfits = [entry - risk * 1, entry - risk * 2, entry - risk * 3];
    }

    // 15. Risk:Reward ratio
    var riskReward = risk > 0 ? 1 : 0;

    // 16. Build reasons
    var allReasons = [
      'Signal: ' + direction + ' (' + finalScore + '/100)',
      'Regime: ' + regime,
      'Strength: ' + (getConfig() ? getConfig().getScoreStrength(finalScore) : strength),
    ];
    for (var i = 0; i < categories.length; i++) {
      for (var j = 0; j < categories[i].reasons.length; j++) {
        allReasons.push(categories[i].reasons[j]);
      }
    }

    var bestStrategies = strategySignals
      .filter(function(s) { return (direction === 'LONG' && s.direction === 'LONG') || (direction === 'SHORT' && s.direction === 'SHORT'); })
      .sort(function(a, b) { return b.score - a.score; })
      .slice(0, 3);
    for (var i = 0; i < bestStrategies.length; i++) {
      var s = bestStrategies[i];
      for (var j = 0; j < s.reasons.length; j++) {
        allReasons.push('[' + s.name + '] ' + s.reasons[j]);
      }
    }

    // 17. Build warnings
    var allWarnings = [];
    for (var i = 0; i < categories.length; i++) {
      for (var j = 0; j < categories[i].warnings.length; j++) {
        allWarnings.push(categories[i].warnings[j]);
      }
    }
    for (var i = 0; i < strategySignals.length; i++) {
      var s = strategySignals[i];
      for (var j = 0; j < s.warnings.length; j++) {
        allWarnings.push('[' + s.name + '] ' + s.warnings[j]);
      }
    }
    for (var i = 0; i < conflicts.length; i++) {
      var c = conflicts[i];
      allWarnings.push('Conflict in ' + c.category + ': ' + c.bullish.length + ' bullish vs ' + c.bearish.length + ' bearish signals (' + c.severity + ')');
    }
    if (regime === 'high_volatility') allWarnings.push('High volatility regime - wider stops recommended');
    if (regime === 'low_volatility') allWarnings.push('Low volatility regime - potential squeeze, wait for breakout');
    if (regime === 'unclear') allWarnings.push('Market regime unclear - reduced confidence');

    // 18. Score breakdown
    var scoreBreakdown = {
      trend: { score: Math.abs(trendResult.score), max: 100, weight: weights[0] },
      momentum: { score: Math.abs(momentumResult.score), max: 100, weight: weights[1] },
      volume: { score: Math.abs(volumeResult.score), max: 100, weight: weights[2] },
      structure: { score: Math.abs(structureResult.score), max: 100, weight: weights[3] },
      priceAction: { score: Math.abs(priceActionResult.score), max: 100, weight: weights[4] },
      volatility: { score: Math.abs(volatilityResult.score), max: 100, weight: weights[5] },
    };

    return {
      symbol: symbol,
      timeframe: timeframe,
      direction: direction,
      score: finalScore,
      confidence: confidence,
      strength: strength,
      entry: entry,
      stopLoss: stopLoss,
      takeProfits: takeProfits,
      riskReward: riskReward,
      reasons: allReasons,
      warnings: allWarnings,
      scoreBreakdown: scoreBreakdown,
      indicators: adaptedIndicators,
      marketStructure: structure,
      patterns: candlePatterns,
      chartPatterns: chartPats,
      regime: regime,
      conflicts: conflicts,
      timestamp: Date.now(),
    };
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    generateSignal: generateSignal,
    adaptIndicatorsForStrategies: adaptIndicatorsForStrategies,
    scoreTrend: scoreTrend,
    scoreMomentum: scoreMomentum,
    scoreVolume: scoreVolume,
    scoreStructure: scoreStructure,
    scorePriceAction: scorePriceAction,
    scoreVolatility: scoreVolatility,
    detectConflicts: detectConflicts,
  };

})();
