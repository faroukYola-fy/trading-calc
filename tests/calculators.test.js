const test = require("node:test");
const assert = require("node:assert/strict");

const calculators = require("../public/calculators.js");

function closeTo(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be close to ${expected}`
  );
}

test("Take Profit calculator computes profit/ROI correctly", () => {
  const result = calculators.calculateTakeProfit({
    entryPrice: 100,
    takeProfitPrice: 110,
    positionSize: 1000,
    positionType: "long",
    leverage: 10,
    feePercent: 0.1,
    stopLossPrice: 95,
  });

  closeTo(result.profitUsd, 980);
  closeTo(result.roiPercent, 98);
  closeTo(result.feeUsd, 20);
  closeTo(result.riskRewardRatio, 2);
});

test("Stop Loss calculator validates stop direction and computes expected loss", () => {
  const result = calculators.calculateStopLoss({
    entryPrice: 100,
    stopLossPrice: 95,
    positionSize: 1000,
    positionType: "long",
    leverage: 10,
    feePercent: 0.1,
  });

  closeTo(result.lossUsd, 520);
  closeTo(result.capitalLossPercent, 52);
  closeTo(result.feeUsd, 20);
});

test("PnL calculator works for short positions", () => {
  const result = calculators.calculatePnL({
    entryPrice: 100,
    exitPrice: 90,
    positionSize: 500,
    positionType: "short",
    leverage: 5,
    feePercent: 0.2,
  });

  closeTo(result.grossPnlUsd, 250);
  closeTo(result.feeUsd, 10);
  closeTo(result.netPnlUsd, 240);
  closeTo(result.roiPercent, 48);
});

test("Percentage change calculator returns gain/loss and absolute diff", () => {
  const gain = calculators.calculatePercentageChange({
    initialValue: 20,
    finalValue: 25,
  });
  closeTo(gain.percentageChange, 25);
  closeTo(gain.absoluteDifference, 5);
  assert.equal(gain.isGain, true);

  const loss = calculators.calculatePercentageChange({
    initialValue: 20,
    finalValue: 15,
  });
  closeTo(loss.percentageChange, -25);
  closeTo(loss.absoluteDifference, -5);
  assert.equal(loss.isGain, false);
});

test("Liquidation calculator supports Binance and Bybit formulas", () => {
  const binance = calculators.calculateLiquidation({
    exchange: "binance",
    positionType: "long",
    entryPrice: 100,
    leverage: 10,
    margin: 1000,
    maintenanceMarginRate: 0.005,
  });
  closeTo(binance.liquidationPrice, 90.5);
  closeTo(binance.distanceFromEntryPercent, 9.5);

  const bybit = calculators.calculateLiquidation({
    exchange: "bybit",
    positionType: "short",
    entryPrice: 100,
    leverage: 10,
    margin: 1000,
    maintenanceMarginRate: 0.005,
  });
  closeTo(bybit.liquidationPrice, 109.5);
  closeTo(bybit.distanceFromEntryPercent, 9.5);
});

test("Input validation rejects invalid numbers", () => {
  assert.throws(
    () =>
      calculators.calculatePnL({
        entryPrice: 0,
        exitPrice: 90,
        positionSize: 500,
        positionType: "short",
        leverage: 5,
        feePercent: 0.2,
      }),
    /greater than 0/
  );

  assert.throws(
    () =>
      calculators.calculateLiquidation({
        exchange: "binance",
        positionType: "long",
        entryPrice: 100,
        leverage: 10,
        margin: 1000,
        maintenanceMarginRate: 1.2,
      }),
    /between 0 and 1/
  );
});
