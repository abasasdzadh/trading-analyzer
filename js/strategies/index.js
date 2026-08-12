/**
 * Trading Strategies Engine
 * 7 comprehensive trading strategies that analyze market data and
 * produce scored signals with directional bias.
 *
 * Strategies:
 *   1. EMA Trend Strategy
 *   2. RSI + Trend Strategy
 *   3. MACD Momentum Strategy
 *   4. Breakout + Retest Strategy
 *   5. VWAP + Volume Strategy
 *   6. Market Structure Strategy (BOS/CHoCH)
 *   7. Bollinger Squeeze Strategy
 *
 * @namespace window.TradingStrategies
 */

window.TradingStrategies = (function() {
  'use strict';

  // ============================================================
  // Helpers
  // ============================================================

  /** Safely get the last non-null value from an indicator array */
  function lastValue(arr) {
    if (!arr) return null;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null) return arr[i];
    }
    return null;
  }

  /** Safely get the second-to-last non-null value from an indicator array */
  function prevValue(arr) {
    if (!arr) return null;
    var count = 0;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null) {
        count++;
        if (count === 2) return arr[i];
      }
    }
    return null;
  }

  /** Clamp value to [min, max] */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** Create a NO_TRADE base signal */
  function noTrade(name, reasons, warnings) {
    return { name: name, direction: 'NO_TRADE', score: 0, reasons: reasons, warnings: warnings || [] };
  }

  // ============================================================
  // 1. EMA Trend Strategy
  // ============================================================

  /**
   * EMA Trend Strategy: Analyzes EMA alignment for trend direction.
   * Full alignment (9>20>50>200) scores 85; partial (9>20>50) scores 60.
   *
   * @param {Array} candles - Candle data
   * @param {Object} indicators - Adapted indicator result set
   * @param {Object} structure - Market structure analysis
   * @param {Array} patterns - Candlestick patterns
   * @param {Array} chartPatterns - Chart patterns
   * @returns {Object} StrategySignal
   */
  function emaTrendStrategy(candles, indicators, structure, patterns, chartPatterns) {
    var reasons = [];
    var warnings = [];
    var score = 0;

    var ema9 = indicators.ema && indicators.ema[9] ? indicators.ema[9].values : null;
    var ema20 = indicators.ema && indicators.ema[20] ? indicators.ema[20].values : null;
    var ema50 = indicators.ema && indicators.ema[50] ? indicators.ema[50].values : null;
    var ema200 = indicators.ema && indicators.ema[200] ? indicators.ema[200].values : null;

    if (!ema9 || !ema20 || !ema50) {
      return noTrade('EMA Trend', ['Missing required EMAs (9, 20, 50)']);
    }

    var e9 = lastValue(ema9);
    var e20 = lastValue(ema20);
    var e50 = lastValue(ema50);
    var e200 = lastValue(ema200);

    if (e9 === null || e20 === null || e50 === null) {
      return noTrade('EMA Trend', ['Insufficient EMA data']);
    }

    // Check bullish alignment: EMA9 > EMA20 > EMA50 > EMA200
    var bullishFull = e200 !== null && e9 > e20 && e20 > e50 && e50 > e200;
    var bullishPartial = e9 > e20 && e20 > e50;

    // Check bearish alignment: EMA9 < EMA20 < EMA50 < EMA200
    var bearishFull = e200 !== null && e9 < e20 && e20 < e50 && e50 < e200;
    var bearishPartial = e9 < e20 && e20 < e50;

    if (bullishFull) {
      score = 85;
      reasons.push('Full bullish EMA alignment (9 > 20 > 50 > 200)');
    } else if (bullishPartial) {
      score = 60;
      reasons.push('Partial bullish EMA alignment (9 > 20 > 50)');
      if (e200 !== null && e50 < e200) {
        warnings.push('EMA 50 is below EMA 200 - not fully bullish');
      }
    } else if (bearishFull) {
      score = 85;
      reasons.push('Full bearish EMA alignment (9 < 20 < 50 < 200)');
    } else if (bearishPartial) {
      score = 60;
      reasons.push('Partial bearish EMA alignment (9 < 20 < 50)');
      if (e200 !== null && e50 > e200) {
        warnings.push('EMA 50 is above EMA 200 - not fully bearish');
      }
    } else {
      reasons.push('EMAs are mixed - no clear trend alignment');
      score = 0;
    }

    // Bonus: check if price is above/below key EMAs
    var lastClose = candles.length > 0 ? candles[candles.length - 1].close : null;
    if (lastClose !== null) {
      if (bullishFull || bullishPartial) {
        if (lastClose > e9) {
          score = clamp(score + 5, 0, 100);
          reasons.push('Price above EMA 9');
        } else {
          warnings.push('Price below EMA 9 - weak momentum');
          score = clamp(score - 10, 0, 100);
        }
      }
      if (bearishFull || bearishPartial) {
        if (lastClose < e9) {
          score = clamp(score + 5, 0, 100);
          reasons.push('Price below EMA 9');
        } else {
          warnings.push('Price above EMA 9 - weak momentum');
          score = clamp(score - 10, 0, 100);
        }
      }
    }

    return {
      name: 'EMA Trend',
      direction: score >= 50 ? (bullishFull || bullishPartial ? 'LONG' : 'SHORT') : 'NO_TRADE',
      score: clamp(score, 0, 100),
      reasons: reasons,
      warnings: warnings,
      meta: { ema9: e9, ema20: e20, ema50: e50, ema200: e200 },
    };
  }

  // ============================================================
  // 2. RSI + Trend Strategy
  // ============================================================

  /**
   * RSI + Trend Strategy: Combines RSI levels with micro-trend direction.
   * Detects oversold/overbought conditions aligned with trend.
   *
   * @param {Array} candles - Candle data
   * @param {Object} indicators - Adapted indicator result set
   * @param {Object} structure - Market structure
   * @param {Array} patterns - Candlestick patterns
   * @param {Array} chartPatterns - Chart patterns
   * @returns {Object} StrategySignal
   */
  function rsiTrendStrategy(candles, indicators, structure, patterns, chartPatterns) {
    var reasons = [];
    var warnings = [];
    var score = 0;

    var rsiData = indicators.rsi && indicators.rsi[14] ? indicators.rsi[14].values : null;
    if (!rsiData) {
      return noTrade('RSI + Trend', ['Missing RSI(14)']);
    }

    var rsi = lastValue(rsiData);
    var prevRsi = prevValue(rsiData);
    if (rsi === null) {
      return noTrade('RSI + Trend', ['Insufficient RSI data']);
    }

    // Determine micro-trend from recent candles
    var recentCandles = candles.slice(-10);
    var priceUp = recentCandles[recentCandles.length - 1].close > recentCandles[0].open;
    var isUptrend = priceUp && recentCandles[recentCandles.length - 1].close > recentCandles[0].close;
    var isDowntrend = !priceUp && recentCandles[recentCandles.length - 1].close < recentCandles[0].close;

    // RSI oversold recovery in uptrend
    if (rsi < 30 && isUptrend) {
      score = 75;
      reasons.push('RSI oversold (' + rsi.toFixed(1) + ') in uptrend');
      if (prevRsi !== null && prevRsi < 25) {
        score = clamp(score + 10, 0, 100);
        reasons.push('RSI recovering from deep oversold');
      }
    }
    // RSI just crossed above 30 (oversold recovery)
    else if (prevRsi !== null && prevRsi < 30 && rsi >= 30) {
      score = 70;
      reasons.push('RSI crossed above 30 (from ' + prevRsi.toFixed(1) + ' to ' + rsi.toFixed(1) + ')');
      if (isUptrend) {
        score = clamp(score + 10, 0, 100);
        reasons.push('Oversold recovery aligns with uptrend');
      }
    }
    // RSI overbought reversal in downtrend
    else if (rsi > 70 && isDowntrend) {
      score = 75;
      reasons.push('RSI overbought (' + rsi.toFixed(1) + ') in downtrend');
      if (prevRsi !== null && prevRsi > 75) {
        score = clamp(score + 10, 0, 100);
        reasons.push('RSI falling from overbought zone');
      }
    }
    // RSI just crossed below 70 (overbought reversal)
    else if (prevRsi !== null && prevRsi > 70 && rsi <= 70) {
      score = 70;
      reasons.push('RSI crossed below 70 (from ' + prevRsi.toFixed(1) + ' to ' + rsi.toFixed(1) + ')');
      if (isDowntrend) {
        score = clamp(score + 10, 0, 100);
        reasons.push('Overbought reversal aligns with downtrend');
      }
    }
    // RSI strongly trending (50-80 in uptrend, 20-50 in downtrend)
    else if (rsi > 50 && rsi < 80 && isUptrend) {
      score = 40;
      reasons.push('RSI bullish (' + rsi.toFixed(1) + ') in uptrend');
    } else if (rsi < 50 && rsi > 20 && isDowntrend) {
      score = 40;
      reasons.push('RSI bearish (' + rsi.toFixed(1) + ') in downtrend');
    }
    // RSI extremes without trend confirmation
    else if (rsi < 20) {
      score = 30;
      reasons.push('RSI deeply oversold (' + rsi.toFixed(1) + ') but no uptrend confirmation');
      warnings.push('Deeply oversold without trend support - may continue lower');
    } else if (rsi > 80) {
      score = 30;
      reasons.push('RSI deeply overbought (' + rsi.toFixed(1) + ') but no downtrend confirmation');
      warnings.push('Deeply overbought without trend support - may continue higher');
    }
    else {
      reasons.push('RSI at mid-range (' + rsi.toFixed(1) + ') - no actionable signal');
    }

    // Pattern bonus
    var bullishPatterns = patterns.filter(function(p) { return p.direction === 'bullish'; });
    var bearishPatterns = patterns.filter(function(p) { return p.direction === 'bearish'; });
    if (score > 0) {
      if (bullishPatterns.length > 0 && (isUptrend || rsi < 30)) {
        score = clamp(score + 5, 0, 100);
        reasons.push('Bullish candlestick pattern: ' + bullishPatterns[0].name);
      }
      if (bearishPatterns.length > 0 && (isDowntrend || rsi > 70)) {
        score = clamp(score + 5, 0, 100);
        reasons.push('Bearish candlestick pattern: ' + bearishPatterns[0].name);
      }
    }

    var direction = isUptrend || rsi < 30 ? 'LONG' : isDowntrend || rsi > 70 ? 'SHORT' : 'NO_TRADE';

    return {
      name: 'RSI + Trend',
      direction: score >= 40 ? direction : 'NO_TRADE',
      score: clamp(score, 0, 100),
      reasons: reasons,
      warnings: warnings,
      meta: { rsi: rsi, prevRsi: prevRsi, isUptrend: isUptrend, isDowntrend: isDowntrend },
    };
  }

  // ============================================================
  // 3. MACD Momentum Strategy
  // ============================================================

  /**
   * MACD Momentum Strategy: Analyzes MACD crossovers, histogram direction,
   * and zero-line position for momentum signals.
   *
   * @param {Array} candles - Candle data
   * @param {Object} indicators - Adapted indicator result set
   * @param {Object} structure - Market structure
   * @param {Array} patterns - Candlestick patterns
   * @param {Array} chartPatterns - Chart patterns
   * @returns {Object} StrategySignal
   */
  function macdMomentumStrategy(candles, indicators, structure, patterns, chartPatterns) {
    var reasons = [];
    var warnings = [];
    var score = 0;

    var macdData = indicators.macd;
    if (!macdData) {
      return noTrade('MACD Momentum', ['Missing MACD data']);
    }

    var macd = lastValue(macdData.macd);
    var signal = lastValue(macdData.signal);
    var histogram = lastValue(macdData.histogram);
    var prevHistogram = prevValue(macdData.histogram);
    var prevMacd = prevValue(macdData.macd);
    var prevSignal = prevValue(macdData.signal);

    if (macd === null || signal === null || histogram === null) {
      return noTrade('MACD Momentum', ['Insufficient MACD data']);
    }

    // 1. MACD/Signal crossover
    var bullishCross = prevMacd !== null && prevSignal !== null && prevMacd <= prevSignal && macd > signal;
    var bearishCross = prevMacd !== null && prevSignal !== null && prevMacd >= prevSignal && macd < signal;

    if (bullishCross) {
      score += 50;
      reasons.push('MACD crossed above signal line (bullish crossover)');
    }
    if (bearishCross) {
      score += 50;
      reasons.push('MACD crossed below signal line (bearish crossover)');
    }

    // 2. Histogram direction
    if (histogram > 0) {
      score += 15;
      reasons.push('MACD histogram is positive');
    } else {
      score -= 15;
      reasons.push('MACD histogram is negative');
    }

    if (prevHistogram !== null) {
      if (histogram > prevHistogram && histogram > 0) {
        score += 10;
        reasons.push('Histogram expanding upward - increasing bullish momentum');
      } else if (histogram < prevHistogram && histogram < 0) {
        score += 10;
        reasons.push('Histogram expanding downward - increasing bearish momentum');
      } else if (histogram > 0 && histogram < prevHistogram) {
        warnings.push('Positive histogram contracting - momentum fading');
      } else if (histogram < 0 && histogram > prevHistogram) {
        warnings.push('Negative histogram contracting - selling pressure easing');
      }
    }

    // 3. Zero-line analysis
    if (macd > 0 && signal > 0) {
      score += 15;
      reasons.push('MACD and signal both above zero - bullish territory');
    } else if (macd < 0 && signal < 0) {
      score -= 15;
      reasons.push('MACD and signal both below zero - bearish territory');
    } else if (macd > 0 && signal < 0) {
      reasons.push('MACD above zero but signal below - mixed signal');
    } else if (macd < 0 && signal > 0) {
      reasons.push('MACD below zero but signal above - mixed signal');
    }

    // Determine direction based on score
    var direction = score > 0 ? 'LONG' : score < 0 ? 'SHORT' : 'NO_TRADE';
    var absScore = clamp(Math.abs(score), 0, 100);

    return {
      name: 'MACD Momentum',
      direction: absScore >= 30 ? direction : 'NO_TRADE',
      score: absScore,
      reasons: reasons,
      warnings: warnings,
      meta: { macd: macd, signal: signal, histogram: histogram, prevHistogram: prevHistogram },
    };
  }

  // ============================================================
  // 4. Breakout + Retest Strategy
  // ============================================================

  /**
   * Breakout + Retest Strategy: Detects breakouts above resistance or below
   * support with volume confirmation and structure break confluence.
   *
   * @param {Array} candles - Candle data
   * @param {Object} indicators - Adapted indicator result set
   * @param {Object} structure - Market structure
   * @param {Array} patterns - Candlestick patterns
   * @param {Array} chartPatterns - Chart patterns
   * @returns {Object} StrategySignal
   */
  function breakoutRetestStrategy(candles, indicators, structure, patterns, chartPatterns) {
    var reasons = [];
    var warnings = [];
    var score = 0;

    if (candles.length < 10) {
      return noTrade('Breakout + Retest', ['Insufficient candle data']);
    }

    var lastCandle = candles[candles.length - 1];
    var prevCandle = candles[candles.length - 2];
    var currentPrice = lastCandle.close;

    // Use pivot points for S/R levels if available
    var pivotPoints = indicators.pivotPoints;
    var resistanceLevel = null;
    var supportLevel = null;

    if (pivotPoints) {
      resistanceLevel = Math.min(
        Math.abs(currentPrice - pivotPoints.r1) < Math.abs(currentPrice - pivotPoints.r2)
          ? pivotPoints.r1 : pivotPoints.r2,
        pivotPoints.r1
      );
      supportLevel = Math.max(
        Math.abs(currentPrice - pivotPoints.s1) < Math.abs(currentPrice - pivotPoints.s2)
          ? pivotPoints.s1 : pivotPoints.s2,
        pivotPoints.s1
      );
    }

    // If no pivot points, derive from recent swing points
    if (!pivotPoints) {
      var recentCandles = candles.slice(-50);
      var highs = recentCandles.map(function(c) { return c.high; });
      var lows = recentCandles.map(function(c) { return c.low; });
      resistanceLevel = Math.max.apply(null, highs);
      supportLevel = Math.min.apply(null, lows);
    }

    // Volume analysis for confirmation
    var volSma = indicators.volumeSma && indicators.volumeSma[20] ? indicators.volumeSma[20].values : null;
    var currentVolume = lastCandle.volume;
    var avgVolume = volSma ? lastValue(volSma) : null;
    var volumeConfirm = avgVolume !== null && currentVolume > avgVolume * 1.2;
    var highVolume = avgVolume !== null && currentVolume > avgVolume * 1.5;

    // Check for bullish breakout above resistance
    if (resistanceLevel !== null) {
      var nearResistance = Math.abs(currentPrice - resistanceLevel) / resistanceLevel < 0.005;
      var aboveResistance = prevCandle.close < resistanceLevel && currentPrice > resistanceLevel;
      var recentlyBrokeOut = prevCandle.high >= resistanceLevel * 0.998 && currentPrice > resistanceLevel;

      if (aboveResistance && volumeConfirm) {
        score = 80;
        reasons.push('Bullish breakout above resistance (' + resistanceLevel.toFixed(2) + ')');
        if (highVolume) {
          score = clamp(score + 10, 0, 100);
          reasons.push('High volume confirms breakout');
        } else {
          reasons.push('Volume confirms breakout');
        }
      } else if (recentlyBrokeOut) {
        score = 60;
        reasons.push('Price approaching/breaking resistance (' + resistanceLevel.toFixed(2) + ')');
        if (!volumeConfirm && avgVolume !== null) {
          warnings.push('Volume below average - breakout may be weak');
          score -= 15;
        }
      } else if (nearResistance) {
        score = 30;
        reasons.push('Price testing resistance at ' + resistanceLevel.toFixed(2));
        if (volumeConfirm) {
          reasons.push('Volume elevated - potential breakout forming');
        }
      }
    }

    // Check for bearish breakdown below support
    if (supportLevel !== null && score === 0) {
      var nearSupport = Math.abs(currentPrice - supportLevel) / supportLevel < 0.005;
      var belowSupport = prevCandle.close > supportLevel && currentPrice < supportLevel;
      var recentlyBrokeDown = prevCandle.low <= supportLevel * 1.002 && currentPrice < supportLevel;

      if (belowSupport && volumeConfirm) {
        score = 80;
        reasons.push('Bearish breakdown below support (' + supportLevel.toFixed(2) + ')');
        if (highVolume) {
          score = clamp(score + 10, 0, 100);
          reasons.push('High volume confirms breakdown');
        } else {
          reasons.push('Volume confirms breakdown');
        }
      } else if (recentlyBrokeDown) {
        score = 60;
        reasons.push('Price approaching/breaking support (' + supportLevel.toFixed(2) + ')');
        if (!volumeConfirm && avgVolume !== null) {
          warnings.push('Volume below average - breakdown may be weak');
          score -= 15;
        }
      } else if (nearSupport) {
        score = 30;
        reasons.push('Price testing support at ' + supportLevel.toFixed(2));
        if (volumeConfirm) {
          reasons.push('Volume elevated - potential breakdown forming');
        }
      }
    }

    // Structure break confirmation bonus
    var recentBreaks = structure.structureBreaks.slice(-3);
    for (var b = 0; b < recentBreaks.length; b++) {
      var brk = recentBreaks[b];
      if (brk.direction === 'bullish' && score > 0 && brk.type === 'BOS') {
        score = clamp(score + 10, 0, 100);
        reasons.push('Bullish Break of Structure confirms breakout');
        break;
      }
      if (brk.direction === 'bearish' && score > 0 && brk.type === 'BOS') {
        score = clamp(score + 10, 0, 100);
        reasons.push('Bearish Break of Structure confirms breakdown');
        break;
      }
    }

    // Liquidity sweep bonus
    var recentSweeps = structure.liquiditySweeps.slice(-2);
    for (var s = 0; s < recentSweeps.length; s++) {
      var sweep = recentSweeps[s];
      if (sweep.sweepType === 'low' && score > 0) {
        score = clamp(score + 5, 0, 100);
        reasons.push('Recent liquidity sweep below lows - potential reversal fuel');
      }
      if (sweep.sweepType === 'high' && score < 0) {
        score = clamp(score + 5, 0, 100);
        reasons.push('Recent liquidity sweep above highs - potential reversal fuel');
      }
    }

    var direction = resistanceLevel !== null && currentPrice > resistanceLevel ? 'LONG'
      : supportLevel !== null && currentPrice < supportLevel ? 'SHORT'
      : 'NO_TRADE';

    return {
      name: 'Breakout + Retest',
      direction: clamp(Math.abs(score), 0, 100) >= 30 ? direction : 'NO_TRADE',
      score: clamp(Math.abs(score), 0, 100),
      reasons: reasons,
      warnings: warnings,
      meta: { resistanceLevel: resistanceLevel, supportLevel: supportLevel, volumeConfirm: volumeConfirm, currentVolume: currentVolume, avgVolume: avgVolume },
    };
  }

  // ============================================================
  // 5. VWAP + Volume Strategy
  // ============================================================

  /**
   * VWAP + Volume Strategy: Uses VWAP as a dynamic S/R level with
   * volume analysis and OBV trend confirmation.
   *
   * @param {Array} candles - Candle data
   * @param {Object} indicators - Adapted indicator result set
   * @param {Object} structure - Market structure
   * @param {Array} patterns - Candlestick patterns
   * @param {Array} chartPatterns - Chart patterns
   * @returns {Object} StrategySignal
   */
  function vwapVolumeStrategy(candles, indicators, structure, patterns, chartPatterns) {
    var reasons = [];
    var warnings = [];
    var score = 0;

    if (candles.length < 5) {
      return noTrade('VWAP + Volume', ['Insufficient candle data']);
    }

    var vwapData = indicators.vwap ? indicators.vwap.values : null;
    if (!vwapData) {
      return noTrade('VWAP + Volume', ['Missing VWAP data']);
    }

    var vwap = lastValue(vwapData);
    var currentPrice = candles[candles.length - 1].close;
    var currentVolume = candles[candles.length - 1].volume;

    if (vwap === null) {
      return noTrade('VWAP + Volume', ['Insufficient VWAP data']);
    }

    // Volume analysis
    var volSma = indicators.volumeSma && indicators.volumeSma[20] ? indicators.volumeSma[20].values : null;
    var avgVolume = volSma ? lastValue(volSma) : null;
    var volumeRatio = avgVolume !== null && avgVolume > 0 ? currentVolume / avgVolume : 1;
    var highVolume = volumeRatio > 1.5;
    var aboveAvgVolume = volumeRatio > 1.2;
    var lowVolume = volumeRatio < 0.7;

    var priceAboveVWAP = currentPrice > vwap;
    var priceBelowVWAP = currentPrice < vwap;
    var distanceFromVWAP = Math.abs(currentPrice - vwap) / vwap;

    if (priceAboveVWAP) {
      score += 20;
      reasons.push('Price above VWAP (' + currentPrice.toFixed(2) + ' vs ' + vwap.toFixed(2) + ')');

      if (aboveAvgVolume) {
        score += 25;
        reasons.push('Volume above average - buyers active');
      }
      if (highVolume) {
        score += 15;
        reasons.push('Volume expansion (' + volumeRatio.toFixed(1) + 'x average) confirms buying');
      }

      // Pullback to VWAP and bouncing
      var recentLows = candles.slice(-5).map(function(c) { return c.low; });
      var touchedVWAP = recentLows.some(function(l) { return l <= vwap * 1.001; });
      if (touchedVWAP && distanceFromVWAP < 0.003) {
        score += 15;
        reasons.push('Price pulled back to VWAP and holding - bullish support');
      }

      if (distanceFromVWAP > 0.02 && !aboveAvgVolume) {
        warnings.push('Price extended above VWAP on low volume - potential exhaustion');
        score -= 15;
      }
    } else {
      score += 20;
      reasons.push('Price below VWAP (' + currentPrice.toFixed(2) + ' vs ' + vwap.toFixed(2) + ')');

      if (aboveAvgVolume) {
        score += 25;
        reasons.push('Volume above average - sellers active');
      }
      if (highVolume) {
        score += 15;
        reasons.push('Volume expansion (' + volumeRatio.toFixed(1) + 'x average) confirms selling');
      }

      var recentHighs = candles.slice(-5).map(function(c) { return c.high; });
      var touchedVWAP = recentHighs.some(function(h) { return h >= vwap * 0.999; });
      if (touchedVWAP && distanceFromVWAP < 0.003) {
        score += 15;
        reasons.push('Price pulled back to VWAP and rejected - bearish resistance');
      }

      if (distanceFromVWAP > 0.02 && !aboveAvgVolume) {
        warnings.push('Price extended below VWAP on low volume - potential exhaustion');
        score -= 15;
      }
    }

    // OBV trend confirmation
    var obvData = indicators.obv ? indicators.obv.values : null;
    if (obvData) {
      var obvNow = lastValue(obvData);
      var obvPrev = prevValue(obvData);
      if (obvNow !== null && obvPrev !== null) {
        if (priceAboveVWAP && obvNow > obvPrev) {
          score += 10;
          reasons.push('OBV rising - volume flow supports bullish move');
        } else if (priceBelowVWAP && obvNow < obvPrev) {
          score += 10;
          reasons.push('OBV falling - volume flow supports bearish move');
        } else if (priceAboveVWAP && obvNow < obvPrev) {
          warnings.push('OBV divergence - price above VWAP but volume declining');
          score -= 10;
        } else if (priceBelowVWAP && obvNow > obvPrev) {
          warnings.push('OBV divergence - price below VWAP but volume rising');
          score -= 10;
        }
      }
    }

    var direction = priceAboveVWAP ? 'LONG' : 'SHORT';
    var finalScore = clamp(Math.abs(score), 0, 100);

    return {
      name: 'VWAP + Volume',
      direction: finalScore >= 30 ? direction : 'NO_TRADE',
      score: finalScore,
      reasons: reasons,
      warnings: warnings,
      meta: { vwap: vwap, currentPrice: currentPrice, volumeRatio: volumeRatio, priceAboveVWAP: priceAboveVWAP },
    };
  }

  // ============================================================
  // 6. Market Structure Strategy (BOS/CHoCH)
  // ============================================================

  /**
   * Market Structure Strategy: Analyzes BOS/CHoCH, HH/HL/LH/LL patterns,
   * liquidity sweeps, and pattern confluence for SMC-style signals.
   *
   * @param {Array} candles - Candle data
   * @param {Object} indicators - Adapted indicator result set
   * @param {Object} structure - Market structure
   * @param {Array} patterns - Candlestick patterns
   * @param {Array} chartPatterns - Chart patterns
   * @returns {Object} StrategySignal
   */
  function marketStructureStrategy(candles, indicators, structure, patterns, chartPatterns) {
    var reasons = [];
    var warnings = [];
    var score = 0;

    if (candles.length < 20) {
      return noTrade('Market Structure', ['Insufficient candle data']);
    }

    var currentPrice = candles[candles.length - 1].close;

    // 1. Analyze overall trend from structure
    var trend = structure.trend;
    if (trend === 'bullish') {
      score += 20;
      reasons.push('Market structure trend: bullish');
    } else if (trend === 'bearish') {
      score += 20;
      reasons.push('Market structure trend: bearish');
    } else {
      reasons.push('Market structure trend: neutral/unclear');
    }

    // 2. Higher Highs / Higher Lows (bullish structure)
    var recentHH = structure.hh.filter(function(s) { return s.index >= candles.length - 30; });
    var recentHL = structure.hl.filter(function(s) { return s.index >= candles.length - 30; });
    var recentLH = structure.lh.filter(function(s) { return s.index >= candles.length - 30; });
    var recentLL = structure.ll.filter(function(s) { return s.index >= candles.length - 30; });

    if (recentHH.length >= 2 && recentHL.length >= 2) {
      score += 25;
      reasons.push('Bullish structure: ' + recentHH.length + ' higher highs, ' + recentHL.length + ' higher lows');
    } else if (recentLH.length >= 2 && recentLL.length >= 2) {
      score += 25;
      reasons.push('Bearish structure: ' + recentLH.length + ' lower highs, ' + recentLL.length + ' lower lows');
    } else if (recentHH.length >= 1 && recentHL.length >= 1) {
      score += 10;
      reasons.push('Forming bullish structure (early HH/HL)');
    } else if (recentLH.length >= 1 && recentLL.length >= 1) {
      score += 10;
      reasons.push('Forming bearish structure (early LH/LL)');
    }

    // 3. BOS (Break of Structure) analysis
    var recentBreaks = structure.structureBreaks.filter(function(b) { return b.index >= candles.length - 20; });

    for (var i = 0; i < recentBreaks.length; i++) {
      var brk = recentBreaks[i];
      if (brk.type === 'BOS' && brk.direction === 'bullish') {
        score += 15;
        reasons.push('Bullish Break of Structure (BOS) detected');
      } else if (brk.type === 'BOS' && brk.direction === 'bearish') {
        score += 15;
        reasons.push('Bearish Break of Structure (BOS) detected');
      } else if (brk.type === 'CHoCH' && brk.direction === 'bullish') {
        score += 20;
        reasons.push('Bullish Change of Character (CHoCH) - trend reversal signal');
      } else if (brk.type === 'CHoCH' && brk.direction === 'bearish') {
        score += 20;
        reasons.push('Bearish Change of Character (CHoCH) - trend reversal signal');
      }
    }

    // 4. Liquidity sweeps
    var recentSweeps = structure.liquiditySweeps.filter(function(s) { return s.index >= candles.length - 10; });
    for (var i = 0; i < recentSweeps.length; i++) {
      var sweep = recentSweeps[i];
      if (sweep.sweepType === 'low') {
        if (trend === 'bullish' || recentHH.length > recentLH.length) {
          score += 10;
          reasons.push('Liquidity sweep below recent lows - bullish inducement');
        } else {
          warnings.push('Liquidity sweep below lows in bearish context - may continue');
        }
      }
      if (sweep.sweepType === 'high') {
        if (trend === 'bearish' || recentLH.length > recentHH.length) {
          score += 10;
          reasons.push('Liquidity sweep above recent highs - bearish inducement');
        } else {
          warnings.push('Liquidity sweep above highs in bullish context - may continue');
        }
      }
    }

    // 5. Candlestick pattern confirmation
    var bullishPatterns = patterns.filter(function(p) { return p.direction === 'bullish' && p.strength >= 6; });
    var bearishPatterns = patterns.filter(function(p) { return p.direction === 'bearish' && p.strength >= 6; });

    if (bullishPatterns.length > 0 && (trend === 'bullish' || recentHH.length >= 1)) {
      score += 5;
      reasons.push('Bullish candlestick confirmation: ' + bullishPatterns.map(function(p) { return p.name; }).join(', '));
    }
    if (bearishPatterns.length > 0 && (trend === 'bearish' || recentLH.length >= 1)) {
      score += 5;
      reasons.push('Bearish candlestick confirmation: ' + bearishPatterns.map(function(p) { return p.name; }).join(', '));
    }

    // 6. Chart pattern alignment
    for (var i = 0; i < chartPatterns.length; i++) {
      var cp = chartPatterns[i];
      if (cp.direction === 'bullish' && cp.confidence > 50) {
        score += 8;
        reasons.push('Chart pattern confirms bullish: ' + cp.type + ' (confidence: ' + cp.confidence + '%)');
      }
      if (cp.direction === 'bearish' && cp.confidence > 50) {
        score += 8;
        reasons.push('Chart pattern confirms bearish: ' + cp.type + ' (confidence: ' + cp.confidence + '%)');
      }
    }

    // Determine direction
    var isBullish =
      trend === 'bullish' ||
      (recentHH.length >= 2 && recentHL.length >= 2) ||
      recentBreaks.some(function(b) { return b.direction === 'bullish' && b.type === 'CHoCH'; });

    var direction = isBullish ? 'LONG' : score > 0 ? 'SHORT' : 'NO_TRADE';
    var finalScore = clamp(Math.abs(score), 0, 100);

    return {
      name: 'Market Structure',
      direction: finalScore >= 30 ? direction : 'NO_TRADE',
      score: finalScore,
      reasons: reasons,
      warnings: warnings,
      meta: {
        trend: trend,
        hhCount: recentHH.length,
        hlCount: recentHL.length,
        lhCount: recentLH.length,
        llCount: recentLL.length,
        breakCount: recentBreaks.length,
        sweepCount: recentSweeps.length,
      },
    };
  }

  // ============================================================
  // 7. Bollinger Squeeze Strategy
  // ============================================================

  /**
   * Bollinger Squeeze Strategy: Detects Bollinger Band squeeze (low volatility)
   * and expansion breakouts. Includes TTM Squeeze (BB inside Keltner) check.
   *
   * @param {Array} candles - Candle data
   * @param {Object} indicators - Adapted indicator result set
   * @param {Object} structure - Market structure
   * @param {Array} patterns - Candlestick patterns
   * @param {Array} chartPatterns - Chart patterns
   * @returns {Object} StrategySignal
   */
  function bollingerSqueezeStrategy(candles, indicators, structure, patterns, chartPatterns) {
    var reasons = [];
    var warnings = [];
    var score = 0;

    if (candles.length < 25) {
      return noTrade('Bollinger Squeeze', ['Insufficient candle data']);
    }

    var bb = indicators.bollingerBands;
    if (!bb) {
      return noTrade('Bollinger Squeeze', ['Missing Bollinger Bands data']);
    }

    var currentUpper = lastValue(bb.upper);
    var currentMiddle = lastValue(bb.middle);
    var currentLower = lastValue(bb.lower);
    var currentWidth = lastValue(bb.width);

    if (currentUpper === null || currentMiddle === null || currentLower === null || currentWidth === null) {
      return noTrade('Bollinger Squeeze', ['Insufficient Bollinger Bands data']);
    }

    var currentPrice = candles[candles.length - 1].close;
    var bbRange = currentUpper - currentLower;

    // 1. Detect squeeze: width is in the lowest 20th percentile of recent widths
    var recentWidths = (bb.width || []).filter(function(w) { return w !== null; });
    if (recentWidths.length < 20) {
      return noTrade('Bollinger Squeeze', ['Not enough Bollinger Band width history']);
    }

    var sortedWidths = recentWidths.slice().sort(function(a, b) { return a - b; });
    var widthPercentile = sortedWidths.indexOf(currentWidth) / sortedWidths.length;
    var isSqueeze = widthPercentile < 0.20;
    var isLowWidth = widthPercentile < 0.30;

    // 2. Check for expansion (width increasing)
    var prevWidth = prevValue(bb.width);
    var isExpanding = prevWidth !== null && currentWidth > prevWidth * 1.05;
    var wasSqueeze = prevWidth !== null && (function() {
      var prevPercentile = sortedWidths.indexOf(prevWidth) / sortedWidths.length;
      return prevPercentile < 0.25;
    })();

    // 3. Price position within bands
    var bandPosition = bbRange > 0 ? (currentPrice - currentLower) / bbRange : 0.5;
    var nearUpperBand = bandPosition > 0.85;
    var nearLowerBand = bandPosition < 0.15;
    var aboveUpperBand = currentPrice > currentUpper;
    var belowLowerBand = currentPrice < currentLower;

    // Scoring
    if (isSqueeze) {
      score += 20;
      reasons.push('Bollinger Band squeeze detected - low volatility compression');
      warnings.push('Awaiting breakout direction from squeeze');
    }
    else if (isLowWidth) {
      score += 10;
      reasons.push('Bollinger Bands narrowing - potential squeeze forming');
    }

    if (wasSqueeze && isExpanding) {
      score += 30;
      reasons.push('Bollinger Bands expanding from squeeze - breakout confirmed');
    }
    else if (isExpanding) {
      score += 15;
      reasons.push('Bollinger Bands expanding - volatility increasing');
    }

    if (aboveUpperBand) {
      score += 25;
      reasons.push('Price closed above upper Bollinger Band');
    } else if (belowLowerBand) {
      score += 25;
      reasons.push('Price closed below lower Bollinger Band');
    } else if (nearUpperBand) {
      score += 15;
      reasons.push('Price near upper Bollinger Band');
    } else if (nearLowerBand) {
      score += 15;
      reasons.push('Price near lower Bollinger Band');
    }

    // Volume confirmation for breakout
    var volSma = indicators.volumeSma && indicators.volumeSma[20] ? indicators.volumeSma[20].values : null;
    var currentVolume = candles[candles.length - 1].volume;
    var avgVolume = volSma ? lastValue(volSma) : null;
    var volumeConfirm = avgVolume !== null && currentVolume > avgVolume * 1.2;

    if ((aboveUpperBand || belowLowerBand) && volumeConfirm) {
      score += 10;
      reasons.push('Volume confirms Bollinger Band breakout');
    } else if ((aboveUpperBand || belowLowerBand) && !volumeConfirm) {
      warnings.push('Band breakout without volume confirmation');
    }

    // Keltner Channel squeeze check (TTM Squeeze)
    var keltner = indicators.keltnerChannel;
    if (keltner) {
      var keltnerUpper = lastValue(keltner.upper);
      var keltnerLower = lastValue(keltner.lower);
      if (keltnerUpper !== null && keltnerLower !== null) {
        var keltnerWidth = (keltnerUpper - keltnerLower) / currentMiddle;
        var bbNormalizedWidth = bbRange / currentMiddle;

        if (bbNormalizedWidth < keltnerWidth) {
          score += 10;
          reasons.push('TTM Squeeze confirmed (BB inside Keltner Channel)');
        }
      }
    }

    var direction = (aboveUpperBand || nearUpperBand) ? 'LONG'
      : (belowLowerBand || nearLowerBand) ? 'SHORT'
      : 'NO_TRADE';

    var finalScore = clamp(Math.abs(score), 0, 100);

    return {
      name: 'Bollinger Squeeze',
      direction: finalScore >= 30 ? direction : 'NO_TRADE',
      score: finalScore,
      reasons: reasons,
      warnings: warnings,
      meta: {
        bandWidth: currentWidth,
        widthPercentile: widthPercentile,
        isSqueeze: isSqueeze,
        isExpanding: isExpanding,
        bandPosition: bandPosition,
        volumeConfirm: volumeConfirm,
      },
    };
  }

  // ============================================================
  // Strategy Runner
  // ============================================================

  /**
   * Run ALL strategies and return an array of StrategySignal results.
   *
   * @param {Array} candles - Full candle array
   * @param {Object} indicators - Adapted indicator result set (nested format)
   * @param {Object} structure - Market structure analysis
   * @param {Array} patterns - Detected candlestick patterns
   * @param {Array} chartPatterns - Detected chart patterns
   * @returns {Array<Object>} Array of StrategySignal objects from all 7 strategies
   */
  function runAllStrategies(candles, indicators, structure, patterns, chartPatterns) {
    return [
      emaTrendStrategy(candles, indicators, structure, patterns, chartPatterns),
      rsiTrendStrategy(candles, indicators, structure, patterns, chartPatterns),
      macdMomentumStrategy(candles, indicators, structure, patterns, chartPatterns),
      breakoutRetestStrategy(candles, indicators, structure, patterns, chartPatterns),
      vwapVolumeStrategy(candles, indicators, structure, patterns, chartPatterns),
      marketStructureStrategy(candles, indicators, structure, patterns, chartPatterns),
      bollingerSqueezeStrategy(candles, indicators, structure, patterns, chartPatterns),
    ];
  }

  /**
   * Get the names of all available strategies.
   * @returns {string[]} Strategy names
   */
  function getStrategyNames() {
    return [
      'EMA Trend',
      'RSI + Trend',
      'MACD Momentum',
      'Breakout + Retest',
      'VWAP + Volume',
      'Market Structure',
      'Bollinger Squeeze',
    ];
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    emaTrendStrategy: emaTrendStrategy,
    rsiTrendStrategy: rsiTrendStrategy,
    macdMomentumStrategy: macdMomentumStrategy,
    breakoutRetestStrategy: breakoutRetestStrategy,
    vwapVolumeStrategy: vwapVolumeStrategy,
    marketStructureStrategy: marketStructureStrategy,
    bollingerSqueezeStrategy: bollingerSqueezeStrategy,
    runAllStrategies: runAllStrategies,
    getStrategyNames: getStrategyNames,
  };

})();
