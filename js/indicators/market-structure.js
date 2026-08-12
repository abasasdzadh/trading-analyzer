/**
 * Market Structure Detection Engine
 * Implements Smart Money Concepts (SMC) style structure analysis:
 *   - Swing point detection (higher highs, lower lows, etc.)
 *   - Break of Structure (BOS) and Change of Character (CHoCH)
 *   - Liquidity sweeps
 *   - Support / Resistance zone clustering
 *
 * @namespace window.TradingMarketStructure
 */
window.TradingMarketStructure = (function() {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════════
  // Internal Helpers
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Classify the current trend by looking at the last two swing highs and
   * the last two swing lows. Returns 'neutral' when evidence is insufficient
   * or contradictory.
   *
   * @param {Array<{type:string, price:number}>} swings - Sorted swing points
   * @returns {string} 'bullish' | 'bearish' | 'neutral'
   */
  function classifyTrendFromSwings(swings) {
    var highs = swings.filter(function(s) { return s.type === 'high'; });
    var lows = swings.filter(function(s) { return s.type === 'low'; });

    if (highs.length < 2 && lows.length < 2) return 'neutral';

    var bullish = 0;
    var bearish = 0;

    // Last two swing highs: HH -> bullish, LH -> bearish
    if (highs.length >= 2) {
      var last = highs[highs.length - 1].price;
      var prev = highs[highs.length - 2].price;
      if (last > prev) bullish++;
      else if (last < prev) bearish++;
    }

    // Last two swing lows: HL -> bullish, LL -> bearish
    if (lows.length >= 2) {
      var last = lows[lows.length - 1].price;
      var prev = lows[lows.length - 2].price;
      if (last > prev) bullish++;
      else if (last < prev) bearish++;
    }

    if (bullish > bearish) return 'bullish';
    if (bearish > bullish) return 'bearish';
    return 'neutral';
  }

  /**
   * Walk backwards through the swings array to find the nearest swing of
   * `type` that appears before `currentIndex`.
   *
   * @param {Array} swings - Swing points array
   * @param {number} currentIndex - Current position in swings array
   * @param {string} type - 'high' or 'low'
   * @returns {Object|null} Swing point or null
   */
  function findPreviousSwingOfType(swings, currentIndex, type) {
    for (var j = currentIndex - 1; j >= 0; j--) {
      if (swings[j].type === type) return swings[j];
    }
    return null;
  }

  /**
   * Separate swings into HH / HL / LH / LL categories.
   * The first swing of each type has nothing to compare against and is
   * therefore unclassified.
   *
   * @param {Array} swings - Swing points array
   * @returns {{hh:Array, hl:Array, lh:Array, ll:Array}}
   */
  function classifySwings(swings) {
    var highs = swings.filter(function(s) { return s.type === 'high'; });
    var lows = swings.filter(function(s) { return s.type === 'low'; });

    var hh = [];
    var hl = [];
    var lh = [];
    var ll = [];

    for (var i = 1; i < highs.length; i++) {
      if (highs[i].price > highs[i - 1].price) hh.push(highs[i]);
      else if (highs[i].price < highs[i - 1].price) lh.push(highs[i]);
      // Equal prices are intentionally left unclassified.
    }

    for (var i = 1; i < lows.length; i++) {
      if (lows[i].price > lows[i - 1].price) hl.push(lows[i]);
      else if (lows[i].price < lows[i - 1].price) ll.push(lows[i]);
    }

    return { hh: hh, hl: hl, lh: lh, ll: ll };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Swing Point Detection
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Identify swing highs and swing lows.
   *
   * A candle is a **swing high** when its `high` is strictly greater than the
   * `high` of every candle within `lookback` bars on either side.
   * A candle is a **swing low** when its `low` is strictly less than the `low`
   * of every candle within `lookback` bars on either side.
   *
   * The function is deterministic: tied prices are never classified as swings,
   * and edge cases (too few candles, flat price series) produce empty arrays.
   *
   * @param {Array<{high:number, low:number, close:number, open:number, volume:number, timestamp:number}>} candles
   * @param {number} [lookback=3] - Bars on each side to check
   * @returns {Array<{type:string, index:number, price:number, timestamp:number}>} Swing points
   */
  function detectSwingPoints(candles, lookback) {
    lookback = lookback || 3;
    if (candles.length < lookback * 2 + 1) return [];

    // Flat-price guard: if every candle has identical high AND low, nothing swings.
    var refHigh = candles[0].high;
    var refLow = candles[0].low;
    var allFlat = candles.every(function(c) { return c.high === refHigh && c.low === refLow; });
    if (allFlat) return [];

    var swings = [];

    for (var i = lookback; i < candles.length - lookback; i++) {
      var candle = candles[i];
      var isHigh = true;
      var isLow = true;

      for (var j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high >= candle.high) isHigh = false;
        if (candles[j].low <= candle.low) isLow = false;
        if (!isHigh && !isLow) break; // early exit
      }

      if (isHigh) {
        swings.push({
          type: 'high',
          index: i,
          price: candle.high,
          timestamp: candle.timestamp,
        });
      }
      if (isLow) {
        swings.push({
          type: 'low',
          index: i,
          price: candle.low,
          timestamp: candle.timestamp,
        });
      }
    }

    return swings;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Structure Break Detection (BOS / CHoCH)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Detect Break of Structure (BOS) and Change of Character (CHoCH) events.
   *
   * **BOS** — price closes through a swing level *in the direction of the
   * current trend*, confirming continuation.
   *
   * **CHoCH** — price closes through a swing level *against the current
   * trend*, signalling a potential reversal.
   *
   * Rules:
   * - Only the **most recent unbroken** swing high / low before each candle
   *   is a candidate for break detection.
   * - A swing is marked "broken" the first time a candle closes through it,
   *   preventing duplicate detections.
   * - The trend is updated after each CHoCH event.
   * - When the trend is `neutral`, any break is classified as BOS.
   *
   * @param {Array} candles - Full candle array
   * @param {Array} swings - Swing points from detectSwingPoints
   * @returns {Array<{type:string, direction:string, index:number, price:number, timestamp:number, fromSwing:Object, toSwing:Object}>}
   */
  function detectStructureBreaks(candles, swings) {
    if (swings.length < 2 || candles.length === 0) return [];

    var breaks = [];
    var brokenIndices = {};

    // Establish initial trend from the swing point pattern.
    var trend = classifyTrendFromSwings(swings);

    for (var i = 0; i < candles.length; i++) {
      var candle = candles[i];

      // Find the most recent unbroken swing high and swing low before this candle.
      var candHigh = null;
      var candLow = null;

      for (var j = swings.length - 1; j >= 0; j--) {
        if (brokenIndices[j] || swings[j].index >= i) continue;
        if (swings[j].type === 'high' && !candHigh) {
          candHigh = { idx: j, swing: swings[j] };
        } else if (swings[j].type === 'low' && !candLow) {
          candLow = { idx: j, swing: swings[j] };
        }
        if (candHigh && candLow) break;
      }

      // --- Bullish break: close above swing high ---
      if (candHigh && candle.close > candHigh.swing.price) {
        var prevHigh = findPreviousSwingOfType(swings, candHigh.idx, 'high');
        var isBOS = trend === 'bullish' || trend === 'neutral';

        breaks.push({
          type: isBOS ? 'BOS' : 'CHoCH',
          direction: 'bullish',
          index: i,
          price: candle.close,
          timestamp: candle.timestamp,
          fromSwing: candHigh.swing,
          toSwing: prevHigh || candHigh.swing,
        });

        if (trend === 'bearish') trend = 'bullish'; // CHoCH -> trend flip
        brokenIndices[candHigh.idx] = true;
        continue; // one structural event per candle
      }

      // --- Bearish break: close below swing low ---
      if (candLow && candle.close < candLow.swing.price) {
        var prevLow = findPreviousSwingOfType(swings, candLow.idx, 'low');
        var isBOS = trend === 'bearish' || trend === 'neutral';

        breaks.push({
          type: isBOS ? 'BOS' : 'CHoCH',
          direction: 'bearish',
          index: i,
          price: candle.close,
          timestamp: candle.timestamp,
          fromSwing: candLow.swing,
          toSwing: prevLow || candLow.swing,
        });

        if (trend === 'bullish') trend = 'bearish';
        brokenIndices[candLow.idx] = true;
        continue;
      }
    }

    return breaks;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Liquidity Sweep Detection
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Detect liquidity sweeps (also called "stop hunts" or "liquidity grabs").
   *
   * A **high sweep** occurs when a candle's wick extends above a swing high
   * but the body (close) remains below that level.
   *
   * A **low sweep** is the mirror image: wick below a swing low, close above.
   *
   * Each swing can only be swept once to keep results deterministic.
   *
   * @param {Array} candles - Full candle array
   * @param {Array} swings - Swing points from detectSwingPoints
   * @returns {Array<{index:number, price:number, timestamp:number, sweepType:string}>}
   */
  function detectLiquiditySweeps(candles, swings) {
    if (swings.length === 0 || candles.length === 0) return [];

    var sweeps = [];
    var sweptIndices = {};

    for (var i = 0; i < candles.length; i++) {
      var candle = candles[i];

      for (var j = 0; j < swings.length; j++) {
        if (sweptIndices[j]) continue;
        var swing = swings[j];

        // Only consider candles that appear after the swing point.
        if (swing.index >= i) continue;

        // High sweep: wick pierces above swing high, close fails to hold above.
        if (
          swing.type === 'high' &&
          candle.high > swing.price &&
          candle.close < swing.price
        ) {
          sweeps.push({
            index: i,
            price: candle.high,
            timestamp: candle.timestamp,
            sweepType: 'high',
          });
          sweptIndices[j] = true;
        }

        // Low sweep: wick pierces below swing low, close fails to hold below.
        if (
          swing.type === 'low' &&
          candle.low < swing.price &&
          candle.close > swing.price
        ) {
          sweeps.push({
            index: i,
            price: candle.low,
            timestamp: candle.timestamp,
            sweepType: 'low',
          });
          sweptIndices[j] = true;
        }
      }
    }

    return sweeps;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Composite Analysis
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Main entry point: run the full Smart Money Concepts structure analysis.
   *
   * Combines swing detection, structure-break detection, liquidity sweeps,
   * and swing classification into a single result object.
   *
   * @param {Array} candles - Full candle array
   * @param {number} [lookback=3] - Bars on each side for swing detection
   * @returns {Object} MarketStructureResult with swings, breaks, sweeps, trend, HH/HL/LH/LL
   */
  function analyzeMarketStructure(candles, lookback) {
    lookback = lookback || 3;

    var empty = {
      swings: [],
      structureBreaks: [],
      liquiditySweeps: [],
      trend: 'neutral',
      hh: [],
      hl: [],
      lh: [],
      ll: [],
    };

    // Not enough data to detect any swings.
    if (candles.length < lookback * 2 + 1) return empty;

    var swings = detectSwingPoints(candles, lookback);
    if (swings.length === 0) {
      var result = {};
      for (var key in empty) result[key] = empty[key];
      result.swings = swings;
      return result;
    }

    var structureBreaks = detectStructureBreaks(candles, swings);
    var liquiditySweeps = detectLiquiditySweeps(candles, swings);
    var classified = classifySwings(swings);

    // Determine overall trend:
    //  1. If we have structure breaks, the last break's direction wins.
    //  2. Otherwise, infer from the swing-point pattern.
    var trend = 'neutral';

    if (structureBreaks.length > 0) {
      var last = structureBreaks[structureBreaks.length - 1];
      trend = last.direction === 'neutral' ? 'neutral' : last.direction;
    } else {
      trend = classifyTrendFromSwings(swings);
    }

    return {
      swings: swings,
      structureBreaks: structureBreaks,
      liquiditySweeps: liquiditySweeps,
      trend: trend,
      hh: classified.hh,
      hl: classified.hl,
      lh: classified.lh,
      ll: classified.ll,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 5. Support / Resistance Zone Clustering
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Cluster nearby swing-point prices into support / resistance zones.
   *
   * Algorithm:
   *  1. Collect all swing-point prices and sort ascending.
   *  2. Compute an adaptive clustering threshold based on the average
   *     candle range of the data (volatility-adjusted).
   *  3. Walk sorted prices, grouping consecutive levels within `threshold`.
   *  4. Each group becomes a PriceZone. `strength` is derived from the
   *     number of touches (cluster members), capped at 10.
   *  5. Zone type is `support` when the zone sits below the current close,
   *     `resistance` when above.
   *
   * @param {Array} candles - Full candle array
   * @param {Array} swings - Swing points from detectSwingPoints
   * @returns {Array<{upper:number, lower:number, strength:number, type:string, touches:number}>}
   */
  function detectSupportResistance(candles, swings) {
    if (swings.length === 0 || candles.length === 0) return [];

    var currentPrice = candles[candles.length - 1].close;
    if (currentPrice <= 0) return [];

    // -- Collect & sort swing prices --
    var prices = swings.map(function(s) { return s.price; }).sort(function(a, b) { return a - b; });
    if (prices.length === 0) return [];

    // -- Adaptive clustering threshold --
    // Use 50% of the average candle range (high - low). Fall back to 0.5%
    // of mid-price for instruments with zero range.
    var totalRange = 0;
    candles.forEach(function(c) { totalRange += (c.high - c.low); });
    var avgRange = totalRange / candles.length;
    var midPrice = (prices[0] + prices[prices.length - 1]) / 2;
    var threshold = avgRange > 0 ? avgRange * 0.5 : midPrice * 0.005;

    // -- Cluster nearby levels --
    var clusters = [];
    var currentCluster = [prices[0]];

    for (var i = 1; i < prices.length; i++) {
      if (prices[i] - currentCluster[currentCluster.length - 1] <= threshold) {
        currentCluster.push(prices[i]);
      } else {
        clusters.push({ prices: currentCluster });
        currentCluster = [prices[i]];
      }
    }
    clusters.push({ prices: currentCluster });

    // -- Convert clusters to PriceZone objects --
    return clusters.map(function(cluster) {
      var lower = Math.min.apply(null, cluster.prices);
      var upper = Math.max.apply(null, cluster.prices);
      var mid = (upper + lower) / 2;
      var touches = cluster.prices.length;
      var strength = Math.min(touches * 2, 10);

      // Determine zone type relative to current price.
      var type;
      if (currentPrice > upper) {
        type = 'support';
      } else if (currentPrice < lower) {
        type = 'resistance';
      } else {
        // Price is inside the zone - classify based on which half it's nearer.
        type = currentPrice >= mid ? 'resistance' : 'support';
      }

      return { upper: upper, lower: lower, strength: strength, type: type, touches: touches };
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════════════

  return {
    detectSwingPoints: detectSwingPoints,
    detectStructureBreaks: detectStructureBreaks,
    detectLiquiditySweeps: detectLiquiditySweeps,
    analyzeMarketStructure: analyzeMarketStructure,
    detectSupportResistance: detectSupportResistance,
  };

})();
