const assert = require("node:assert/strict");
const test = require("node:test");
const { formatAnnualRevenue } = require("../src/formatAnnualRevenue");

test("formats a positive annual revenue in USD", () => {
  assert.equal(formatAnnualRevenue(1_250_000), "$1,250,000");
});

test("shows a reported zero instead of treating it as missing", () => {
  assert.equal(formatAnnualRevenue(0), "$0");
});

test("shows an explicit missing value for absent revenue", () => {
  assert.equal(formatAnnualRevenue(null), "Not provided");
  assert.equal(formatAnnualRevenue(undefined), "Not provided");
});
