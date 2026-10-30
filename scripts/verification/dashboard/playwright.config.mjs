import baseline from '/src/playwright.config.ts';

export default {
  ...baseline,
  testDir: '/src/test',
  outputDir: '/tmp/qdev-dashboard/test-results',
  webServer: {
    ...baseline.webServer,
    command: '/node_modules/.bin/vite preview --host 127.0.0.1 --configLoader runner --outDir /tmp/qdev-dashboard/dist --port 4173 --strictPort',
    cwd: '/src',
    reuseExistingServer: false,
  },
};
