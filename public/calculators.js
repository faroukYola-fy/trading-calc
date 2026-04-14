(function universalModule(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TradingCalculators = factory();
})(typeof self !== "undefined" ? self : this, function factory() {
  const SUPPORTED_EXCHANGES = new Set(["binance", "bybit"]);
  const SUPPORTED_POSITION_TYPES = new Set(["long", "short"]);

  function ensureFinite(name, value) {
    if (!Number.isFinite(value)) {
      throw new Error(`${name} must be a valid number.`);
    }
  }

  function ensurePositive(name, value) {
    ensureFinite(name, value);
    if (value <= 0) {
      throw new Error(`${name} must be greater than 0.`);
    }
  }

  function ensurePercent(name, value, min, max) {
    ensureFinite(name, value);
    if (value < min || value > max) {
      throw new Error(`${name} must be between ${min} and ${max}.`);
    }
  }

  function normalizePositionType(value) {
    const normalized = String(value || "").toLowerCase();
    if (!SUPPORTED_POSITION_TYPES.has(normalized)) {
      throw new Error("Position type must be 'long' or 'short'.");
    }
    return normalized;
  }

  function normalizeExchange(value) {
    const normalized = String(value || "").toLowerCase();
    if (!SUPPORTED_EXCHANGES.has(normalized)) {
      throw new Error("Exchange must be 'binance' or 'bybit'.");
    }
    return normalized;
  }

  function positionDirection(positionType) {
    return positionType === "long" ? 1 : -1;
  }

  function computeTradeMetrics(input) {
    const entryPrice = Number(input.entryPrice);
    const targetPrice = Number(input.targetPrice);
    const positionSize = Number(input.positionSize);
    const leverage = Number(input.leverage);
    const feePercent = Number(input.feePercent);
    const positionType = normalizePositionType(input.positionType);

    ensurePositive("Entry price", entryPrice);
    ensurePositive("Target price", targetPrice);
    ensurePositive("Position size", positionSize);
    ensurePositive("Leverage", leverage);
    ensurePercent("Fee percent", feePercent, 0, 100);

    const direction = positionDirection(positionType);
    const movePercent = ((targetPrice - entryPrice) / entryPrice) * direction;
    const effectivePositionValue = positionSize * leverage;
    const grossPnl = effectivePositionValue * movePercent;
    const feeCost = effectivePositionValue * (feePercent / 100) * 2;
    const netPnl = grossPnl - feeCost;
    const roiPercent = (netPnl / positionSize) * 100;

    return {
      movePercent,
      grossPnl,
      feeCost,
      netPnl,
      roiPercent,
      entryPrice,
      targetPrice,
      positionType,
      effectivePositionValue,
    };
  }

  function calculateTakeProfit(input) {
    const entryPrice = Number(input.entryPrice);
    const takeProfitPrice = Number(input.takeProfitPrice);
    const stopLossPrice =
      input.stopLossPrice === null ||
      input.stopLossPrice === undefined ||
      input.stopLossPrice === ""
        ? null
        : Number(input.stopLossPrice);

    const metrics = computeTradeMetrics({
      entryPrice,
      targetPrice: takeProfitPrice,
      positionSize: Number(input.positionSize),
      positionType: input.positionType,
      leverage: Number(input.leverage),
      feePercent: Number(input.feePercent),
    });

    let riskRewardRatio = null;
    let riskRewardHint =
      "Add an optional stop loss to calculate exact risk-reward ratio.";

    if (stopLossPrice !== null) {
      ensurePositive("Stop loss price", stopLossPrice);
      const direction = positionDirection(metrics.positionType);
      const rewardPercent = ((takeProfitPrice - entryPrice) / entryPrice) * direction;
      const riskPercent = ((entryPrice - stopLossPrice) / entryPrice) * direction;

      if (rewardPercent > 0 && riskPercent > 0) {
        riskRewardRatio = rewardPercent / riskPercent;
        riskRewardHint = "Risk-reward ratio computed from entry, TP, and SL.";
      } else {
        riskRewardHint = "Stop loss is invalid for selected position direction.";
      }
    }

    return {
      profitUsd: metrics.netPnl,
      roiPercent: metrics.roiPercent,
      feeUsd: metrics.feeCost,
      grossProfitUsd: metrics.grossPnl,
      riskRewardRatio,
      riskRewardHint,
    };
  }

  function calculateStopLoss(input) {
    const entryPrice = Number(input.entryPrice);
    const stopLossPrice = Number(input.stopLossPrice);
    const positionSize = Number(input.positionSize);
    const leverage = Number(input.leverage);
    const feePercent = Number(input.feePercent);
    const positionType = normalizePositionType(input.positionType);

    ensurePositive("Entry price", entryPrice);
    ensurePositive("Stop loss price", stopLossPrice);
    ensurePositive("Position size", positionSize);
    ensurePositive("Leverage", leverage);
    ensurePercent("Fee percent", feePercent, 0, 100);

    const direction = positionDirection(positionType);
    const riskPercent = ((entryPrice - stopLossPrice) / entryPrice) * direction;
    if (riskPercent <= 0) {
      throw new Error("Stop loss is not on the risk side for the selected position.");
    }

    const effectivePositionValue = positionSize * leverage;
    const feeCost = effectivePositionValue * (feePercent / 100) * 2;
    const lossUsd = effectivePositionValue * riskPercent + feeCost;
    const capitalLossPercent = (lossUsd / positionSize) * 100;

    return {
      lossUsd,
      capitalLossPercent,
      feeUsd: feeCost,
      riskPercent,
    };
  }

  function calculatePnL(input) {
    const metrics = computeTradeMetrics({
      entryPrice: Number(input.entryPrice),
      targetPrice: Number(input.exitPrice),
      positionSize: Number(input.positionSize),
      positionType: input.positionType,
      leverage: Number(input.leverage),
      feePercent: Number(input.feePercent),
    });

    return {
      netPnlUsd: metrics.netPnl,
      grossPnlUsd: metrics.grossPnl,
      roiPercent: metrics.roiPercent,
      feeUsd: metrics.feeCost,
      movePercent: metrics.movePercent * 100,
    };
  }

  function calculatePercentageChange(input) {
    const initialValue = Number(input.initialValue);
    const finalValue = Number(input.finalValue);

    ensurePositive("Initial value", initialValue);
    ensureFinite("Final value", finalValue);

    const absoluteDifference = finalValue - initialValue;
    const percentageChange = (absoluteDifference / initialValue) * 100;

    return {
      percentageChange,
      absoluteDifference,
      isGain: percentageChange >= 0,
    };
  }

  function calculateLiquidation(input) {
    const exchange = normalizeExchange(input.exchange);
    const positionType = normalizePositionType(input.positionType);
    const entryPrice = Number(input.entryPrice);
    const leverage = Number(input.leverage);
    const margin = Number(input.margin);
    const maintenanceMarginRate = Number(input.maintenanceMarginRate);

    ensurePositive("Entry price", entryPrice);
    ensurePositive("Leverage", leverage);
    ensurePositive("Margin", margin);
    ensurePercent("Maintenance margin rate", maintenanceMarginRate, 0, 1);

    const isLong = positionType === "long";
    let liquidationPrice;

    if (exchange === "binance") {
      liquidationPrice = isLong
        ? entryPrice * (1 - 1 / leverage + maintenanceMarginRate)
        : entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
    } else {
      const positionValue = margin * leverage;
      const initialMargin = positionValue / leverage;
      const maintenanceMargin = positionValue * maintenanceMarginRate;
      const marginFactor = (initialMargin - maintenanceMargin) / positionValue;

      liquidationPrice = isLong
        ? entryPrice * (1 - marginFactor)
        : entryPrice * (1 + marginFactor);
    }

    const distanceFromEntryPercent = Math.abs(
      ((liquidationPrice - entryPrice) / entryPrice) * 100
    );

    return {
      liquidationPrice,
      distanceFromEntryPercent,
      isHighRisk: distanceFromEntryPercent < 5,
    };
  }

  return {
    calculateTakeProfit,
    calculateStopLoss,
    calculatePnL,
    calculatePercentageChange,
    calculateLiquidation,
  };
});
