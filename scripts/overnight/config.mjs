// Nightly governed issue-to-PR loop: configuration, trigger window and guardrails.
//
// This module is operator-side tooling. It grants no Factory authority by itself:
// every productive step still goes through the supervisor's existing bounded
// connection API (factory.prepare / factory.dispatch), its spend ledger, the
// independent verifier and the human-presence publication approval.
import { isAbsolute } from "node:path";

export const DEFAULTS = Object.freeze({
  label: "factory:overnight",
  holdLabel: "factory:hold",
  window: "22:00-06:00",
  timezone: "America/Los_Angeles",
  origin: "http://127.0.0.1:8789",
  baseBranch: "main",
  // Private-alpha dispatch limits enforced by FactoryDispatchControl.prepare.
  maxSpendUsd: 1.35,
  deadlineSeconds: 600,
  maxIssuesPerNight: 1,
});

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class OvernightConfigError extends Error {
  constructor(message) { super(message); this.name = "OvernightConfigError"; }
}

/** Parse "HH:MM-HH:MM" into minutes after local midnight. The window may wrap midnight. */
export function parseWindow(value) {
  const [start, end, extra] = String(value ?? "").split("-");
  const a = CLOCK.exec(start ?? ""), b = CLOCK.exec(end ?? "");
  if (!a || !b || extra !== undefined) throw new OvernightConfigError("FACTORY_OVERNIGHT_WINDOW must look like 22:00-06:00");
  const startMinutes = Number(a[1]) * 60 + Number(a[2]);
  const endMinutes = Number(b[1]) * 60 + Number(b[2]);
  if (startMinutes === endMinutes) throw new OvernightConfigError("FACTORY_OVERNIGHT_WINDOW start and end must differ");
  return { start: startMinutes, end: endMinutes, text: `${start}-${end}` };
}

function validTimezone(timezone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); return true; } catch { return false; }
}

/** Local calendar date (YYYY-MM-DD) and minutes after midnight for an instant in a timezone. */
export function localClock(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function isWithinWindow(now, config) {
  const { minutes } = localClock(now, config.timezone);
  const { start, end } = config.window;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function previousDate(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The night an instant belongs to, named by the local date on which its window
 * opened. 01:30 on Nov 16 inside a 22:00-06:00 window belongs to night 2026-11-15.
 */
export function nightKey(now, config) {
  const { date, minutes } = localClock(now, config.timezone);
  const { start, end } = config.window;
  return start > end && minutes < end ? previousDate(date) : date;
}

function bool(value) { return value === "1" || value === "true"; }

function number(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new OvernightConfigError(`${name} must be a number`);
  return parsed;
}

/**
 * Build the overnight configuration from the environment. Dry-run is the default:
 * a live run needs FACTORY_OVERNIGHT_LIVE=1 plus a connection token file and a
 * pricing revision, so a misconfigured host can only ever plan, never dispatch.
 */
export function overnightConfigFromEnv(env = process.env) {
  const enabled = bool(env.FACTORY_OVERNIGHT_ENABLED);
  const live = bool(env.FACTORY_OVERNIGHT_LIVE);
  const repository = (env.FACTORY_OVERNIGHT_REPOSITORY ?? "").trim();
  if (!REPOSITORY.test(repository) || repository.endsWith(".git")) {
    throw new OvernightConfigError("FACTORY_OVERNIGHT_REPOSITORY must be owner/repo");
  }
  const repositoryPath = (env.FACTORY_OVERNIGHT_REPOSITORY_PATH ?? "").trim();
  if (!isAbsolute(repositoryPath)) throw new OvernightConfigError("FACTORY_OVERNIGHT_REPOSITORY_PATH must be an absolute local checkout");
  const timezone = (env.FACTORY_OVERNIGHT_TIMEZONE ?? DEFAULTS.timezone).trim();
  if (!validTimezone(timezone)) throw new OvernightConfigError("FACTORY_OVERNIGHT_TIMEZONE must be an IANA timezone");
  const owner = repository.split("/")[0];
  const authors = (env.FACTORY_OVERNIGHT_AUTHORS ?? owner).split(",").map((item) => item.trim()).filter(Boolean);
  if (!authors.length || authors.some((login) => !LOGIN.test(login))) {
    throw new OvernightConfigError("FACTORY_OVERNIGHT_AUTHORS must be a comma-separated list of GitHub logins");
  }
  const maxSpendUsd = number(env.FACTORY_OVERNIGHT_MAX_SPEND_USD, DEFAULTS.maxSpendUsd, "FACTORY_OVERNIGHT_MAX_SPEND_USD");
  if (!(maxSpendUsd > 0 && maxSpendUsd <= DEFAULTS.maxSpendUsd)) {
    throw new OvernightConfigError(`FACTORY_OVERNIGHT_MAX_SPEND_USD must be above 0 and at most ${DEFAULTS.maxSpendUsd}`);
  }
  const deadlineSeconds = number(env.FACTORY_OVERNIGHT_DEADLINE_SECONDS, DEFAULTS.deadlineSeconds, "FACTORY_OVERNIGHT_DEADLINE_SECONDS");
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < 60 || deadlineSeconds > DEFAULTS.deadlineSeconds) {
    throw new OvernightConfigError(`FACTORY_OVERNIGHT_DEADLINE_SECONDS must be an integer from 60 to ${DEFAULTS.deadlineSeconds}`);
  }
  const maxIssuesPerNight = number(env.FACTORY_OVERNIGHT_MAX_PER_NIGHT, DEFAULTS.maxIssuesPerNight, "FACTORY_OVERNIGHT_MAX_PER_NIGHT");
  if (maxIssuesPerNight !== 1) throw new OvernightConfigError("FACTORY_OVERNIGHT_MAX_PER_NIGHT is fixed at 1 for the governed loop");
  const tokenFile = (env.FACTORY_OVERNIGHT_TOKEN_FILE ?? "").trim() || null;
  const pricingRevision = (env.FACTORY_OVERNIGHT_PRICING_REVISION ?? "").trim() || null;
  const dataDir = (env.FACTORY_OVERNIGHT_DATA_DIR ?? env.FACTORY_DATA_DIR ?? "").trim();
  if (!isAbsolute(dataDir)) throw new OvernightConfigError("FACTORY_OVERNIGHT_DATA_DIR (or FACTORY_DATA_DIR) must be absolute");
  if (live) {
    if (!tokenFile || !isAbsolute(tokenFile)) throw new OvernightConfigError("Live overnight runs need an absolute FACTORY_OVERNIGHT_TOKEN_FILE");
    if (!pricingRevision) throw new OvernightConfigError("Live overnight runs need FACTORY_OVERNIGHT_PRICING_REVISION matching the supervisor's qualified price");
  }
  const origin = (env.FACTORY_OVERNIGHT_ORIGIN ?? DEFAULTS.origin).trim();
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); } catch { throw new OvernightConfigError("FACTORY_OVERNIGHT_ORIGIN must be a URL"); }
  if (parsedOrigin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsedOrigin.hostname)) {
    throw new OvernightConfigError("FACTORY_OVERNIGHT_ORIGIN must be the loopback supervisor");
  }
  return Object.freeze({
    enabled, dryRun: !live, repository, repositoryPath, timezone, authors,
    window: parseWindow(env.FACTORY_OVERNIGHT_WINDOW ?? DEFAULTS.window),
    label: (env.FACTORY_OVERNIGHT_LABEL ?? DEFAULTS.label).trim(),
    holdLabel: (env.FACTORY_OVERNIGHT_HOLD_LABEL ?? DEFAULTS.holdLabel).trim(),
    baseBranch: (env.FACTORY_OVERNIGHT_BASE_BRANCH ?? DEFAULTS.baseBranch).trim(),
    maxSpendUsd, deadlineSeconds, maxIssuesPerNight, tokenFile, pricingRevision, dataDir,
    origin: parsedOrigin.origin,
    requestPublication: bool(env.FACTORY_OVERNIGHT_REQUEST_PUBLICATION),
  });
}

/**
 * Decide whether tonight's run may start. `ledger` is the durable overnight
 * ledger ({ nights: { [nightKey]: entry } }). One entry per night is the cap:
 * a crashed or failed attempt still consumes the night.
 */
export function overnightGuard({ config, now, ledger, policy }) {
  if (!config.enabled) return { ok: false, reason: "disabled", detail: "Set FACTORY_OVERNIGHT_ENABLED=1 to arm the overnight loop." };
  if (!isWithinWindow(now, config)) return { ok: false, reason: "outside_window", detail: `Outside ${config.window.text} ${config.timezone}.` };
  const night = nightKey(now, config);
  const used = Object.keys(ledger?.nights ?? {}).filter((key) => key === night && ledger.nights[key]?.mode === "live").length;
  if (!config.dryRun && used >= config.maxIssuesPerNight) {
    return { ok: false, reason: "night_used", night, detail: `Night ${night} already used its one governed attempt.` };
  }
  if (policy?.dispatchPaused === true) return { ok: false, reason: "dispatch_paused", night, detail: "Factory dispatch is paused by policy." };
  return { ok: true, reason: "ready", night, detail: config.dryRun ? "Dry run: will plan without dispatching." : "Live: one governed attempt allowed." };
}
