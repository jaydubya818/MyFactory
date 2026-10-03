import { chromium } from 'playwright';
import { storeEvidence, type EvidenceBinding, type EvidenceRef } from './evidence.ts';

export interface BrowserJourney {
  url: string;
  path: string;
  expectedText: string[];
  viewport?: { width: number; height: number };
}

export interface BrowserCapture {
  refs: EvidenceRef[];
  assertions: { text: string; found: boolean }[];
  httpStatus: number | null;
}

/** Capture is bounded to a local disposable preview. It records observations, never a PASS decision. */
export async function collectBrowserEvidence(root: string, binding: EvidenceBinding, journey: BrowserJourney, signal?: AbortSignal): Promise<BrowserCapture> {
  const origin = new URL(journey.url);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
    origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
    !journey.path.startsWith('/') || journey.path.startsWith('//') || journey.path.includes('..') || journey.path.includes('?') || journey.path.includes('#') ||
    journey.expectedText.length < 1 || journey.expectedText.length > 12 || journey.expectedText.some(value => !value || value.length > 200)) {
    throw new Error('Browser journey must target a bounded local preview');
  }
  const viewport = journey.viewport ?? { width: 1280, height: 800 };
  if (!Number.isSafeInteger(viewport.width) || viewport.width < 320 || viewport.width > 1920 ||
    !Number.isSafeInteger(viewport.height) || viewport.height < 240 || viewport.height > 1200) throw new Error('Invalid viewport');
  if (signal?.aborted) throw new Error('Browser capture cancelled');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', ignoreHTTPSErrors: false });
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      return target.origin === origin.origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const abort = () => { void page.close().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await page.goto(new URL(journey.path, origin).href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const assertions: BrowserCapture['assertions'] = [];
      for (const expected of journey.expectedText) {
        assertions.push({ text: expected, found: await page.getByText(expected, { exact: false }).first().isVisible().catch(() => false) });
      }
      const screenshot = await page.screenshot({ fullPage: false, animations: 'disabled', timeout: 10_000 });
      const observed = {
        requestedUrl: new URL(journey.path, origin).href,
        finalUrl: page.url(),
        httpStatus: response?.status() ?? null,
        assertions,
        viewport,
        capturedAt: new Date().toISOString(),
      };
      const source = 'playwright:local-preview';
      const refs = [
        await storeEvidence(root, binding, 'ScreenshotEvidence', 'image/png', source, screenshot),
        await storeEvidence(root, binding, 'BrowserJourneyEvidence', 'application/json', source, Buffer.from(JSON.stringify(observed))),
      ];
      return { refs, assertions, httpStatus: observed.httpStatus };
    } finally { signal?.removeEventListener('abort', abort); await context.close(); }
  } finally { await browser.close(); }
}
