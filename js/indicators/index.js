/**
 * Technical Indicators Engine
 * Complete library of 18 technical indicators for market analysis.
 * All calculations use standard financial formulas faithfully converted
 * from the TypeScript reference implementation.
 *
 * @namespace window.TradingIndicators
 * @requires window.TradingConfig (for default indicator params)
 */

window.TradingIndicators = (function() {
  'use strict';

  var DEFAULT_PARAMS = window.TradingConfig
    ? window.TradingConfig.DEFAULT_CONFIG.indicatorParams
    : {
        emaPeriods: [9, 20, 50, 100, 200],
        smaPeriods: [20, 50, 100, 200],
        rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30,
        macdFast: 12, macdSlow: 26, macdSignal: 9,
        bollingerPeriod: 20, bollingerStdDev: 2,
        atrPeriod: 14, stochasticK: 14, stochasticD: 3,
        adxPeriod: 14, swingLookback: 3,
      };

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Exponential Moving Average (EMA)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Exponential Moving Average.
   * Uses the standard multiplier: k = 2 / (period + 1).
   * Initial value is the simple average of the first `period` data points.
   *
   * @param {number[]} values - Array of numeric values (typically closes)
   * @param {number} period - EMA period
   * @returns {(number|null)[]} Array of EMA values; null before first valid value
   */
  function computeEMA(values, period) {
    var result = new Array(values.length).fill(null);
    if (values.length < period) return result;

    var k = 2 / (period + 1);
    var sum = 0;
    for (var i = 0; i < period; i++) sum += values[i];
    result[period - 1] = sum / period;

    for (var i = period; i < values.length; i++) {
      result[i] = (values[i] - result[i - 1]) * k + result[i - 1];
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Simple Moving Average (SMA)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Simple Moving Average using a running sum for O(1) per bar.
   *
   * @param {number[]} values - Array of numeric values
   * @param {number} period - SMA period
   * @returns {(number|null)[]} Array of SMA values; null before first valid value
   */
  function computeSMA(values, period) {
    var result = new Array(values.length).fill(null);
    if (values.length < period) return result;

    var sum = 0;
    for (var i = 0; i < period; i++) sum += values[i];
    result[period - 1] = sum / period;

    for (var i = period; i < values.length; i++) {
      sum += values[i] - values[i - period];
      result[i] = sum / period;
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 3. RSI (Relative Strength Index – Wilder's Smoothing)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute RSI using Wilder's smoothing method.
   *
   * @param {number[]} closes - Array of close prices
   * @param {number} period - RSI period (default 14)
   * @returns {(number|null)[]} RSI values 0-100; null before first valid value
   */
  function computeRSI(closes, period) {
    var result = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return result;

    var avgGain = 0;
    var avgLoss = 0;
    for (var i = 1; i <= period; i++) {
      var delta = closes[i] - closes[i - 1];
      if (delta > 0) avgGain += delta;
      else avgLoss -= delta;
    }
    avgGain /= period;
    avgLoss /= period;

    if (avgLoss === 0) result[period] = avgGain === 0 ? 50 : 100;
    else result[period] = 100 - 100 / (1 + avgGain / avgLoss);

    for (var i = period + 1; i < closes.length; i++) {
      var delta = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + (delta > 0 ? delta : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (delta < 0 ? -delta : 0)) / period;
      if (avgLoss === 0) result[i] = avgGain === 0 ? 50 : 100;
      else result[i] = 100 - 100 / (1 + avgGain / avgLoss);
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 4. ATR (Average True Range – Wilder's Smoothing)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute ATR using Wilder's smoothing.
   * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
   *
   * @param {Array<{high:number, low:number, close:number}>} candles
   * @param {number} period - ATR period (default 14)
   * @returns {(number|null)[]} ATR values; null before first valid value
   */
  function computeATR(candles, period) {
    var n = candles.length;
    var result = new Array(n).fill(null);
    if (n < period) return result;

    var tr = new Array(n);
    tr[0] = candles[0].high - candles[0].low;
    for (var i = 1; i < n; i++) {
      tr[i] = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
    }

    var sum = 0;
    for (var i = 0; i < period; i++) sum += tr[i];
    result[period - 1] = sum / period;

    for (var i = period; i < n; i++) {
      result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 5. MACD (Moving Average Convergence Divergence)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute MACD line, signal line, histogram, and fast/slow EMAs.
   *
   * @param {number[]} closes - Array of close prices
   * @param {number} fast - Fast EMA period (default 12)
   * @param {number} slow - Slow EMA period (default 26)
   * @param {number} signal - Signal EMA period (default 9)
   * @returns {Object} { line, signal, histogram, fastEma, slowEma }
   */
  function computeMACD(closes, fast, slow, signal) {
    var fastEma = computeEMA(closes, fast);
    var slowEma = computeEMA(closes, slow);
    var n = closes.length;

    var line = new Array(n).fill(null);
    for (var i = 0; i < n; i++) {
      if (fastEma[i] !== null && slowEma[i] !== null) {
        line[i] = fastEma[i] - slowEma[i];
      }
    }

    // Signal = EMA applied to the non-null portion of the MACD line
    var signalLine = new Array(n).fill(null);
    var histogram = new Array(n).fill(null);

    var firstIdx = -1;
    for (var i = 0; i < line.length; i++) {
      if (line[i] !== null) { firstIdx = i; break; }
    }

    if (firstIdx !== -1) {
      var macdOnly = [];
      for (var i = firstIdx; i < line.length; i++) macdOnly.push(line[i]);
      var sigEma = computeEMA(macdOnly, signal);
      for (var i = 0; i < sigEma.length; i++) signalLine[firstIdx + i] = sigEma[i];
    }

    for (var i = 0; i < n; i++) {
      if (line[i] !== null && signalLine[i] !== null) {
        histogram[i] = line[i] - signalLine[i];
      }
    }

    return { line: line, signal: signalLine, histogram: histogram, fastEma: fastEma, slowEma: slowEma };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 6. Bollinger Bands
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Bollinger Bands (SMA ± stdDev × multiplier).
   *
   * @param {number[]} closes - Array of close prices
   * @param {number} period - SMA period (default 20)
   * @param {number} mult - Standard deviation multiplier (default 2)
   * @returns {Object} { upper, middle, lower, bandwidth }
   */
  function computeBollinger(closes, period, mult) {
    var middle = computeSMA(closes, period);
    var n = closes.length;
    var upper = new Array(n).fill(null);
    var lower = new Array(n).fill(null);
    var bandwidth = new Array(n).fill(null);

    for (var i = period - 1; i < n; i++) {
      var mean = middle[i];
      var sumSq = 0;
      for (var j = i - period + 1; j <= i; j++) sumSq += (closes[j] - mean) * (closes[j] - mean);
      var std = Math.sqrt(sumSq / period);
      upper[i] = mean + mult * std;
      lower[i] = mean - mult * std;
      bandwidth[i] = mean !== 0 ? ((upper[i] - lower[i]) / mean) * 100 : 0;
    }
    return { upper: upper, middle: middle, lower: lower, bandwidth: bandwidth };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 7. Stochastic Oscillator (%K and %D)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Stochastic Oscillator.
   * %K = (close - lowest low) / (highest high - lowest low) × 100
   * %D = SMA of %K
   *
   * @param {Array<{high:number, low:number, close:number}>} candles
   * @param {number} kPeriod - %K lookback period (default 14)
   * @param {number} dPeriod - %D smoothing period (default 3)
   * @returns {Object} { k, d }
   */
  function computeStochastic(candles, kPeriod, dPeriod) {
    var n = candles.length;
    var k = new Array(n).fill(null);

    for (var i = kPeriod - 1; i < n; i++) {
      var hh = -Infinity;
      var ll = Infinity;
      for (var j = i - kPeriod + 1; j <= i; j++) {
        if (candles[j].high > hh) hh = candles[j].high;
        if (candles[j].low < ll) ll = candles[j].low;
      }
      var range = hh - ll;
      k[i] = range === 0 ? 50 : ((candles[i].close - ll) / range) * 100;
    }

    // %D = SMA of %K (computed on the non-null segment)
    var d = new Array(n).fill(null);
    var firstK = -1;
    for (var i = 0; i < k.length; i++) {
      if (k[i] !== null) { firstK = i; break; }
    }
    if (firstK !== -1) {
      var kValues = [];
      for (var i = firstK; i < k.length; i++) kValues.push(k[i]);
      var dSma = computeSMA(kValues, dPeriod);
      for (var i = 0; i < dSma.length; i++) d[firstK + i] = dSma[i];
    }

    return { k: k, d: d };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 8. ADX (Average Directional Index – Wilder's)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute ADX, +DI, and -DI using Wilder's smoothing.
   * ADX values above 25 indicate trending conditions.
   *
   * @param {Array<{high:number, low:number, close:number}>} candles
   * @param {number} period - ADX period (default 14)
   * @returns {Object} { adx, plusDi, minusDi }
   */
  function computeADX(candles, period) {
    var n = candles.length;
    var adx = new Array(n).fill(null);
    var plusDi = new Array(n).fill(null);
    var minusDi = new Array(n).fill(null);

    if (n < 2 * period) return { adx: adx, plusDi: plusDi, minusDi: minusDi };

    // Raw +DM, -DM, True Range (index 0 has no previous bar -> DM = 0)
    var tr = new Array(n);
    var pdm = new Array(n).fill(0);
    var mdm = new Array(n).fill(0);
    tr[0] = candles[0].high - candles[0].low;

    for (var i = 1; i < n; i++) {
      tr[i] = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      var up = candles[i].high - candles[i - 1].high;
      var down = candles[i - 1].low - candles[i].low;
      pdm[i] = up > down && up > 0 ? up : 0;
      mdm[i] = down > up && down > 0 ? down : 0;
    }

    // Wilder's initial sum from index 1 to `period` (period values)
    var sTR = 0, sPDM = 0, sMDM = 0;
    for (var i = 1; i <= period; i++) {
      sTR += tr[i]; sPDM += pdm[i]; sMDM += mdm[i];
    }
    sTR /= period; sPDM /= period; sMDM /= period;

    var dx = [];
    var diBase = period; // first +DI / -DI at candle index `period`

    var calcDI = function(dm) { return sTR !== 0 ? (100 * dm) / sTR : 0; };
    var pdi = calcDI(sPDM);
    var mdi = calcDI(sMDM);
    plusDi[diBase] = pdi;
    minusDi[diBase] = mdi;
    var diSum = pdi + mdi;
    dx.push(diSum !== 0 ? (100 * Math.abs(pdi - mdi)) / diSum : 0);

    for (var i = period + 1; i < n; i++) {
      sTR = (sTR * (period - 1) + tr[i]) / period;
      sPDM = (sPDM * (period - 1) + pdm[i]) / period;
      sMDM = (sMDM * (period - 1) + mdm[i]) / period;
      var p = calcDI(sPDM);
      var m = calcDI(sMDM);
      plusDi[i] = p;
      minusDi[i] = m;
      var s = p + m;
      dx.push(s !== 0 ? (100 * Math.abs(p - m)) / s : 0);
    }

    // ADX = Wilder's smoothing of DX
    if (dx.length >= period) {
      var sDX = 0;
      for (var i = 0; i < period; i++) sDX += dx[i];
      sDX /= period;
      adx[diBase + period - 1] = sDX;
      for (var i = period; i < dx.length; i++) {
        sDX = (sDX * (period - 1) + dx[i]) / period;
        adx[diBase + i] = sDX;
      }
    }

    return { adx: adx, plusDi: plusDi, minusDi: minusDi };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 9. VWAP (Volume Weighted Average Price – Running Cumulative)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute VWAP as a running cumulative value.
   * VWAP = cumulative(TP × Volume) / cumulative(Volume)
   * where TP = (high + low + close) / 3
   *
   * @param {Array<{high:number, low:number, close:number, volume:number}>} candles
   * @returns {(number|null)[]} VWAP values
   */
  function computeVWAP(candles) {
    var n = candles.length;
    var result = new Array(n).fill(null);
    if (n === 0) return result;

    var cumTPV = 0;
    var cumVol = 0;
    for (var i = 0; i < n; i++) {
      var tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
      cumTPV += tp * candles[i].volume;
      cumVol += candles[i].volume;
      result[i] = cumVol !== 0 ? cumTPV / cumVol : null;
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 10. OBV (On Balance Volume)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute On Balance Volume.
   * If close > prev close: OBV += volume
   * If close < prev close: OBV -= volume
   * If close = prev close: OBV unchanged
   *
   * @param {Array<{close:number, volume:number}>} candles
   * @returns {(number|null)[]} OBV values
   */
  function computeOBV(candles) {
    var n = candles.length;
    var result = new Array(n).fill(null);
    if (n === 0) return result;

    result[0] = 0;
    for (var i = 1; i < n; i++) {
      var prev = result[i - 1];
      if (candles[i].close > candles[i - 1].close) result[i] = prev + candles[i].volume;
      else if (candles[i].close < candles[i - 1].close) result[i] = prev - candles[i].volume;
      else result[i] = prev;
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 11. CCI (Commodity Channel Index)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Commodity Channel Index.
   * CCI = (TP - SMA(TP)) / (0.015 × Mean Deviation)
   *
   * @param {Array<{high:number, low:number, close:number}>} candles
   * @param {number} period - CCI period (default 20)
   * @returns {(number|null)[]} CCI values
   */
  function computeCCI(candles, period) {
    var n = candles.length;
    var result = new Array(n).fill(null);
    if (n < period) return result;

    var tp = candles.map(function(c) { return (c.high + c.low + c.close) / 3; });

    for (var i = period - 1; i < n; i++) {
      var sum = 0;
      for (var j = i - period + 1; j <= i; j++) sum += tp[j];
      var mean = sum / period;

      var meanDev = 0;
      for (var j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - mean);
      meanDev /= period;

      result[i] = meanDev === 0 ? 0 : (tp[i] - mean) / (0.015 * meanDev);
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 12. Williams %R
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Williams %R.
   * %R = ((highest high - close) / (highest high - lowest low)) × -100
   *
   * @param {Array<{high:number, low:number, close:number}>} candles
   * @param {number} period - Lookback period (default 14)
   * @returns {(number|null)[]} Williams %R values (-100 to 0)
   */
  function computeWilliamsR(candles, period) {
    var n = candles.length;
    var result = new Array(n).fill(null);

    for (var i = period - 1; i < n; i++) {
      var hh = -Infinity;
      var ll = Infinity;
      for (var j = i - period + 1; j <= i; j++) {
        if (candles[j].high > hh) hh = candles[j].high;
        if (candles[j].low < ll) ll = candles[j].low;
      }
      var range = hh - ll;
      result[i] = range === 0 ? -50 : ((hh - candles[i].close) / range) * -100;
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 13. MFI (Money Flow Index)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Money Flow Index.
   * Uses typical price × volume to compute money flow.
   * MFI = 100 - 100 / (1 + positiveMF / negativeMF)
   *
   * @param {Array<{high:number, low:number, close:number, volume:number}>} candles
   * @param {number} period - MFI period (default 14)
   * @returns {(number|null)[]} MFI values (0-100)
   */
  function computeMFI(candles, period) {
    var n = candles.length;
    var result = new Array(n).fill(null);
    if (n < period + 1) return result;

    var tp = candles.map(function(c) { return (c.high + c.low + c.close) / 3; });
    var mf = candles.map(function(c, i) { return tp[i] * c.volume; });

    for (var i = period; i < n; i++) {
      var posMF = 0;
      var negMF = 0;
      for (var j = i - period + 1; j <= i; j++) {
        if (tp[j] > tp[j - 1]) posMF += mf[j];
        else if (tp[j] < tp[j - 1]) negMF += mf[j];
      }
      result[i] = negMF === 0 ? 100 : 100 - 100 / (1 + posMF / negMF);
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 14. Keltner Channel (EMA + ATR)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Keltner Channel.
   * Middle = EMA(close, emaPeriod)
   * Upper = Middle + mult × ATR
   * Lower = Middle - mult × ATR
   *
   * @param {Array} candles - Candle data array
   * @param {number} emaPeriod - EMA period for middle line
   * @param {number} atrPeriod - ATR period
   * @param {number} mult - ATR multiplier
   * @returns {Object} { upper, middle, lower }
   */
  function computeKeltner(candles, emaPeriod, atrPeriod, mult) {
    var closes = candles.map(function(c) { return c.close; });
    var middle = computeEMA(closes, emaPeriod);
    var atr = computeATR(candles, atrPeriod);
    var n = candles.length;
    var upper = new Array(n).fill(null);
    var lower = new Array(n).fill(null);

    for (var i = 0; i < n; i++) {
      if (middle[i] !== null && atr[i] !== null) {
        upper[i] = middle[i] + mult * atr[i];
        lower[i] = middle[i] - mult * atr[i];
      }
    }
    return { upper: upper, middle: middle, lower: lower };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 15. Pivot Points (Classic – previous candle)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Classic Pivot Points based on previous candle's HLC.
   * PP = (H + L + C) / 3
   * R1 = 2×PP - L;  S1 = 2×PP - H
   * R2 = PP + (H-L);  S2 = PP - (H-L)
   * R3 = H + 2×(PP-L);  S3 = L - 2×(H-PP)
   *
   * @param {Array<{high:number, low:number, close:number}>} candles
   * @returns {Object} { pp, r1, r2, r3, s1, s2, s3 }
   */
  function computePivotPoints(candles) {
    var n = candles.length;
    var mk = function() { return new Array(n).fill(null); };
    var pp = mk();
    var r1 = mk(); var r2 = mk(); var r3 = mk();
    var s1 = mk(); var s2 = mk(); var s3 = mk();

    for (var i = 1; i < n; i++) {
      var h = candles[i - 1].high;
      var l = candles[i - 1].low;
      var c = candles[i - 1].close;
      var pivot = (h + l + c) / 3;
      pp[i] = pivot;
      r1[i] = 2 * pivot - l;
      s1[i] = 2 * pivot - h;
      r2[i] = pivot + (h - l);
      s2[i] = pivot - (h - l);
      r3[i] = h + 2 * (pivot - l);
      s3[i] = l - 2 * (h - pivot);
    }
    return { pp: pp, r1: r1, r2: r2, r3: r3, s1: s1, s2: s2, s3: s3 };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 16-17. Fibonacci Retracement & Extension
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Compute Fibonacci Retracement and Extension levels based on
   * the most recent confirmed swing high and swing low.
   *
   * Retracement levels: 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0
   * Extension levels: 1.272, 1.618, 2.618, 4.236
   *
   * @param {Array<{high:number, low:number}>} candles
   * @param {number} lookback - Bars on each side for swing detection
   * @returns {Object} { retracement, extension }
   */
  function computeFibonacci(candles, lookback) {
    var n = candles.length;
    var mk = function() { return new Array(n).fill(null); };
    var retracement = {
      level0: mk(), level236: mk(), level382: mk(), level500: mk(),
      level618: mk(), level786: mk(), level1000: mk(),
    };
    var extension = {
      level1272: mk(), level1618: mk(), level2618: mk(), level4236: mk(),
    };

    if (n < 2 * lookback + 1) return { retracement: retracement, extension: extension };

    // Detect confirmed swing highs / lows (need `lookback` bars on each side)
    var swings = [];
    for (var i = lookback; i < n - lookback; i++) {
      var isHigh = true;
      var isLow = true;
      for (var j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high >= candles[i].high) isHigh = false;
        if (candles[j].low <= candles[i].low) isLow = false;
      }
      if (isHigh) swings.push({ type: 'high', index: i, price: candles[i].high });
      if (isLow) swings.push({ type: 'low', index: i, price: candles[i].low });
    }
    swings.sort(function(a, b) { return a.index - b.index; });

    // For each candle, find the most recent confirmed swing high and low
    for (var i = 0; i < n; i++) {
      var maxSwingIdx = i - lookback;
      if (maxSwingIdx < 0) continue;

      var recentHigh = null;
      var recentLow = null;
      for (var s = 0; s < swings.length; s++) {
        if (swings[s].index > maxSwingIdx) break;
        if (swings[s].type === 'high') recentHigh = swings[s].price;
        else recentLow = swings[s].price;
      }

      if (recentHigh === null || recentLow === null) continue;
      var diff = recentHigh - recentLow;

      // Retracement levels (swing high -> swing low)
      retracement.level0[i] = recentHigh;
      retracement.level236[i] = recentHigh - diff * 0.236;
      retracement.level382[i] = recentHigh - diff * 0.382;
      retracement.level500[i] = recentHigh - diff * 0.5;
      retracement.level618[i] = recentHigh - diff * 0.618;
      retracement.level786[i] = recentHigh - diff * 0.786;
      retracement.level1000[i] = recentLow;

      // Extension levels (beyond swing high)
      extension.level1272[i] = recentLow + diff * 1.272;
      extension.level1618[i] = recentLow + diff * 1.618;
      extension.level2618[i] = recentLow + diff * 2.618;
      extension.level4236[i] = recentLow + diff * 4.236;
    }

    return { retracement: retracement, extension: extension };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Main Entry Point
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Calculate ALL technical indicators in a single pass.
   * Returns a comprehensive result set with all 18 indicator groups.
   *
   * @param {Array} candles - Array of candle objects with {open, high, low, close, volume, timestamp}
   * @param {Object} [params] - Optional parameter overrides
   * @returns {Object} Full IndicatorResultSet with all indicator values
   */
  function calculateAllIndicators(candles, params) {
    var p = {};
    var key;
    // Merge defaults with overrides
    for (key in DEFAULT_PARAMS) {
      p[key] = DEFAULT_PARAMS[key];
    }
    if (params) {
      for (key in params) {
        p[key] = params[key];
      }
    }

    var closes = candles.map(function(c) { return c.close; });
    var volumes = candles.map(function(c) { return c.volume; });

    var macd = computeMACD(closes, p.macdFast, p.macdSlow, p.macdSignal);
    var fib = computeFibonacci(candles, p.swingLookback);

    // 1. EMA - multiple periods
    var ema = {};
    p.emaPeriods.forEach(function(period) {
      ema[period] = computeEMA(closes, period);
    });

    // 2. SMA - multiple periods
    var sma = {};
    p.smaPeriods.forEach(function(period) {
      sma[period] = computeSMA(closes, period);
    });

    return {
      // 1. EMA
      ema: ema,
      // 2. SMA
      sma: sma,
      // 3. RSI
      rsi: computeRSI(closes, p.rsiPeriod),
      // 4. MACD
      macd: macd,
      // 5. Bollinger Bands
      bollinger: computeBollinger(closes, p.bollingerPeriod, p.bollingerStdDev),
      // 6. ATR
      atr: computeATR(candles, p.atrPeriod),
      // 7. Stochastic
      stochastic: computeStochastic(candles, p.stochasticK, p.stochasticD),
      // 8. ADX
      adx: computeADX(candles, p.adxPeriod),
      // 9. VWAP
      vwap: computeVWAP(candles),
      // 10. OBV
      obv: computeOBV(candles),
      // 11. Volume SMA (20-period)
      volumeSma: computeSMA(volumes, 20),
      // 12. CCI (uses bollingerPeriod = 20)
      cci: computeCCI(candles, p.bollingerPeriod),
      // 13. Williams %R (uses stochasticK = 14)
      williamsR: computeWilliamsR(candles, p.stochasticK),
      // 14. MFI (uses rsiPeriod = 14)
      mfi: computeMFI(candles, p.rsiPeriod),
      // 15. Keltner Channel
      keltner: computeKeltner(candles, p.bollingerPeriod, p.atrPeriod, p.bollingerStdDev),
      // 16. Pivot Points
      pivotPoints: computePivotPoints(candles),
      // 17. Fibonacci Retracement
      fibonacciRetracement: fib.retracement,
      // 18. Fibonacci Extension
      fibonacciExtension: fib.extension,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Utility
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Walk backwards to find the last non-null value in an indicator array.
   *
   * @param {(number|null)[]} values - Indicator value array
   * @returns {number|null} The last non-null value, or null if all are null
   */
  function getLatestValue(values) {
    for (var i = values.length - 1; i >= 0; i--) {
      if (values[i] !== null) return values[i];
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════════════

  return {
    // Individual indicator functions
    computeEMA: computeEMA,
    computeSMA: computeSMA,
    computeRSI: computeRSI,
    computeATR: computeATR,
    computeMACD: computeMACD,
    computeBollinger: computeBollinger,
    computeStochastic: computeStochastic,
    computeADX: computeADX,
    computeVWAP: computeVWAP,
    computeOBV: computeOBV,
    computeCCI: computeCCI,
    computeWilliamsR: computeWilliamsR,
    computeMFI: computeMFI,
    computeKeltner: computeKeltner,
    computePivotPoints: computePivotPoints,
    computeFibonacci: computeFibonacci,

    // Main entry points
    calculateAllIndicators: calculateAllIndicators,
    getLatestValue: getLatestValue,
  };

})();
