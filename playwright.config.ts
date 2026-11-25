import {defineConfig, devices} from '@playwright/test'

// E2E_MODE=dev runs against the dev server, where Solid reports mistakes that
// the production build stays silent about.
const dev = process.env.E2E_MODE === 'dev'
const port = dev ? 5173 : 4173

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	reporter: 'list',
	use: {baseURL: `http://localhost:${port}`, trace: 'retain-on-failure'},
	projects: [{name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1400, height: 900}}}],
	webServer: {
		command: dev ? 'bun run dev -- --strictPort' : 'bun run preview -- --strictPort',
		port,
		reuseExistingServer: !process.env.CI,
	},
})
