import {test, expect, type Page, type Locator} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * The pictures of the documentation, made from the real editor: `npm run build`,
 * then `npm run docs:shots`. Each picture of the interface is made twice, in the
 * light theme as NAME.png and in the dark one as NAME-dark.png: the page is set
 * up once, and only the system's colour scheme changes between the two.
 */
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/docs/img')
mkdirSync(OUT, {recursive: true})

const code = (page: Page) => page.locator('#code')
const keyframes = (page: Page, layer: number, prop: string) =>
	page.locator(`.row.prop[data-layer="${layer}"][data-prop="${prop}"] .keyframe`)

async function scrubTo(page: Page, ms: number) {
	await page.locator('#ruler').click({position: {x: ms * 0.2, y: 10}})
}

async function choose(page: Page, title: string, action: string) {
	await page.locator('.menu-title', {hasText: title}).click()
	const path = action.startsWith('template:')
		? ['Pre-ready']
		: /^import-(es6-tween|kute)$/.test(action)
			? ['Migrations', 'Import']
			: action.startsWith('export-')
				? ['Migrations', 'Export']
				: []
	for (const submenu of path) await page.locator(`.menu-items:popover-open [data-submenu="${submenu}"]`).hover()
	await page.locator(`.menu-items:popover-open [data-action="${action}"]`).click()
}

type Clip = {x: number; y: number; width: number; height: number}

/** The box around some elements, with room around it, kept inside the page. */
async function around(page: Page, targets: Locator[], margin = 12): Promise<Clip> {
	let left = Infinity
	let top = Infinity
	let right = 0
	let bottom = 0
	for (const target of targets) {
		for (const box of await target.evaluateAll(all =>
			all
				.map(element => element.getBoundingClientRect())
				.filter(rect => rect.width > 0 && rect.height > 0)
				.map(({left, top, right, bottom}) => ({left, top, right, bottom})),
		)) {
			left = Math.min(left, box.left)
			top = Math.min(top, box.top)
			right = Math.max(right, box.right)
			bottom = Math.max(bottom, box.bottom)
		}
	}
	const size = page.viewportSize()!
	const x = Math.max(0, Math.floor(left - margin))
	const y = Math.max(0, Math.floor(top - margin))
	return {
		x,
		y,
		width: Math.min(size.width, Math.ceil(right + margin)) - x,
		height: Math.min(size.height, Math.ceil(bottom + margin)) - y,
	}
}

/** The same picture in both themes. The page keeps its state: only the colour scheme changes. */
async function themed(page: Page, name: string, clip?: Clip | (() => Promise<Clip>)) {
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'})
		await page.waitForTimeout(250)
		const box = typeof clip === 'function' ? await clip() : clip
		await page.screenshot({path: `${OUT}/${name}${scheme === 'dark' ? '-dark' : ''}.png`, ...(box ? {clip: box} : {})})
	}
}

/** Moves the pointer away, so no hover state is in the picture. */
const rest = (page: Page) => page.mouse.move(700, 880)

test.describe('pictures of the editor', () => {
	test.beforeEach(async ({page}) => {
		page.on('pageerror', error => console.log('PAGEERROR', String(error)))
		await page.goto('/')
		await expect(page.locator('.row.layer')).toHaveCount(3)
		await expect(page.locator('#code-status')).toHaveText('In sync')
		// Wait for the highlighter: its chunk is loaded on the first paint.
		await expect.poll(() => page.evaluate(() => (CSS as any).highlights?.size ?? 0)).toBeGreaterThan(0)
	})

	async function ball(page: Page) {
		await page.locator('.row.layer', {hasText: 'Ball'}).click()
		await scrubTo(page, 1200)
	}

	test('window', async ({page}) => {
		await ball(page)
		await rest(page)
		await themed(page, 'window')
	})

	test('layout-panels', async ({page}) => {
		await ball(page)
		// The right divider, as it is while it is dragged.
		const box = (await page.locator('.divider-right').boundingBox())!
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await themed(page, 'layout-panels')
	})

	for (const [name, title, submenus] of [
		['menu-file', 'File', []],
		['menu-edit', 'Edit', []],
		['menu-media', 'Media', []],
		['menu-format', 'Format', ['Migrations']],
		['menu-templates', 'Templates', ['Pre-ready']],
	] as Array<[string, string, string[]]>) {
		test(name, async ({page}) => {
			await ball(page)
			const title_ = page.locator('.menu-title', {hasText: title})
			await title_.click()
			const open = page.locator('.menu-items:popover-open')
			for (const submenu of submenus) await open.locator(`[data-submenu="${submenu}"]`).hover()
			if (name === 'menu-format') await open.locator('[data-submenu="Import"]').hover()
			if (name === 'menu-templates') await open.locator('[data-action="template:Sign-in flow"]').hover()
			await themed(page, name, () =>
				around(page, [title_, open, page.locator('.menu-items:popover-open .menu-items')], 16),
			)
		})
	}

	test('properties-layer', async ({page}) => {
		await ball(page)
		await rest(page)
		await themed(page, 'properties-layer', () => around(page, [page.locator('#inspector')], 0))
	})

	test('properties-keyframe and curve-tool', async ({page}) => {
		await ball(page)
		await keyframes(page, 1, 'x').first().click()
		await page.locator('#easing').selectOption('Quadratic.InOut')
		await rest(page)
		await themed(page, 'properties-keyframe', () => around(page, [page.locator('#inspector')], 0))

		// A custom curve: a handle pulled down and a point added, like the guide does.
		await page.locator('#easing').selectOption('curve')
		const unit = (await page.locator('#curve .unit').boundingBox())!
		const handle = page.locator('#curve .handle').first()
		await handle.hover()
		await page.mouse.down()
		await page.mouse.move(unit.x + unit.width * 0.75, unit.y + unit.height * 0.95, {steps: 4})
		await page.mouse.up()
		const graph = (await page.locator('#curve').boundingBox())!
		await page.mouse.dblclick(graph.x + graph.width * 0.62, graph.y + graph.height * 0.12)
		await rest(page)
		await themed(page, 'curve-tool', () => around(page, [page.locator('#curve'), page.locator('#easing')], 16))
	})

	test('timeline and transport', async ({page}) => {
		await ball(page)
		await keyframes(page, 1, 'x').first().click()
		await rest(page)
		await themed(page, 'timeline', () => around(page, [page.locator('#timeline')], 0))
		await themed(page, 'transport', () => around(page, [page.locator('#transport')], 0))
	})

	test('code-panel', async ({page}) => {
		await ball(page)
		await rest(page)
		await themed(page, 'code-panel', () => around(page, [page.locator('#code-panel')], 0))
	})

	test('code-three', async ({page}) => {
		await choose(page, 'Templates', 'template:Black hole')
		await expect(page.locator('#code-status')).toHaveText('In sync')
		await expect(code(page)).toHaveValue(/^import \* as THREE from 'three'$/m)
		await page.waitForTimeout(500)
		await code(page).evaluate(area => {
			// The first lines: the imports, and where the scene function begins.
			const text = (area as HTMLTextAreaElement).value
			;(area as HTMLTextAreaElement).scrollTop = 0
			void text
		})
		await rest(page)
		await themed(page, 'code-three', () => around(page, [page.locator('#code-panel')], 0))
	})

	test('share-dialog', async ({page}) => {
		await ball(page)
		await choose(page, 'File', 'share')
		await expect(page.locator('#dialog input')).toBeVisible()
		await rest(page)
		await themed(page, 'share-dialog', () => around(page, [page.locator('#dialog')], 28))
	})

	test('open-link-dialog', async ({page}) => {
		await ball(page)
		await choose(page, 'File', 'share')
		const link = await page.locator('#dialog input').inputValue()
		await page.goto(link)
		await expect(page.locator('#shared-code')).toBeVisible()
		await rest(page)
		await themed(page, 'open-link-dialog', () => around(page, [page.locator('#dialog')], 28))
	})

	test('broken-link', async ({page}) => {
		const stray =
			"import {Timeline, Tween} from '@tweenjs/tween.js'\n\nexport const layers = [{name: 'Ball', shape: 'circle'}]\nconst other = {x: 0}\n\nexport const timeline = new Timeline()\n\t.add(new Tween(layers[0]).to({x: 300}, 800), 0)\n\t.add(new Tween(other).to({x: 5}, 400), 1200)\n"
		await page.goto('/#' + Buffer.from(stray, 'utf8').toString('base64url'))
		await page.locator('#dialog button', {hasText: 'Open'}).click()
		await expect(page.locator('#dialog li[data-ok="false"]')).toBeVisible()
		await rest(page)
		await themed(page, 'broken-link', () => around(page, [page.locator('#dialog')], 28))
	})

	test('locked-playing', async ({page}) => {
		await page.locator('.row.layer', {hasText: 'Ball'}).click()
		await page.locator('#play').click()
		const ballLayer = page.locator('.shape-layer[data-layer="1"]')
		const box = (await ballLayer.boundingBox())!
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, {steps: 4})
		await page.mouse.up()
		await expect(page.locator('#toast.show')).toContainText('Pause to edit')
		// Hold a moment in time: the playback goes on, and the picture shows it paused-looking enough.
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30)
		await themed(page, 'locked-playing')
	})

	for (const action of ['import-es6-tween', 'export-es6-tween']) {
		test(action.startsWith('import') ? 'migrate-import' : 'migrate-export', async ({page}) => {
			await ball(page)
			await choose(page, 'Format', action)
			await expect(page.locator('#dialog')).toBeVisible()
			await rest(page)
			await themed(page, action.startsWith('import') ? 'migrate-import' : 'migrate-export', () =>
				around(page, [page.locator('#dialog')], 28),
			)
		})
	}
})

// The stage of each template, at a moment that shows what it is.
const MOMENTS: Array<[string, string, number]> = [
	['template-dot-globe', 'Dot globe', 2000],
	['template-double-helix', 'Double helix', 2000],
	['template-planet-and-moons', 'Planet and moons', 3000],
	['template-card-carousel', 'Card carousel', 2400],
	['template-warp-tunnel', 'Warp tunnel', 2400],
	['template-sign-in-flow', 'Sign-in flow', 5200],
	['template-launch-film', 'Launch film', 7000],
	['template-dashboard', 'Dashboard', 8400],
	['template-black-hole', 'Black hole', 3000],
]

test.describe('pictures of the templates', () => {
	for (const [file, name, time] of MOMENTS) {
		test(file, async ({page}) => {
			await page.goto('/')
			await expect(page.locator('.row.layer')).toHaveCount(3)
			await page.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'})
			await choose(page, 'Templates', 'template:' + name)
			await expect(page.locator('#code-status')).toHaveText('In sync')
			await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
			// Hide the panel of code: it would only slow the stepping down.
			await page.locator('#toggle-code').click()
			await page.keyboard.press('Home')
			for (let at = 0; at < time; at += 100) await page.keyboard.press('Shift+ArrowRight')
			await expect(page.locator('#time')).toHaveText(new RegExp('^' + (time / 1000).toFixed(2)))
			if (name === 'Black hole') {
				await expect(page.locator('canvas.scene3d')).toBeVisible()
				await expect(async () =>
					expect((await page.locator('canvas.scene3d').screenshot()).length).toBeGreaterThan(12_000),
				).toPass({timeout: 60_000})
			}
			await page.waitForTimeout(300)
			// The WebGL picture is noisy: at the page's own size it stays small enough.
			await page
				.locator('#comp')
				.screenshot({path: `${OUT}/${file}.png`, scale: name === 'Black hole' ? 'css' : 'device'})
		})
	}
})
