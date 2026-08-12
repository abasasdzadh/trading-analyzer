/**
 * Risk Management Engine
 * Position sizing, stop-loss, take-profit, fee, and slippage calculations
 * with comprehensive edge-case handling.
 *
 * @namespace window.TradingRisk
 */

window.TradingRisk = (function() {
  'use strict';

  // ============================================================
  // Position Sizing
  // ============================================================

  /**
   * Calculate position size based on fixed-percentage risk model.
   *
   * riskAmount = accountBalance x (riskPerTrade / 100)
   * quantity  = riskAmount / |entry - stopLoss|
   * positionValue = quantity x entry
   *
   * @param {number} entryPrice - Entry price
   * @param {number} stopLossPrice - Stop loss price
   * @param {number} accountBalance - Total account balance
   * @param {number} riskPerTrade - Percentage of balance to risk per trade (e.g. 1 for 1%)
   * @returns {{quantity:number, riskAmount:number, positionValue:number}} Position size details
   */
  function calculatePositionSize(entryPrice, stopLossPrice, accountBalance, riskPerTrade) {
    // Guard: invalid inputs
    if (entryPrice <= 0 || accountBalance <= 0 || riskPerTrade <= 0) {
      return { quantity: 0, riskAmount: 0, positionValue: 0 };
    }

    var riskAmount = accountBalance * (riskPerTrade / 100);
    var distance = Math.abs(entryPrice - stopLossPrice);

    // If SL equals entry, we can't calculate meaningfully
    if (distance === 0) {
      return { quantity: 0, riskAmount: riskAmount, positionValue: 0 };
    }

    var quantity = riskAmount / distance;
    var positionValue = quantity * entryPrice;

    return {
      quantity: Math.max(0, quantity),
      riskAmount: Math.max(0, riskAmount),
      positionValue: Math.max(0, positionValue),
    };
  }

  // ============================================================
  // Stop-Loss Methods
  // ============================================================

  /**
   * ATR-based stop loss.
   * LONG  -> entry - atr x multiplier
   * SHORT -> entry + atr x multiplier
   *
   * @param {number} entryPrice - Entry price
   * @param {number} atr - Current ATR value
   * @param {string} direction - 'LONG' or 'SHORT'
   * @param {number} [atrMultiplier=1.5] - ATR multiplier for stop distance
   * @returns {number} Stop loss price
   */
  function calculateATRStopLoss(entryPrice, atr, direction, atrMultiplier) {
    atrMultiplier = atrMultiplier || 1.5;
    if (entryPrice <= 0 || atr <= 0 || atrMultiplier <= 0) {
      return entryPrice <= 0 ? 0 : entryPrice;
    }

    var offset = atr * atrMultiplier;

    if (direction === 'LONG') {
      return Math.max(0, entryPrice - offset);
    }
    return entryPrice + offset;
  }

  /**
   * Swing-based stop loss.
   * LONG  -> below the most recent swing low
   * SHORT -> above the most recent swing high
   *
   * @param {string} direction - 'LONG' or 'SHORT'
   * @param {number|null} swingLow - Most recent swing low price
   * @param {number|null} swingHigh - Most recent swing high price
   * @returns {number|null} Stop loss price, or null if insufficient data
   */
  function calculateSwingStopLoss(direction, swingLow, swingHigh) {
    if (direction === 'LONG') {
      if (swingLow === null || swingLow <= 0) return null;
      return swingLow;
    }

    if (direction === 'SHORT') {
      if (swingHigh === null || swingHigh <= 0) return null;
      return swingHigh;
    }

    return null;
  }

  // ============================================================
  // Take-Profits
  // ============================================================

  /**
   * Calculate take-profit levels based on risk:reward ratios.
   * LONG  -> entry + (risk x ratio)
   * SHORT -> entry - (risk x ratio)
   *
   * @param {number} entryPrice - Entry price
   * @param {number} stopLossPrice - Stop loss price
   * @param {string} direction - 'LONG' or 'SHORT'
   * @param {number[]} [ratios=[1,2,3]] - Risk:reward ratios for each TP level
   * @returns {number[]} Array of take-profit prices
   */
  function calculateTakeProfits(entryPrice, stopLossPrice, direction, ratios) {
    ratios = ratios || [1, 2, 3];
    if (entryPrice <= 0 || stopLossPrice <= 0 || ratios.length === 0) {
      return [];
    }

    var risk = Math.abs(entryPrice - stopLossPrice);
    if (risk === 0) return [];

    var tps = [];

    for (var i = 0; i < ratios.length; i++) {
      var ratio = ratios[i];
      if (ratio <= 0) continue;
      var tp = direction === 'LONG'
        ? entryPrice + risk * ratio
        : entryPrice - risk * ratio;
      tps.push(tp);
    }

    return tps;
  }

  /**
   * Build structured take-profit levels with percentage allocation.
   *
   * Default allocation: 30% at TP1, 30% at TP2, 40% at TP3.
   *
   * @param {number} entryPrice - Entry price
   * @param {number} stopLossPrice - Stop loss price
   * @param {string} direction - 'LONG' or 'SHORT'
   * @param {number[]} [ratios=[1,2,3]] - Risk:reward ratios for each level
   * @param {number[]} [allocations=[30,30,40]] - Percentage of position to close at each level
   * @returns {Array<{price:number, targetRR:number, percentage:number}>} Structured TP levels
   */
  function buildTakeProfitLevels(entryPrice, stopLossPrice, direction, ratios, allocations) {
    ratios = ratios || [1, 2, 3];
    allocations = allocations || [30, 30, 40];

    var prices = calculateTakeProfits(entryPrice, stopLossPrice, direction, ratios);

    return prices.map(function(price, i) {
      return {
        price: price,
        targetRR: ratios[i] !== undefined ? ratios[i] : 1,
        percentage: allocations[i] !== undefined ? allocations[i] : 0,
      };
    });
  }

  // ============================================================
  // Risk:Reward
  // ============================================================

  /**
   * Calculate risk:reward ratio.
   * Returns a positive number representing the R:R multiple.
   *
   * @param {number} entryPrice - Entry price
   * @param {number} stopLossPrice - Stop loss price
   * @param {number} takeProfitPrice - Take profit price
   * @param {string} direction - 'LONG' or 'SHORT'
   * @returns {number} Risk:reward ratio (e.g. 2.0 means 1:2)
   */
  function calculateRiskReward(entryPrice, stopLossPrice, takeProfitPrice, direction) {
    if (entryPrice <= 0 || stopLossPrice <= 0 || takeProfitPrice <= 0) return 0;

    var risk = Math.abs(entryPrice - stopLossPrice);
    var reward = Math.abs(takeProfitPrice - entryPrice);

    if (risk === 0) return 0;

    return reward / risk;
  }

  // ============================================================
  // Fees & Slippage
  // ============================================================

  /**
   * Calculate total trading fees for a round-trip (entry + exit).
   * feeRate is applied per side, e.g. 0.001 for 0.1%.
   *
   * @param {number} entryPrice - Entry price
   * @param {number} exitPrice - Exit price
   * @param {number} quantity - Position size
   * @param {number} feeRate - Fee rate per side (e.g. 0.001 for 0.1%)
   * @returns {number} Total fee amount
   */
  function calculateFees(entryPrice, exitPrice, quantity, feeRate) {
    if (entryPrice <= 0 || exitPrice <= 0 || quantity <= 0 || feeRate < 0) {
      return 0;
    }

    var entryFee = entryPrice * quantity * feeRate;
    var exitFee = exitPrice * quantity * feeRate;
    return entryFee + exitFee;
  }

  /**
   * Apply slippage to a price.
   * 'buy'  -> price increased (worse for buyer)
   * 'sell' -> price decreased (worse for seller)
   *
   * @param {number} price - Original price
   * @param {number} slippageRate - Slippage rate (e.g. 0.0005 for 0.05%)
   * @param {string} direction - 'buy' or 'sell'
   * @returns {number} Adjusted price with slippage applied
   */
  function applySlippage(price, slippageRate, direction) {
    if (price <= 0 || slippageRate < 0) return price;

    if (direction === 'buy') {
      return price * (1 + slippageRate);
    }
    return price * (1 - slippageRate);
  }

  // ============================================================
  // Stop-Loss Method Builder
  // ============================================================

  /**
   * Build a StopLossMethod object from ATR data.
   *
   * @param {number} entryPrice - Entry price
   * @param {number} atr - Current ATR value
   * @param {string} direction - 'LONG' or 'SHORT'
   * @param {number} [multiplier=1.5] - ATR multiplier
   * @returns {{type:string, price:number, distance:number}} Stop loss method details
   */
  function buildATRStopLossMethod(entryPrice, atr, direction, multiplier) {
    multiplier = multiplier || 1.5;
    var price = calculateATRStopLoss(entryPrice, atr, direction, multiplier);
    return {
      type: 'atr_based',
      price: price,
      distance: Math.abs(entryPrice - price),
    };
  }

  /**
   * Build a StopLossMethod object from swing points.
   *
   * @param {number} entryPrice - Entry price
   * @param {string} direction - 'LONG' or 'SHORT'
   * @param {number|null} swingLow - Most recent swing low
   * @param {number|null} swingHigh - Most recent swing high
   * @returns {{type:string, price:number, distance:number}|null} Stop loss method details, or null
   */
  function buildSwingStopLossMethod(entryPrice, direction, swingLow, swingHigh) {
    var price = calculateSwingStopLoss(direction, swingLow, swingHigh);
    if (price === null) return null;
    return {
      type: 'swing_based',
      price: price,
      distance: Math.abs(entryPrice - price),
    };
  }

  // ============================================================
  // Validation
  // ============================================================

  /**
   * Validate risk configuration parameters.
   * Returns an object with `valid` boolean and array of error strings.
   *
   * @param {Object} config - Risk configuration object
   * @param {number} config.accountBalance - Account balance in currency
   * @param {number} config.riskPerTrade - Risk per trade percentage
   * @param {number} config.maxOpenTrades - Maximum concurrent trades
   * @param {number} config.maxDailyLoss - Max daily loss percentage
   * @param {number} config.minRiskReward - Minimum acceptable R:R ratio
   * @param {number} config.fee - Fee rate
   * @param {number} config.slippage - Slippage rate
   * @returns {{valid:boolean, errors:string[]}}
   */
  function validateRiskParams(config) {
    var errors = [];

    if (config.accountBalance <= 0) {
      errors.push('Account balance must be greater than 0');
    }

    if (config.riskPerTrade <= 0 || config.riskPerTrade > 100) {
      errors.push('Risk per trade must be between 0 and 100');
    }

    // Warn if risk per trade is aggressive
    if (config.riskPerTrade > 5) {
      errors.push('Risk per trade (' + config.riskPerTrade + '%) is aggressive - consider reducing to 1-2%');
    }

    if (config.maxOpenTrades <= 0 || !Number.isInteger(config.maxOpenTrades)) {
      errors.push('Max open trades must be a positive integer');
    }

    if (config.maxDailyLoss <= 0 || config.maxDailyLoss > 100) {
      errors.push('Max daily loss must be between 0 and 100');
    }

    if (config.maxDailyLoss < config.riskPerTrade * 2) {
      errors.push('Max daily loss (' + config.maxDailyLoss + '%) should be at least 2x risk per trade (' + config.riskPerTrade + '%)');
    }

    if (config.minRiskReward <= 0) {
      errors.push('Minimum risk:reward must be greater than 0');
    }

    if (config.fee < 0) {
      errors.push('Fee rate cannot be negative');
    }

    if (config.fee > 0.01) {
      errors.push('Fee rate (' + (config.fee * 100).toFixed(2) + '%) seems very high - verify');
    }

    if (config.slippage < 0) {
      errors.push('Slippage rate cannot be negative');
    }

    if (config.slippage > 0.01) {
      errors.push('Slippage rate (' + (config.slippage * 100).toFixed(3) + '%) seems very high - verify');
    }

    return {
      valid: errors.length === 0,
      errors: errors,
    };
  }

  // ============================================================
  // Utility: Expected Value
  // ============================================================

  /**
   * Calculate the expected value per trade given win rate, avg win, avg loss.
   * EV = (winRate x avgWin) - ((1 - winRate) x avgLoss)
   *
   * @param {number} winRate - Win rate (0-1)
   * @param {number} avgWin - Average winning trade profit (positive number)
   * @param {number} avgLoss - Average losing trade loss (positive number)
   * @returns {number} Expected value per trade
   */
  function calculateExpectancy(winRate, avgWin, avgLoss) {
    if (winRate < 0 || winRate > 1) return 0;
    return (winRate * avgWin) - ((1 - winRate) * avgLoss);
  }

  /**
   * Calculate the breakeven win rate for a given risk:reward ratio.
   * breakeven = 1 / (1 + RR)
   *
   * @param {number} riskRewardRatio - Risk:reward ratio (e.g. 2 for 1:2)
   * @returns {number} Breakeven win rate as a decimal (0-1)
   */
  function breakevenWinRate(riskRewardRatio) {
    if (riskRewardRatio <= 0) return 1;
    return 1 / (1 + riskRewardRatio);
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    // Position sizing
    calculatePositionSize: calculatePositionSize,

    // Stop-loss
    calculateATRStopLoss: calculateATRStopLoss,
    calculateSwingStopLoss: calculateSwingStopLoss,

    // Take-profit
    calculateTakeProfits: calculateTakeProfits,
    buildTakeProfitLevels: buildTakeProfitLevels,

    // Risk:Reward
    calculateRiskReward: calculateRiskReward,

    // Fees & slippage
    calculateFees: calculateFees,
    applySlippage: applySlippage,

    // Stop-loss method builders
    buildATRStopLossMethod: buildATRStopLossMethod,
    buildSwingStopLossMethod: buildSwingStopLossMethod,

    // Validation
    validateRiskParams: validateRiskParams,

    // Utility
    calculateExpectancy: calculateExpectancy,
    breakevenWinRate: breakevenWinRate,
  };

})();
