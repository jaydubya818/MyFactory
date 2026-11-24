import assert from "node:assert/strict";
import test from "node:test";
import { isWithinWindow, localClock, nightKey, overnightConfigFromEnv, overnightGuard, parseWindow,
  OvernightConfigError } from "../../../scripts/overnight/config.mjs";

const base = {
  FACTORY_OVERNIGHT_ENABLED: "1",
  FACTORY_OVERNIGHT_REPOSITORY: "jaydubya818/MyFactory",
  FACTORY_OVERNIGHT_REPOSITORY_PATH: "/Users/example/MyFactory",
  FACTORY_OVERNIGHT_DATA_DIR: "/Users/example/.local/share/sellerfi-factory",
};
const config = (extra = {}) => overnightConfigFromEnv({ ...base, ...extra });
// 2026-11-16 01:30 PST and 2026-11-15 18:00 PST.
const lateNight = new Date("2026-11-16T09:30:00Z");
const evening = new Date("2026-11-16T02:00:00Z");

test("defaults to a dry run with the private-alpha ceilings", () => {
  const c = config();
  assert.equal(c.dryRun, true);
  assert.equal(c.label, "factory:overnight");
  assert.equal(c.maxSpendUsd, 1.35);
  assert.equal(c.deadlineSeconds, 600);
  assert.equal(c.maxIssuesPerNight, 1);
  assert.deepEqual(c.authors, ["jaydubya818"]);
  assert.equal(c.window.text, "22:00-06:00");
});

test("live mode requires a token file and a pricing revision", () => {
  assert.throws(() => config({ FACTORY_OVERNIGHT_LIVE: "1" }), /TOKEN_FILE/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_LIVE: "1", FACTORY_OVERNIGHT_TOKEN_FILE: "/t" }), /PRICING_REVISION/);
  const c = config({ FACTORY_OVERNIGHT_LIVE: "1", FACTORY_OVERNIGHT_TOKEN_FILE: "/t", FACTORY_OVERNIGHT_PRICING_REVISION: "rev" });
  assert.equal(c.dryRun, false);
});

test("rejects ceilings above the governed limits", () => {
  assert.throws(() => config({ FACTORY_OVERNIGHT_MAX_SPEND_USD: "5" }), OvernightConfigError);
  assert.throws(() => config({ FACTORY_OVERNIGHT_DEADLINE_SECONDS: "3600" }), OvernightConfigError);
  assert.throws(() => config({ FACTORY_OVERNIGHT_MAX_PER_NIGHT: "2" }), /fixed at 1/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_ORIGIN: "https://example.com" }), /loopback/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_REPOSITORY: "not a repo" }), /owner\/repo/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_REPOSITORY_PATH: "relative" }), /absolute/);
});

test("parses windows, including ones that wrap midnight", () => {
  assert.deepEqual(parseWindow("22:00-06:00"), { start: 1320, end: 360, text: "22:00-06:00" });
  assert.throws(() => parseWindow("10pm-6am"), OvernightConfigError);
  assert.throws(() => parseWindow("06:00-06:00"), OvernightConfigError);
});

test("window and night key follow the configured timezone", () => {
  const c = config();
  assert.deepEqual(localClock(lateNight, c.timezone), { date: "2026-11-16", minutes: 90 });
  assert.equal(isWithinWindow(lateNight, c), true);
  assert.equal(isWithinWindow(evening, c), false);
  assert.equal(nightKey(lateNight, c), "2026-11-15");
  assert.equal(nightKey(new Date("2026-11-16T06:30:00Z"), c), "2026-11-15"); // 22:30 PST
  const day = config({ FACTORY_OVERNIGHT_WINDOW: "09:00-17:00" });
  assert.equal(isWithinWindow(new Date("2026-11-16T20:00:00Z"), day), true); // 12:00 PST
});

test("guard enforces enabled, window, one live attempt per night and pause", () => {
  assert.equal(overnightGuard({ config: config({ FACTORY_OVERNIGHT_ENABLED: "0" }), now: lateNight, ledger: {} }).reason, "disabled");
  assert.equal(overnightGuard({ config: config(), now: evening, ledger: {} }).reason, "outside_window");
  const live = config({ FACTORY_OVERNIGHT_LIVE: "1", FACTORY_OVERNIGHT_TOKEN_FILE: "/t", FACTORY_OVERNIGHT_PRICING_REVISION: "r" });
  const used = { nights: { "2026-11-15": { mode: "live", issue: 1 } } };
  assert.equal(overnightGuard({ config: live, now: lateNight, ledger: used }).reason, "night_used");
  assert.equal(overnightGuard({ config: live, now: lateNight, ledger: {} }).ok, true);
  assert.equal(overnightGuard({ config: live, now: lateNight, ledger: {}, policy: { dispatchPaused: true } }).reason, "dispatch_paused");
  // A dry run never consumes or is blocked by the night.
  assert.equal(overnightGuard({ config: config(), now: lateNight, ledger: used }).ok, true);
});

test("window edges: start is inclusive, end is exclusive, and invalid clocks are rejected", () => {
  const c = config();
  assert.equal(isWithinWindow(new Date("2026-11-16T06:00:00Z"), c), true); // 22:00 PST opens the window
  assert.equal(isWithinWindow(new Date("2026-11-16T05:59:00Z"), c), false); // 21:59 PST
  assert.equal(isWithinWindow(new Date("2026-11-16T13:59:00Z"), c), true); // 05:59 PST
  assert.equal(isWithinWindow(new Date("2026-11-16T14:00:00Z"), c), false); // 06:00 PST closes it
  assert.throws(() => parseWindow("24:00-06:00"), OvernightConfigError);
  assert.throws(() => parseWindow("22:60-06:00"), OvernightConfigError);
});

test("authors default to the repository owner and invalid logins, timezones and origins are rejected", () => {
  assert.deepEqual(config().authors, ["jaydubya818"]);
  assert.deepEqual(config({ FACTORY_OVERNIGHT_AUTHORS: " alice , bob " }).authors, ["alice", "bob"]);
  assert.throws(() => config({ FACTORY_OVERNIGHT_AUTHORS: "bad login" }), /GitHub logins/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_AUTHORS: "-leading" }), /GitHub logins/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_TIMEZONE: "Mars/Olympus" }), /IANA timezone/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_REPOSITORY: "jaydubya818/MyFactory.git" }), /owner\/repo/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_ORIGIN: "not a url" }), /must be a URL/);
  assert.throws(() => config({ FACTORY_OVERNIGHT_MAX_SPEND_USD: "abc" }), /must be a number/);
  assert.equal(config({ FACTORY_OVERNIGHT_ORIGIN: "http://localhost:8789" }).origin, "http://localhost:8789");
});
