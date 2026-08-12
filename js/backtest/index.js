/**
 * Backtesting Engine
 * Simulates trading based on the signal engine with a sliding-window approach.
 * CRITICAL: No lookahead bias — at candle[i], only candles[0..i] are used.
 *
 * Converted from TypeScript to browser-safe JavaScript.
 * Uses window.BinanceProvider directly instead of server-side API routes.
 *
 * Expected global dependencies:
 *   - window.BinanceProvider        (market/binance.js)
 *   - window.TradingConfig         (config.js)
 *   - generateSignal()             (signal-engine.js)
 *   - calculateAllIndicators()     (indicators.js)
 *   - getLatestValue()             (indicators.js)
 *   - analyzeMarketStructure()     (market-structure.js)
 *   - detectCandlestickPatterns()  (patterns.js)
 *   - detectChartPatterns()        (patterns.js)
 *   - detectMarketRegime()         (patterns.js)
 *   - calculateFees()              (risk.js)
 *   - applySlippage()              (risk.js)
 *
 * @namespace window.TradingBacktest
 */

(function () {
  'use strict';

  // ============================================================
  // Types (documentation only — JS is dynamically typed)
  // ============================================================
  //
  // OpenTrade: { entryIndex, direction, entry, stopLoss, takeProfits, quantity, reason }
  // BacktestConfig: { symbol, timeframe, startDate, endDate, initialCapital, riskPerTrade, fee, slippage, strategy }
  // BacktestResult: { id, config, initialCapital, finalCapital, netProfit, netProfitPct, totalTrades, winningTrades, losingTrades, winRate, avgWin, avgLoss, profitFactor, expectancy, maxDrawdown, maxDrawdownPct, sharpeRatio, avgRiskReward, largestWin, largestLoss, consecutiveWins, consecutiveLosses, trades, equityCurve, drawdownCurve }
  // BacktestTradeRecord: { date, direction, entry, exit, stopLoss, takeProfit, pnl, pnlPct, riskReward, reason, exitReason }

  // ============================================================
  // Candle fetching (Binance)
  // ============================================================

  /**
   * Fetch all candles for a symbol/timeframe between two dates.
   * Binance returns max 1000 per request; we paginate backwards from endDate.
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @param {string} startDate - ISO date string (YYYY-MM-DD)
   * @param {string} endDate - ISO date string (YYYY-MM-DD)
   * @returns {Promise<Candle[]>}
   */
  async function fetchCandlesForRange(symbol, timeframe, startDate, endDate) {
    var endMs = new Date(endDate).getTime();
    var startMs = new Date(startDate).getTime();
    var batchSize = 500;

    var allCandles = [];
    var cursorMs = endMs;

    // Fetch in batches, working backwards
    while (cursorMs > startMs) {
      try {
        var batch = await window.BinanceProvider.getKlines(symbol, timeframe, batchSize);
        if (batch.length === 0) break;

        // Filter: only keep candles within [startMs, endMs]
        var filtered = batch.filter(function (c) {
          var cMs = c.timestamp * 1000;
          return cMs >= startMs && cMs <= endMs;
        });

        // Check if we've reached the start
        var earliestMs = batch[0].timestamp * 1000;
        allCandles = allCandles.concat(filtered);

        if (earliestMs <= startMs) break;

        // Move cursor before the earliest candle in this batch
        cursorMs = earliestMs - 1;

        // Rate limit pause
        await new Promise(function (r) { setTimeout(r, 250); });
      } catch (err) {
        console.error('Failed to fetch candles at cursor ' + cursorMs + ':', err);
        break;
      }
    }

    // Sort ascending by timestamp and deduplicate
    allCandles.sort(function (a, b) { return a.timestamp - b.timestamp; });
    var deduped = [];
    for (var i = 0; i < allCandles.length; i++) {
      var c = allCandles[i];
      if (deduped.length === 0 || deduped[deduped.length - 1].timestamp !== c.timestamp) {
        deduped.push(c);
      }
    }

    return deduped;
  }

  // ============================================================
  // Backtest execution
  // ============================================================

  /**
   * Run a full backtest simulation.
   * Uses sliding-window approach with no lookahead bias.
   *
   * @param {BacktestConfig} config
   * @returns {Promise<BacktestResult>}
   */
  async function runBacktest(config) {
    var WARMUP = 200;
    var MIN_SCORE_TO_TRADE = 60;  // Only trade on VALID_SETUP or better

    // Fetch candles
    var candles = await fetchCandlesForRange(
      config.symbol,
      config.timeframe,
      config.startDate,
      config.endDate
    );

    if (candles.length < WARMUP + 10) {
      return buildEmptyResult(config, 'Insufficient data');
    }

    // Prepend historical candles for warmup (fetch extra before startDate)
    var warmupStart = new Date(candles[0].timestamp * 1000 - WARMUP * getMsForTimeframe(config.timeframe));
    try {
      var warmupCandles = await fetchCandlesForRange(
        config.symbol,
        config.timeframe,
        warmupStart.toISOString().split('T')[0],
        new Date(candles[0].timestamp * 1000).toISOString().split('T')[0]
      );
      // Merge and deduplicate
      candles = warmupCandles.concat(candles);
      candles.sort(function (a, b) { return a.timestamp - b.timestamp; });
      var seen = {};
      candles = candles.filter(function (c) {
        if (seen[c.timestamp]) return false;
        seen[c.timestamp] = true;
        return true;
      });
    } catch (e) {
      // Warmup fetch failed — proceed with available data
    }

    if (candles.length < WARMUP + 10) {
      return buildEmptyResult(config, 'Insufficient data after warmup fetch');
    }

    // Trade state
    var equity = config.initialCapital;
    var peakEquity = [];
    var trades = [];
    var equityCurve = [];
    var drawdownCurve = [];
    var openTrade = null;

    for (var i = WARMUP; i < candles.length; i++) {
      // CRITICAL: Only use candles[0..i] to prevent lookahead bias
      var windowCandles = candles.slice(0, i + 1);
      var candle = candles[i];
      var dateStr = new Date(candle.timestamp * 1000).toISOString().split('T')[0];

      // Check open trade first (simulate order execution on next candle's extremes)
      if (openTrade !== null && i > openTrade.entryIndex) {
        var exitPrice = resolveTradeExit(openTrade, candle);
        var exitReason = determineExitReason(openTrade, candle, exitPrice);

        // Calculate PnL
        var grossPnl = openTrade.direction === 'LONG'
          ? (exitPrice - openTrade.entry) * openTrade.quantity
          : (openTrade.entry - exitPrice) * openTrade.quantity;

        var fees = calculateFees(openTrade.entry, exitPrice, openTrade.quantity, config.fee);
        var netPnl = grossPnl - fees;

        equity += netPnl;

        trades.push({
          date: dateStr,
          direction: openTrade.direction,
          entry: openTrade.entry,
          exit: exitPrice,
          stopLoss: openTrade.stopLoss,
          takeProfit: determineWhichTP(openTrade, candle, exitPrice),
          pnl: netPnl,
          pnlPct: (netPnl / (openTrade.entry * openTrade.quantity)) * 100,
          riskReward: Math.abs(exitPrice - openTrade.entry) / Math.abs(openTrade.entry - openTrade.stopLoss),
          reason: openTrade.reason,
          exitReason: exitReason,
        });

        openTrade = null;
      }

      // Generate signal on current candle (using only data up to this point)
      var signal = generateSignal(config.symbol, config.timeframe, windowCandles);

      // Record equity
      equityCurve.push({ date: dateStr, equity: equity });
      var peak = Math.max.apply(null, [equity].concat(peakEquity));
      peakEquity.push(peak);
      var drawdown = peak - equity;
      var drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
      drawdownCurve.push({ date: dateStr, drawdown: drawdown, drawdownPct: drawdownPct });

      // Enter new trade if conditions met
      if (openTrade === null && (signal.direction === 'LONG' || signal.direction === 'SHORT')) {
        if (signal.score >= MIN_SCORE_TO_TRADE && signal.stopLoss > 0) {
          var riskAmount = equity * (config.riskPerTrade / 100);
          var slDistance = Math.abs(signal.entry - signal.stopLoss);

          if (slDistance > 0) {
            // Apply slippage to entry
            var adjustedEntry = applySlippage(
              signal.entry,
              config.slippage,
              signal.direction === 'LONG' ? 'buy' : 'sell'
            );
            var quantity = riskAmount / slDistance;

            openTrade = {
              entryIndex: i,
              direction: signal.direction,
              entry: adjustedEntry,
              stopLoss: signal.stopLoss,
              takeProfits: signal.takeProfits,
              quantity: quantity,
              reason: 'Score: ' + signal.score + '/100 | ' + signal.regime,
            };
          }
        }
      }
    }

    // Close any remaining open trade at last price
    if (openTrade !== null) {
      var lastCandle = candles[candles.length - 1];
      var exitPrice2 = lastCandle.close;
      var grossPnl2 = openTrade.direction === 'LONG'
        ? (exitPrice2 - openTrade.entry) * openTrade.quantity
        : (openTrade.entry - exitPrice2) * openTrade.quantity;
      var fees2 = calculateFees(openTrade.entry, exitPrice2, openTrade.quantity, config.fee);
      var netPnl2 = grossPnl2 - fees2;
      equity += netPnl2;

      trades.push({
        date: new Date(lastCandle.timestamp * 1000).toISOString().split('T')[0],
        direction: openTrade.direction,
        entry: openTrade.entry,
        exit: exitPrice2,
        stopLoss: openTrade.stopLoss,
        takeProfit: null,
        pnl: netPnl2,
        pnlPct: (netPnl2 / (openTrade.entry * openTrade.quantity)) * 100,
        riskReward: Math.abs(exitPrice2 - openTrade.entry) / Math.abs(openTrade.entry - openTrade.stopLoss),
        reason: openTrade.reason,
        exitReason: 'Backtest ended',
      });
    }

    // Calculate metrics
    return computeResult(config, trades, equityCurve, drawdownCurve);
  }

  // ============================================================
  // Trade resolution
  // ============================================================

  /**
   * Determine at which price a trade exits on a given candle.
   * Checks TP levels (highest first) then SL, then defaults to close.
   * @param {Object} trade - OpenTrade object
   * @param {Candle} candle
   * @returns {number}
   */
  function resolveTradeExit(trade, candle) {
    if (trade.direction === 'LONG') {
      // Check TP levels first (highest to lowest for partial-close simulation,
      // but for simplicity we exit at first TP hit)
      var reversedTPs = trade.takeProfits.slice().reverse();
      for (var i = 0; i < reversedTPs.length; i++) {
        if (candle.high >= reversedTPs[i]) return reversedTPs[i];
      }
      // Check SL
      if (candle.low <= trade.stopLoss) return trade.stopLoss;
      // No exit — shouldn't happen in this context but return close
      return candle.close;
    } else {
      // SHORT
      var reversedTPs2 = trade.takeProfits.slice().reverse();
      for (var j = 0; j < reversedTPs2.length; j++) {
        if (candle.low <= reversedTPs2[j]) return reversedTPs2[j];
      }
      if (candle.high >= trade.stopLoss) return trade.stopLoss;
      return candle.close;
    }
  }

  /**
   * Determine which TP was hit, if any.
   * @param {Object} trade
   * @param {Candle} candle
   * @param {number} exitPrice
   * @returns {number|null}
   */
  function determineWhichTP(trade, candle, exitPrice) {
    for (var i = 0; i < trade.takeProfits.length; i++) {
      var tp = trade.takeProfits[i];
      var hit = trade.direction === 'LONG'
        ? candle.high >= tp && Math.abs(exitPrice - tp) < 0.01
        : candle.low <= tp && Math.abs(exitPrice - tp) < 0.01;
      if (hit) return tp;
    }
    return null;
  }

  /**
   * Human-readable exit reason.
   * @param {Object} trade
   * @param {Candle} candle
   * @param {number} exitPrice
   * @returns {string}
   */
  function determineExitReason(trade, candle, exitPrice) {
    // Check if it was a TP hit
    for (var i = 0; i < trade.takeProfits.length; i++) {
      var tp = trade.takeProfits[i];
      if (Math.abs(exitPrice - tp) < 0.01) {
        var rr = Math.abs(tp - trade.entry) / Math.abs(trade.entry - trade.stopLoss);
        return 'TP hit (1:' + rr.toFixed(1) + ' R:R)';
      }
    }
    // Check if it was SL
    if (Math.abs(exitPrice - trade.stopLoss) < 0.01) {
      return 'Stop loss hit';
    }
    // Candle close exit
    return 'Signal reversal / timeout';
  }

  // ============================================================
  // Metrics calculation
  // ============================================================

  /**
   * Compute the full BacktestResult from completed trades and equity/drawdown curves.
   * @param {BacktestConfig} config
   * @param {BacktestTradeRecord[]} trades
   * @param {{ date: string, equity: number }[]} equityCurve
   * @param {{ date: string, drawdown: number, drawdownPct: number }[]} drawdownCurve
   * @returns {BacktestResult}
   */
  function computeResult(config, trades, equityCurve, drawdownCurve) {
    var winningTrades = trades.filter(function (t) { return t.pnl > 0; });
    var losingTrades = trades.filter(function (t) { return t.pnl <= 0; });

    var totalTrades = trades.length;
    var wins = winningTrades.length;
    var losses = losingTrades.length;
    var winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    var grossProfit = winningTrades.reduce(function (s, t) { return s + t.pnl; }, 0);
    var grossLoss = Math.abs(losingTrades.reduce(function (s, t) { return s + t.pnl; }, 0));
    var netProfit = config.initialCapital + trades.reduce(function (s, t) { return s + t.pnl; }, 0) - config.initialCapital;
    var netProfitPct = (netProfit / config.initialCapital) * 100;
    var finalCapital = config.initialCapital + netProfit;

    var avgWin = wins > 0 ? grossProfit / wins : 0;
    var avgLoss = losses > 0 ? grossLoss / losses : 0;
    var profitFactor = grossLoss > 0 ? grossProfit / grossLoss : wins > 0 ? 999 : 0;
    var expectancy = totalTrades > 0 ? netProfit / totalTrades : 0;

    var avgRiskReward = totalTrades > 0
      ? trades.reduce(function (s, t) { return s + t.riskReward; }, 0) / totalTrades
      : 0;

    var largestWin = wins > 0 ? Math.max.apply(null, winningTrades.map(function (t) { return t.pnl; })) : 0;
    var largestLoss = losses > 0 ? Math.max.apply(null, losingTrades.map(function (t) { return Math.abs(t.pnl); })) : 0;

    // Max drawdown from curve
    var maxDrawdown = drawdownCurve.length > 0
      ? Math.max.apply(null, drawdownCurve.map(function (d) { return d.drawdown; }))
      : 0;
    var maxDrawdownPct = drawdownCurve.length > 0
      ? Math.max.apply(null, drawdownCurve.map(function (d) { return d.drawdownPct; }))
      : 0;

    // Consecutive wins/losses
    var consecutiveWins = 0;
    var consecutiveLosses = 0;
    var currentStreak = 0;
    var currentIsWin = false;
    var maxWinStreak = 0;
    var maxLossStreak = 0;

    for (var ti = 0; ti < trades.length; ti++) {
      var trade = trades[ti];
      var isWin = trade.pnl > 0;
      if (currentStreak === 0) {
        currentIsWin = isWin;
        currentStreak = 1;
      } else if (isWin === currentIsWin) {
        currentStreak++;
      } else {
        if (currentIsWin) maxWinStreak = Math.max(maxWinStreak, currentStreak);
        else maxLossStreak = Math.max(maxLossStreak, currentStreak);
        currentIsWin = isWin;
        currentStreak = 1;
      }
    }
    if (currentStreak > 0) {
      if (currentIsWin) maxWinStreak = Math.max(maxWinStreak, currentStreak);
      else maxLossStreak = Math.max(maxLossStreak, currentStreak);
    }
    consecutiveWins = maxWinStreak;
    consecutiveLosses = maxLossStreak;

    // Sharpe ratio (annualised, assuming risk-free = 0)
    var sharpeRatio = computeSharpe(equityCurve);

    return {
      id: 'bt-' + Date.now(),
      config: config,
      initialCapital: config.initialCapital,
      finalCapital: finalCapital,
      netProfit: netProfit,
      netProfitPct: netProfitPct,
      totalTrades: totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      winRate: winRate,
      avgWin: avgWin,
      avgLoss: avgLoss,
      profitFactor: profitFactor,
      expectancy: expectancy,
      maxDrawdown: maxDrawdown,
      maxDrawdownPct: maxDrawdownPct,
      sharpeRatio: sharpeRatio,
      avgRiskReward: avgRiskReward,
      largestWin: largestWin,
      largestLoss: largestLoss,
      consecutiveWins: consecutiveWins,
      consecutiveLosses: consecutiveLosses,
      trades: trades,
      equityCurve: equityCurve,
      drawdownCurve: drawdownCurve,
    };
  }

  /**
   * Compute annualised Sharpe ratio from an equity curve.
   * Assumes ~252 trading periods per year (daily bars by default).
   * @param {{ date: string, equity: number }[]} equityCurve
   * @returns {number|null}
   */
  function computeSharpe(equityCurve) {
    if (equityCurve.length < 2) return null;

    var returns = [];
    for (var i = 1; i < equityCurve.length; i++) {
      var prev = equityCurve[i - 1].equity;
      var curr = equityCurve[i].equity;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }

    if (returns.length < 2) return null;

    var mean = returns.reduce(function (a, b) { return a + b; }, 0) / returns.length;
    var variance = returns.reduce(function (a, r) { return a + Math.pow(r - mean, 2); }, 0) / (returns.length - 1);
    var stdDev = Math.sqrt(variance);

    if (stdDev === 0) return null;

    // Annualise (assuming ~252 trading periods per year for daily)
    var periodsPerYear = 252;
    return (mean / stdDev) * Math.sqrt(periodsPerYear);
  }

  // ============================================================
  // Empty result builder
  // ============================================================

  /**
   * Build an empty/zeroed BacktestResult.
   * @param {BacktestConfig} config
   * @param {string} reason - Why the backtest produced no trades
   * @returns {BacktestResult}
   */
  function buildEmptyResult(config, reason) {
    return {
      id: 'bt-' + Date.now(),
      config: config,
      initialCapital: config.initialCapital,
      finalCapital: config.initialCapital,
      netProfit: 0,
      netProfitPct: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      expectancy: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpeRatio: null,
      avgRiskReward: 0,
      largestWin: 0,
      largestLoss: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      trades: [],
      equityCurve: [],
      drawdownCurve: [],
    };
  }

  // ============================================================
  // Timeframe helper
  // ============================================================

  /**
   * Get the duration in milliseconds for a given Binance timeframe string.
   * @param {string} tf - Timeframe string, e.g. '1m', '4h', '1d'
   * @returns {number} Duration in milliseconds
   */
  function getMsForTimeframe(tf) {
    var map = {
      '1m': 60000,
      '3m': 180000,
      '5m': 300000,
      '15m': 900000,
      '30m': 1800000,
      '1h': 3600000,
      '2h': 7200000,
      '4h': 14400000,
      '6h': 21600000,
      '12h': 43200000,
      '1d': 86400000,
      '1w': 604800000,
    };
    return map[tf] !== undefined ? map[tf] : 3600000;
  }

  // ============================================================
  // Quick analysis (for scanner)
  // ============================================================

  /**
   * Lightweight analysis for the market scanner.
   * Returns a summary object without running the full backtest.
   *
   * @param {string} symbol
   * @param {Candle[]} candles
   * @param {string} timeframe
   * @returns {Object} Quick analysis summary
   */
  function quickAnalysis(symbol, candles, timeframe) {
    // Defaults
    var empty = {
      score: 0,
      direction: 'NO_TRADE',
      confidence: 0,
      trend: 'neutral',
      rsi: null,
      volume: 0,
      riskReward: 0,
      entry: 0,
      stopLoss: 0,
      takeProfit1: 0,
      setup: 'No data',
    };

    if (candles.length < 50) return empty;

    // Generate full signal — it's fast enough for scanner use
    var signal = generateSignal(symbol, timeframe, candles);

    // Extract quick-access fields
    var indicators = calculateAllIndicators(candles);
    var rsi = getLatestValue(indicators.rsi);
    var volume = candles[candles.length - 1].volume;
    var structure = analyzeMarketStructure(candles);
    var regime = detectMarketRegime(candles);

    // Determine setup description
    var setup = signal.strength;
    if (signal.direction !== 'NO_TRADE') {
      var bestPattern = signal.patterns && signal.patterns[0];
      if (bestPattern) {
        setup = bestPattern.name + ' on ' + signal.regime;
      } else {
        setup = signal.regime + ' ' + signal.direction;
      }
    }

    return {
      score: signal.score,
      direction: signal.direction,
      confidence: signal.confidence,
      trend: structure.trend,
      rsi: rsi,
      volume: volume,
      riskReward: signal.riskReward,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfits && signal.takeProfits[0] ? signal.takeProfits[0] : 0,
      setup: setup,
    };
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  window.TradingBacktest = {
    runBacktest: runBacktest,
    quickAnalysis: quickAnalysis,
    // Internal helpers exposed for advanced usage
    _fetchCandlesForRange: fetchCandlesForRange,
    _getMsForTimeframe: getMsForTimeframe,
    _computeSharpe: computeSharpe,
  };

})();
