import {defineConfig, devices} from '@playwright/test'

// Makes the pictures of the documentation (public/docs/img). Not part of `npm test`:
// `bun run docs:shots` builds nothing by itself, so run `bun run build` first.
export default defineConfig({
	testDir: '.',
	testMatch: 'docs-shots.spec.ts',
	// WebGL is drawn by software here: one picture at a time.
	workers: 1,
	timeout: 180_000,
	reporter: 'list',
	use: {baseURL: 'http://localhost:4173'},
	projects: [
		{
			name: 'chromium',
			use: {...devices['Desktop Chrome'], viewport: {width: 1400, height: 900}, deviceScaleFactor: 2},
		},
	],
	webServer: {command: 'bun run preview -- --strictPort', port: 4173, reuseExistingServer: true, cwd: '../..'},
})
