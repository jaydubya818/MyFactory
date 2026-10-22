/**
 * Browser regression tests for QA findings: QA-06, QA-23, QA-24, QA-25, QA-41, QA-42.
 *
 * These tests start a real supervisor HTTP server (with injected confirmHumanPresence so
 * no macOS Touch ID is needed), serve the built web UI, and drive Chromium via Playwright
 * to exercise the in-browser fixes.
 *
 * Run: node --test test/browser-qa-regressions.test.mjs
 * Requires: built web dist at apps/web/dist (npm run build --workspace=@factory/web)
 *           Playwright Chromium installed (npx playwright install chromium)
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { createSupervisor } from "../src/server.ts";

const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));

// ---------------------------------------------------------------------------
// Shared fixture: supervisor + browser
// ---------------------------------------------------------------------------

async function withDesk(t, confirmHumanPresence, fn) {
  const dataDir = mkdtempSync(join(tmpdir(), "factory-browser-qa-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const supervisor = createSupervisor({ dataDir, webDist, linear: {}, confirmHumanPresence });
  await new Promise((resolve) => supervisor.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${supervisor.server.address().port}`;
  t.after(() => supervisor.close());

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  await fn({ browser, origin, supervisor, dataDir });
}

// Confirm (injectable): returns true — simulates the owner approving on macOS.
const confirmApproved = async () => true;
// Confirm (injectable): returns false — simulates the owner physically rejecting Touch ID.
const confirmDenied = async () => false;
// Confirm absent (undefined) — simulates non-darwin host; requireHumanPresence throws 503.
const confirmUnavailable = undefined;

// ---------------------------------------------------------------------------
// QA-06: Pause dispatch — visible, focused, persistent error after API rejection
// ---------------------------------------------------------------------------

test("QA-06: 403 denied — error is visible, has role=alert, and persists after secondary refresh", async (t) => {
  await withDesk(t, confirmDenied, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(origin);

    // Wait for the DispatchControl to load policy.
    const pauseBtn = page.locator('button:has-text("Pause dispatch")');
    await pauseBtn.waitFor({ state: "visible", timeout: 5000 });

    // Click Pause — injected confirmHumanPresence returns false → 403 denied.
    await pauseBtn.click();

    // The error paragraph with role=alert must appear.
    const errorEl = page.locator('[role="alert"].dispatch-control__error');
    await errorEl.waitFor({ state: "visible", timeout: 5000 });

    const errorText = await errorEl.textContent();
    assert.ok(errorText && errorText.length > 0, "Error element must have text");

    // The error must still be present after the secondary policy re-fetch.
    // Wait 1.5s for any async refresh to complete, then recheck.
    await page.waitForTimeout(1500);
    assert.ok(await errorEl.isVisible(), "Error must persist after secondary policy refresh");

    // Policy must still show "Dispatch active" (not "Dispatch paused").
    const heading = await page.locator("#dispatch-heading").textContent();
    assert.match(heading ?? "", /active|loading/, "Policy heading must not show paused");
  });
});

test("QA-06: 503 unavailable (non-darwin path) — error is visible with platform context", async (t) => {
  await withDesk(t, confirmUnavailable, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(origin);

    const pauseBtn = page.locator('button:has-text("Pause dispatch")');
    await pauseBtn.waitFor({ state: "visible", timeout: 5000 });
    await pauseBtn.click();

    const errorEl = page.locator('[role="alert"].dispatch-control__error');
    await errorEl.waitFor({ state: "visible", timeout: 5000 });

    const errorText = await errorEl.textContent() ?? "";
    assert.ok(
      /mac|platform|macOS/i.test(errorText),
      `503 error message must explain the platform requirement; got: "${errorText}"`,
    );

    await page.waitForTimeout(1500);
    assert.ok(await errorEl.isVisible(), "503 error must persist after secondary policy refresh");
  });
});

test("QA-06: Retry policy button clears error and re-fetches", async (t) => {
  await withDesk(t, confirmDenied, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(origin);

    const pauseBtn = page.locator('button:has-text("Pause dispatch")');
    await pauseBtn.waitFor({ state: "visible", timeout: 5000 });
    await pauseBtn.click();

    const errorEl = page.locator('[role="alert"].dispatch-control__error');
    await errorEl.waitFor({ state: "visible", timeout: 5000 });

    const retryBtn = page.locator('button:has-text("Retry policy")');
    await retryBtn.waitFor({ state: "visible", timeout: 3000 });
    await retryBtn.click();

    // After retry the error should clear and the policy should re-render.
    await page.waitForTimeout(800);
    const errorVisible = await errorEl.isVisible().catch(() => false);
    assert.equal(errorVisible, false, "Error should be cleared after Retry policy");

    // Dispatch heading should show a valid state.
    const heading = await page.locator("#dispatch-heading").textContent();
    assert.match(heading ?? "", /active|paused/, "Heading should show a known state after retry");
  });
});

// ---------------------------------------------------------------------------
// QA-23: New WorkOrder validation errors — visible, focused, in viewport
// ---------------------------------------------------------------------------

test("QA-23: empty submit shows client-side error with role=alert (noValidate form)", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(origin);

    // Open New Work form via nav.
    const newWorkBtn = page.locator('.side-nav__item[aria-label="New work"]');
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    // Wait for form to render; connections check completes.
    await page.waitForTimeout(600);

    // Submit completely empty form.
    // The form has noValidate so our custom submit() always runs.
    const submitBtn = page.locator('button:has-text("Create work order")');
    await submitBtn.waitFor({ state: "visible", timeout: 5000 });
    await submitBtn.click();

    // Error div must appear with role=alert.
    const errorEl = page.locator('.create-form [role="alert"]');
    await errorEl.waitFor({ state: "visible", timeout: 5000 });

    const errorText = await errorEl.textContent() ?? "";
    assert.ok(errorText.length > 0, "Validation error must have text");
    assert.ok(
      /title|description|repository|base ref|ref|complete/i.test(errorText),
      `Empty-form error must mention missing fields; got: "${errorText}"`,
    );

    // Error must be visible in the viewport.
    const box = await errorEl.boundingBox();
    assert.ok(box, "Error element must be rendered");
    const viewportSize = page.viewportSize();
    assert.ok(
      box.y + box.height <= (viewportSize?.height ?? 1000) + 50,
      `Error element (bottom=${box.y + box.height}) must be near or within the ${viewportSize?.height}px viewport`,
    );
  });
});

test("QA-23: validation error gets focus and is in viewport (focus management)", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(origin);

    const newWorkBtn = page.locator('.side-nav__item[aria-label="New work"]');
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    await page.waitForTimeout(600);

    // Fill only enough to trigger the "acceptance criterion / permitted path / check command"
    // error (which fires after the title/description/repo/ref checks pass).
    await page.locator("#work-title").fill("Focus test");
    await page.locator("#work-description").fill("Description.");
    await page.locator("#repository-path").fill("/tmp/test-repo");
    await page.locator("#base-ref").fill("main");
    // Leave criteria/paths/checks empty → custom validation fires.

    await page.locator('button:has-text("Create work order")').click();

    const errorEl = page.locator('.create-form [role="alert"]');
    await errorEl.waitFor({ state: "visible", timeout: 5000 });

    const errorText = await errorEl.textContent() ?? "";
    assert.ok(errorText.length > 0, "Error element must have text");

    // The error element should have received focus via useEffect.
    const focusedRole = await page.evaluate(() => document.activeElement?.getAttribute("role"));
    assert.equal(focusedRole, "alert", "Focused element should have role=alert after validation error");

    // Error must be in the visible viewport area.
    const box = await errorEl.boundingBox();
    assert.ok(box, "Error must be rendered");
    const viewport = page.viewportSize();
    assert.ok(
      box.y + box.height <= (viewport?.height ?? 800) + 50,
      `Error (bottom=${box.y + box.height}) must be in or near the ${viewport?.height}px viewport`,
    );
  });
});

// ---------------------------------------------------------------------------
// QA-24: Draft persistence — survives reload; cleared on cancel; no credential leak
// ---------------------------------------------------------------------------

test("QA-24: draft is saved to sessionStorage and restored after reload", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origin);

    // Open New Work form.
    const newWorkBtn = page.locator('.side-nav__item[aria-label="New work"]');
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    // Type into title field.
    const titleInput = page.locator("#work-title");
    await titleInput.waitFor({ state: "visible", timeout: 5000 });
    await titleInput.fill("Draft persistence test");

    // Wait for draft to be saved (debounced by React state + useEffect).
    await page.waitForTimeout(300);

    // Verify sessionStorage has the draft.
    const draftRaw = await page.evaluate(() => sessionStorage.getItem("myfactory-new-work-draft-v1"));
    assert.ok(draftRaw, "Draft must be saved to sessionStorage");
    const draft = JSON.parse(draftRaw);
    assert.equal(draft.title, "Draft persistence test", "Draft title must match");

    // QA-24: confirm no credential/token fields are in the draft.
    const FORBIDDEN_KEYS = ["token", "sessionToken", "password", "secret", "credential", "apiKey", "auth"];
    for (const key of FORBIDDEN_KEYS) {
      assert.equal(key in draft, false, `Draft must not persist field "${key}"`);
    }
    // Also confirm the actual session token value is not in the serialized draft.
    const sessionTokenRes = await page.evaluate(async () => {
      const r = await fetch("/api/session");
      return r.ok ? (await r.json()).token : null;
    });
    if (sessionTokenRes) {
      assert.equal(draftRaw.includes(sessionTokenRes), false, "Draft must not contain the session token value");
    }

    // Reload the page.
    await page.reload();

    // Navigate to New Work form again.
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    // Title should be restored from draft.
    const restoredTitle = await titleInput.inputValue();
    assert.equal(restoredTitle, "Draft persistence test", "Title must be restored from draft after reload");
  });
});

test("QA-24: draft is cleared on cancel", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origin);

    const newWorkBtn = page.locator('.side-nav__item[aria-label="New work"]');
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    await page.locator("#work-title").fill("Will be cancelled");
    await page.waitForTimeout(300);

    // Click Cancel.
    await page.locator('button:has-text("Back to queue")').click();
    await page.waitForTimeout(300);

    const draftAfterCancel = await page.evaluate(() => sessionStorage.getItem("myfactory-new-work-draft-v1"));
    assert.equal(draftAfterCancel, null, "Draft must be cleared after cancel");
  });
});

test("QA-24: draft fields are only work-order metadata (no credential fields persisted)", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origin);

    const newWorkBtn = page.locator('.side-nav__item[aria-label="New work"]');
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    await page.locator("#work-title").fill("Metadata only");
    await page.waitForTimeout(300);

    const draftRaw = await page.evaluate(() => sessionStorage.getItem("myfactory-new-work-draft-v1"));
    assert.ok(draftRaw, "Draft must exist");
    const draft = JSON.parse(draftRaw);

    const ALLOWED_KEYS = new Set(["title", "description", "kind", "repositoryPath", "baseRef",
      "acceptanceCriteria", "reproductionCommand", "expectedFailureText", "checkCommands",
      "allowedPaths", "workerProfile"]);
    for (const key of Object.keys(draft)) {
      assert.ok(ALLOWED_KEYS.has(key), `Unexpected field in draft: "${key}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// QA-25: Connections nav has accessible name; mobile nav targets >= 44px
// ---------------------------------------------------------------------------

test("QA-25: Connections nav button has an accessible name via aria-label", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(origin);

    // Find the Connections nav button.
    const connectionsBtn = page.locator('.side-nav__item[aria-label="Connections"]');
    await connectionsBtn.waitFor({ state: "visible", timeout: 5000 });

    const label = await connectionsBtn.getAttribute("aria-label");
    assert.equal(label, "Connections", "Connections button must have aria-label=Connections");
  });
});

test("QA-25: mobile nav items are at least 44px tall at 390px width", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(origin);

    // Wait for navigation to render.
    await page.waitForTimeout(500);

    // At 390px the side-nav becomes a horizontal bar; nav items should be >= 44px tall.
    const navItems = page.locator(".side-nav__item");
    const count = await navItems.count();
    assert.ok(count > 0, "Nav items must be present");

    for (let i = 0; i < count; i++) {
      const box = await navItems.nth(i).boundingBox();
      if (!box) continue;
      assert.ok(box.height >= 43.5,
        `Nav item ${i} height=${box.height.toFixed(1)}px must be >= 44px`);
    }
  });
});

// ---------------------------------------------------------------------------
// QA-41: Relative repository path rejected client-side with clear message
// ---------------------------------------------------------------------------

test("QA-41: relative repository path fails client-side validation with an informative message", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(origin);

    const newWorkBtn = page.locator('.side-nav__item[aria-label="New work"]');
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    await page.waitForTimeout(600);

    // Fill all fields required by validation so only the path check triggers.
    await page.locator("#work-title").fill("Test absolute path validation");
    await page.locator("#work-description").fill("Description for QA-41 test.");
    // Provide a relative path — should be caught client-side.
    await page.locator("#repository-path").fill("relative/path");
    await page.locator("#base-ref").fill("main");
    await page.locator("#work-criteria").fill("Test passes");
    await page.locator("#allowed-paths").fill("src/");
    await page.locator("#check-commands").fill("npm test");

    await page.locator('button:has-text("Create work order")').click();

    const errorEl = page.locator('.create-form [role="alert"]');
    await errorEl.waitFor({ state: "visible", timeout: 5000 });

    const errorText = await errorEl.textContent() ?? "";
    assert.ok(
      /absolute|must start with|\//.test(errorText),
      `Error must mention absolute path requirement; got: "${errorText}"`,
    );
  });
});

test("QA-41: absolute repository path passes the client-side path check", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(origin);

    const newWorkBtn = page.locator('.side-nav__item[aria-label="New work"]');
    await newWorkBtn.waitFor({ state: "visible", timeout: 5000 });
    await newWorkBtn.click();

    await page.locator("#work-title").fill("Valid absolute path");
    await page.locator("#work-description").fill("Description.");
    await page.locator("#repository-path").fill("/tmp/does-not-exist");
    await page.locator("#base-ref").fill("main");
    await page.locator("#work-criteria").fill("Passes");
    await page.locator("#allowed-paths").fill("src/");
    await page.locator("#check-commands").fill("true");

    await page.locator('button:has-text("Create work order")').click();

    // Should NOT see the "must start with /" error — path check passes.
    await page.waitForTimeout(500);
    const errorEl = page.locator('.create-form [role="alert"]');
    const hasError = await errorEl.isVisible().catch(() => false);
    if (hasError) {
      const errorText = await errorEl.textContent() ?? "";
      assert.ok(
        !/absolute|must start with/.test(errorText),
        `Should not see absolute-path error for a valid path; got: "${errorText}"`,
      );
    }
    // Either no error, or the error is not about the path (e.g. server unavailability) — both acceptable.
  });
});

// ---------------------------------------------------------------------------
// QA-42: Unknown ?view= shows "Unknown view" panel, not silent Overview
// ---------------------------------------------------------------------------

test("QA-42: unknown ?view= parameter shows an explicit not-found notice", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(`${origin}/?view=apps`);

    // The "Unknown view" empty-message panel must appear.
    const notFoundPanel = page.locator('.empty-message:has-text("Unknown view")');
    await notFoundPanel.waitFor({ state: "visible", timeout: 5000 });

    const heading = await notFoundPanel.locator("h3").textContent();
    assert.equal(heading, "Unknown view", "Not-found panel must have 'Unknown view' heading");

    // Breadcrumb should show "Not found".
    const breadcrumb = await page.locator(".breadcrumb > span:last-child").textContent();
    assert.equal(breadcrumb, "Not found", "Breadcrumb must say 'Not found' for an unknown view");
  });
});

test("QA-42: known ?view=queue does NOT trigger the unknown-view panel", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(`${origin}/?view=queue`);

    // The known view should render without the not-found panel.
    await page.waitForTimeout(800);
    const notFoundVisible = await page.locator('.empty-message:has-text("Unknown view")').isVisible().catch(() => false);
    assert.equal(notFoundVisible, false, "Known ?view=queue must not show the unknown-view panel");

    // Breadcrumb should show "Work queue".
    const breadcrumb = await page.locator(".breadcrumb > span:last-child").textContent();
    assert.equal(breadcrumb, "Work queue", "Breadcrumb must say 'Work queue' for the queue view");
  });
});

test("QA-42: Go to Overview button on unknown-view panel navigates home", async (t) => {
  await withDesk(t, confirmApproved, async ({ browser, origin }) => {
    const page = await browser.newPage();
    await page.goto(`${origin}/?view=nonexistent`);

    const goHomeBtn = page.locator('.empty-message button:has-text("Go to Overview")');
    await goHomeBtn.waitFor({ state: "visible", timeout: 5000 });
    await goHomeBtn.click();

    // After clicking, the Overview page should render.
    const overviewPanel = page.locator(".overview-page").first();
    await overviewPanel.waitFor({ state: "visible", timeout: 5000 });

    const notFoundStillVisible = await page.locator('.empty-message:has-text("Unknown view")').isVisible().catch(() => false);
    assert.equal(notFoundStillVisible, false, "Unknown-view panel must disappear after navigating home");
  });
});
