import {test, expect, type Page} from '@playwright/test'

// Functional checks of the editor (no screenshots): scrubbing, keyframes, the
// curve tool, the timeline <-> code compiler and every menu.

const value = (page: Page, name: string) => page.getByLabel(name, {exact: true})
const code = (page: Page) => page.locator('#code')
const keyframes = (page: Page, layer: number, prop: string) =>
	page.locator(`.row.prop[data-layer="${layer}"][data-prop="${prop}"] .keyframe`)

/** Moves the playhead by clicking the ruler (0.2px per ms at the default zoom). */
async function scrubTo(page: Page, ms: number) {
	await page.locator('#ruler').click({position: {x: ms * 0.2, y: 10}})
}

/** Replaces part of the code the way typing would, then waits for the compile. */
async function editCode(page: Page, from: string, to: string) {
	const source = await code(page).inputValue()
	expect(source).toContain(from)
	await code(page).fill(source.replace(from, to))
}

async function choose(page: Page, title: string, action: string) {
	await page.locator('.menu-title', {hasText: title}).click()
	// Templates are one level down, in the Pre-ready submenu; migrations are two levels down.
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

/** Solid reports mistakes (untracked reads, writes in owned scopes) on the console in dev mode. */
const problems = new WeakMap<Page, string[]>()

test.describe('timeline editor', () => {
	test.beforeEach(async ({page}) => {
		const found: string[] = []
		problems.set(page, found)
		page.on('console', message => {
			// Reading a WebGL canvas back for a screenshot stalls a software renderer: not a mistake.
			if (message.text().includes('GPU stall due to ReadPixels')) return
			if (message.type() === 'error' || message.type() === 'warning') found.push(message.text())
		})
		page.on('pageerror', error => found.push(String(error)))
		await page.goto('/')
		await expect(page.locator('.row.layer')).toHaveCount(3)
	})

	test.afterEach(async ({page}) => {
		expect(problems.get(page)).toEqual([])
	})

	test('scrubs the timeline forwards and backwards', async ({page}) => {
		// Ball x is a linear 90 -> 550 over 0..2400ms.
		await scrubTo(page, 1200)
		await expect(page.locator('#time')).toHaveText('1.20s / 4.00s')
		await expect(value(page, 'Ball x')).toHaveValue('320')

		await scrubTo(page, 3000)
		await expect(value(page, 'Ball x')).toHaveValue('550')

		// Back again: the same time gives the same value.
		await scrubTo(page, 1200)
		await expect(value(page, 'Ball x')).toHaveValue('320')
		await scrubTo(page, 0)
		await expect(value(page, 'Ball x')).toHaveValue('90')
	})

	test('adds a keyframe by editing a value, and undoes it', async ({page}) => {
		await expect(keyframes(page, 1, 'x')).toHaveCount(2)

		await scrubTo(page, 1200)
		await value(page, 'Ball x').fill('100')
		await value(page, 'Ball x').press('Enter')

		await expect(keyframes(page, 1, 'x')).toHaveCount(3)
		await expect(code(page)).toHaveValue(/new Tween\(ball\)\.to\(\{x: 100\}, 1200\), 0\)/)
		await expect(code(page)).toHaveValue(/new Tween\(ball\)\.to\(\{x: 550\}, 1200\), 1200\)/)

		await page.locator('#undo').click()
		await expect(keyframes(page, 1, 'x')).toHaveCount(2)
		await expect(code(page)).toHaveValue(/new Tween\(ball\)\.to\(\{x: 550\}, 2400\), 0\)/)
	})

	test('compiles the timeline to code and back without loss', async ({page}) => {
		const source = await code(page).inputValue()
		expect(source).toContain("import {Easing, cubicBezier, curveEasing, Timeline, Tween} from '@tweenjs/tween.js'")
		expect(source).toContain('.add(new Tween(card).to({rotation: 180}, 1600).easing(Easing.Cubic.InOut), 1800)')

		// Typing the same code back in changes nothing: nothing to undo.
		await code(page).fill(source + '\n')
		await expect(page.locator('#code-status')).toHaveText('In sync')
		await expect(page.locator('#undo')).toBeDisabled()
	})

	test('edits made in code show up in the timeline', async ({page}) => {
		await editCode(page, '.to({x: 550}, 2400), 0)', '.to({x: 250}, 1000).easing(Easing.Quadratic.In), 500)')
		await expect(page.locator('#code-status')).toHaveText('In sync')

		// Quadratic.In from 90 to 250 over 500..1500ms.
		await scrubTo(page, 1000)
		await expect(value(page, 'Ball x')).toHaveValue('130')
		await scrubTo(page, 2000)
		await expect(value(page, 'Ball x')).toHaveValue('250')

		// Freely written code compiles too: a loop appending tweens.
		await code(page).fill(`
			const dot = {name: 'Dot', shape: 'circle', x: 0, y: 100}
			export const layers = [dot]
			export const timeline = new Timeline()
			for (let i = 1; i <= 3; i++) timeline.add(new Tween(dot).to({x: i * 100}, 500))
		`)
		await expect(page.locator('.row.layer')).toHaveCount(1)
		await expect(keyframes(page, 0, 'x')).toHaveCount(4)
		await scrubTo(page, 750)
		await expect(value(page, 'Dot x')).toHaveValue('150')
	})

	test('keeps the timeline when the code is broken', async ({page}) => {
		const source = await code(page).inputValue()

		await code(page).fill(source.replace('new Timeline()', 'new Timeline('))
		await expect(page.locator('#code-status')).toHaveClass('error')
		await expect(page.locator('.row.layer')).toHaveCount(3)

		// Valid tween.js that the editor cannot show is refused as well.
		await code(page).fill(source.replace('.to({x: 550}, 2400), 0)', '.to({x: 550}, 2400), {repeat: 2})'))
		await expect(page.locator('#code-status')).toContainText('not supported')
		await expect(keyframes(page, 1, 'x')).toHaveCount(2)

		await code(page).fill(source)
		await expect(page.locator('#code-status')).toHaveText('In sync')
	})

	test('draws a custom easing with the curve tool', async ({page}) => {
		// Select the first Ball x keyframe: its segment is linear.
		await keyframes(page, 1, 'x').first().click()
		await expect(page.locator('#easing')).toHaveValue('Linear.None')

		await page.locator('#easing').selectOption('curve')
		await expect(page.locator('#curve .node')).toHaveCount(2)
		await expect(code(page)).toHaveValue(/\.to\(\{x: 550\}, 2400\)\.easing\(cubicBezier\(/)

		// Drag the first handle to the bottom right: a slow start.
		const handle = page.locator('#curve .handle').first()
		const box = (await page.locator('#curve .unit').boundingBox())!
		await handle.hover()
		await page.mouse.down()
		await page.mouse.move(box.x + box.width * 0.9, box.y + box.height, {steps: 4})
		await page.mouse.up()

		await scrubTo(page, 1200)
		const eased = +(await value(page, 'Ball x').inputValue())
		expect(eased).toBeGreaterThan(90)
		expect(eased).toBeLessThan(250)

		// A double click on the graph adds a point.
		const graph = (await page.locator('#curve').boundingBox())!
		await page.mouse.dblclick(graph.x + graph.width * 0.5, graph.y + graph.height * 0.12)
		await expect(page.locator('#curve .node')).toHaveCount(3)
		await expect(code(page)).toHaveValue(/\.easing\(curveEasing\(\[\[/)

		// The drag and the new point are one undo step each.
		await page.locator('#undo').click()
		await expect(page.locator('#curve .node')).toHaveCount(2)
		await page.locator('#undo').click()
		await page.locator('#undo').click()
		await expect(page.locator('#easing')).toHaveValue('Linear.None')
	})

	test('File menu: create, save, open', async ({page}) => {
		const menu = (title: string, item: string) => async () => {
			await page.locator('.menu-title', {hasText: title}).click()
			await page.locator('.menu-items:popover-open [role="menuitem"]', {hasText: item}).click()
		}

		const downloading = page.waitForEvent('download')
		await menu('File', 'Save')()
		const download = await downloading
		expect(download.suggestedFilename()).toBe('timeline.js')
		const saved = await download.path()

		await menu('File', 'Create')()
		await expect(page.locator('.row.layer')).toHaveCount(0)
		await expect(code(page)).toHaveValue(/export const layers = \[\]/)

		const choosing = page.waitForEvent('filechooser')
		await menu('File', 'Open')()
		await (await choosing).setFiles(saved)
		await expect(page.locator('.row.layer')).toHaveCount(3)
		await expect(keyframes(page, 1, 'x')).toHaveCount(2)

		// Creating and opening are undo steps.
		await page.locator('#undo').click()
		await expect(page.locator('.row.layer')).toHaveCount(0)
	})

	test('File menu: share makes a link of the code in base64, that reopens the timeline', async ({page, context}) => {
		// Edit something first, so the link is not just the demo. The comment is not ASCII, and stays.
		await editCode(page, '.to({x: 550}, 2400), 0)', '.to({x: 333}, 1000), 0) // détour ✓')
		await expect(page.locator('#code-status')).toHaveText('In sync')
		const code = await page.locator('#code').inputValue()

		// There is no share sheet or clipboard here: the link is shown instead.
		await page.locator('.menu-title', {hasText: 'File'}).click()
		await page.locator('[data-action="share"]').click()
		const link = await page.locator('#dialog input').inputValue()

		// The link is the page's address and the code in base64, which anything can decode.
		const [address, fragment] = link.split('#')
		expect(address).toBe(new URL('/', page.url()).href)
		expect(fragment).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(Buffer.from(fragment, 'base64url').toString('utf8')).toBe(code)

		// Opening it shows the code and asks, since code is run: nothing changes before that.
		await page.evaluate(() => localStorage.clear())
		const other = await context.newPage()
		await other.goto(link)
		await expect(other.locator('#dialog')).toContainText('runs it in this page')
		await expect(other.locator('#shared-code')).toHaveText(code)
		expect(other.url()).not.toContain('#')
		await expect(other.locator('#code')).not.toHaveValue(/333/)

		// Cancelled: the timeline is as it was.
		await other.locator('#dialog button', {hasText: 'Cancel'}).click()
		await expect(other.locator('#code')).not.toHaveValue(/333/)

		// Accepted: the code is in the editor as it was written, and it is the timeline.
		await other.goto(address)
		await other.goto(link)
		await other.locator('#dialog button', {hasText: 'Open'}).click()
		await expect(other.locator('#code')).toHaveValue(code)
		await expect(other.locator('#code-status')).toHaveText('In sync')
		await expect(other.locator('.row.layer')).toHaveCount(3)
		await other.locator('#undo').click()
		await expect(other.locator('#code')).not.toHaveValue(/333/)

		// Standard base64, with padding, opens as well.
		await other.goto(address)
		await other.goto(address + '#' + Buffer.from(code, 'utf8').toString('base64'))
		await expect(other.locator('#shared-code')).toHaveText(code)
		await other.locator('#dialog button', {hasText: 'Cancel'}).click()

		// A link that is not base64 of text says that its link is what is broken, and the timeline stays.
		for (const broken of ['not*base64', Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')]) {
			await other.goto(address)
			await other.goto(address + '#' + broken)
			await expect(other.locator('#dialog')).toContainText('This link is broken')
			await expect(other.locator('#dialog li[data-ok="false"]')).toContainText('Link')
			await other.locator('#dialog button').click()
			await expect(other.locator('.row.layer')).toHaveCount(3)
		}

		// Code that cannot be read is refused before anyone is asked to run it: the code is what is broken.
		await other.goto(address)
		await other.goto(address + '#' + Buffer.from('export const a = (', 'utf8').toString('base64url'))
		await expect(other.locator('#dialog')).toContainText('This link is broken')
		await expect(other.locator('#dialog li[data-ok="false"]')).toContainText('Code')
		await other.locator('#dialog button').click()

		// Code that runs but is not a timeline: the timeline is what is broken, and it is said what is missing.
		await other.goto(address)
		await other.goto(address + '#' + Buffer.from('export const nothing = 1', 'utf8').toString('base64url'))
		await other.locator('#dialog button', {hasText: 'Open'}).click()
		await expect(other.locator('#dialog li[data-ok="false"]')).toContainText('Timeline')
		await expect(other.locator('#dialog li[data-ok="false"]')).toContainText('must define `layers`')
		await other.locator('#dialog button').click()

		// A tween that animates something that is not a layer names that tween.
		await other.goto(address)
		const stray =
			"import {Timeline, Tween} from '@tweenjs/tween.js'\nexport const layers = [{name: 'A'}]\nexport const timeline = new Timeline().add(new Tween({x: 0}).to({x: 5}, 400), 1200)"
		await other.goto(address + '#' + Buffer.from(stray, 'utf8').toString('base64url'))
		await other.locator('#dialog button', {hasText: 'Open'}).click()
		await expect(other.locator('#dialog li[data-ok="false"]')).toContainText('tween of x at 1200ms')
		await other.locator('#dialog button').click()
		await expect(other.locator('.row.layer')).toHaveCount(3)
	})

	test('a link made before links held code still opens', async ({page}) => {
		// The demo with one layer, as deflated JSON: what File > Share made before.
		const old = await page.evaluate(async () => {
			const json = JSON.stringify({duration: 1234, layers: [{name: 'Old', shape: 'circle', values: {x: 10}}]})
			const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))
			const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
			return (
				'z' +
				btoa(String.fromCharCode(...bytes))
					.replace(/\+/g, '-')
					.replace(/\//g, '_')
					.replace(/=+$/, '')
			)
		})
		await page.goto('/#t=' + old)
		await expect(page.locator('.row.layer')).toHaveCount(1)
		await expect(page.locator('#code')).toHaveValue(/name: 'Old'/)
		await expect(page.locator('#code')).toHaveValue(/duration = 1234/)
	})

	test('Edit, Media and Format menus', async ({page}) => {
		const choose = async (title: string, action: string) => {
			await page.locator('.menu-title', {hasText: title}).click()
			await page.locator(`[data-action="${action}"]`).click()
		}

		// Scale to 50%: 4s becomes 2s, and the Ball x keyframe at 2400ms moves to 1200ms.
		await choose('Edit', 'scale')
		await page.locator('#dialog input').fill('50')
		await page.locator('#dialog button', {hasText: 'Scale'}).click()
		await expect(page.locator('#time')).toHaveText('0.00s / 2.00s')
		await expect(code(page)).toHaveValue(/new Tween\(ball\)\.to\(\{x: 550\}, 1200\), 0\)/)

		// Media: play moves the playhead, stop returns it to the start.
		await choose('Media', 'play')
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true')
		await expect(page.locator('#time')).not.toHaveText('0.00s / 2.00s')
		await choose('Media', 'stop')
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
		await expect(page.locator('#time')).toHaveText('0.00s / 2.00s')

		// Format: free-form code is rewritten in the editor's layout.
		await code(page).fill(`const a = {name: 'A', x: 1}; const layers = [a]
			const timeline = new Timeline(); timeline.add(new Tween(a).to({x: 9}, 500))`)
		await choose('Format', 'format')
		await expect(code(page)).toHaveValue(/^import \{Easing, Timeline, Tween\}/)
		await expect(code(page)).toHaveValue(/\t\.add\(new Tween\(a\)\.to\(\{x: 9\}, 500\), 0\)/)

		// Check: reports problems without touching the timeline.
		await choose('Format', 'check')
		await expect(page.locator('#dialog')).toContainText('No problems found. 1 layers, 2 keyframes')
		await page.locator('#dialog button').click()

		await code(page).fill('const layers = [')
		await choose('Format', 'check')
		await expect(page.locator('#dialog')).toContainText('does not compile')
		await page.locator('#dialog button').click()
		await expect(page.locator('.row.layer')).toHaveCount(1)
	})

	test('Help menu links to the docs page', async ({page}) => {
		await page.locator('.menu-title', {hasText: 'Help'}).click()
		await page.locator('[data-action="about"]').click()
		await expect(page.locator('#dialog')).toContainText('keyframe editor built on tween.js')
		await page.locator('#dialog button').click()

		const opening = page.waitForEvent('popup')
		await page.locator('.menu-title', {hasText: 'Help'}).click()
		await page.locator('.menu-items:popover-open a', {hasText: 'Docs'}).click()
		const docs = await opening
		// Docsify: the pages are in the sidebar, and the homepage is rendered from markdown.
		await expect(docs.locator('.markdown-section h1').first()).toContainText('Timeline editor')
		await expect(docs.locator('.sidebar-nav')).toContainText('Menus and actions')
		await docs.locator('.sidebar-nav a', {hasText: 'Menus and actions'}).click()
		await expect(docs.locator('.markdown-section h1').first()).toContainText('Menus')
	})

	test('menus: a click opens one, the pointer moves between them, and leaving closes them', async ({page}) => {
		const open = page.locator('.menu-items:popover-open')
		const title = (name: string) => page.locator('.menu-title', {hasText: name})

		// The pointer alone opens nothing.
		await title('File').hover()
		await expect(open).toHaveCount(0)

		// After a click, the pointer over another title opens that one instead.
		await title('File').click()
		await expect(open).toHaveCount(1)
		await expect(open.locator('[data-action="share"]')).toBeVisible()
		await title('Media').hover()
		await expect(open.locator('[data-action="restart"]')).toBeVisible()
		await expect(open).toHaveCount(1)

		// Down to the menu and back the title is still open; away from the bar and the menus, it closes.
		await open.locator('[data-action="stop"]').hover()
		await expect(open).toHaveCount(1)
		await page.mouse.move(600, 500)
		await expect(open).toHaveCount(0)
	})

	test('playing: nothing can be moved or changed, and the cursor says so; paused, it works', async ({page}) => {
		const ball = page.locator('.shape-layer[data-layer="1"]')
		const position = async () => (await ball.boundingBox())!.x
		const cursor = (selector: string) =>
			page
				.locator(selector)
				.first()
				.evaluate(element => getComputedStyle(element).cursor)
		await page.locator('.row.layer', {hasText: 'Ball'}).click()

		await page.locator('#play').click()
		await expect(page.locator('#app')).toHaveAttribute('data-playing', '')
		// The fields are off, the layers and keyframes show a forbidden cursor, and the code can still be read.
		await expect(page.locator('[data-layer-field="name"]')).toBeDisabled()
		await expect(page.locator('.row.prop input').first()).toBeDisabled()
		await expect(page.locator('.key-toggle').first()).toBeDisabled()
		await expect(page.locator('#duration')).toBeDisabled()
		expect(await cursor('.shape-layer')).toBe('not-allowed')
		expect(await cursor('.keyframe')).toBe('not-allowed')
		expect(await cursor('[data-layer-field="name"]')).toBe('not-allowed')

		// Dragging a layer while it plays moves nothing in the document.
		const before = await page.locator('#code').inputValue()
		const box = (await ball.boundingBox())!
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, {steps: 5})
		await page.mouse.up()
		await expect(page.locator('#toast.show')).toContainText('Pause to edit')
		await page.locator('#pause').click()
		expect(await page.locator('#code').inputValue()).toBe(before)
		await expect(page.locator('#undo')).toBeDisabled()

		// Paused, the same drag moves it and the same fields work.
		await expect(page.locator('[data-layer-field="name"]')).toBeEnabled()
		expect(await cursor('.shape-layer')).toBe('move')
		const start = await position()
		const now = (await ball.boundingBox())!
		await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2)
		await page.mouse.down()
		await page.mouse.move(now.x + now.width / 2 + 80, now.y + now.height / 2 + 40, {steps: 5})
		await page.mouse.up()
		expect(await position()).toBeGreaterThan(start + 40)
		await expect(page.locator('#undo')).toBeEnabled()
	})

	test('Create and Open stop the playback and wait at 0s', async ({page}) => {
		await page.locator('#play').click()
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true')
		await choose(page, 'File', 'create')
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
		await expect(page.locator('#time')).toHaveText(/^0\.00s/)
		await expect(page.locator('.row.layer')).toHaveCount(0)

		// A file, opened while playing, is at 0s and paused too; and what comes next waits for Play.
		await page.locator('#play').click()
		const chooser = page.waitForEvent('filechooser')
		await choose(page, 'File', 'open')
		await (
			await chooser
		).setFiles({
			name: 'timeline.js',
			mimeType: 'text/javascript',
			buffer: Buffer.from(
				"import {Timeline, Tween} from '@tweenjs/tween.js'\nexport const layers = [{name: 'Dot', shape: 'circle'}]\nexport const timeline = new Timeline().add(new Tween(layers[0]).to({x: 200}, 1000), 0)",
			),
		})
		await expect(page.locator('.row.layer')).toHaveCount(1)
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
		await expect(page.locator('#time')).toHaveText(/^0\.00s/)
		await choose(page, 'Templates', 'template:Dot globe')
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
	})

	test('Edit menu: layers are added and restacked', async ({page}) => {
		const names = page.locator('.row.layer .name')
		await expect(names).toHaveText(['Title', 'Ball', 'Card'])

		await choose(page, 'Edit', 'layer-new')
		await expect(names).toHaveText(['Rect 2', 'Title', 'Ball', 'Card'])

		// Select Card (the bottom layer) and walk it up and down the stack.
		await names.nth(3).click()
		await choose(page, 'Edit', 'layer-forward')
		await expect(names).toHaveText(['Rect 2', 'Title', 'Card', 'Ball'])
		await choose(page, 'Edit', 'layer-top')
		await expect(names).toHaveText(['Card', 'Rect 2', 'Title', 'Ball'])
		await expect(page.locator('.row.layer.selected .name')).toHaveText('Card')
		await expect(code(page)).toHaveValue(/export const layers = \[card, rect2, title, ball\]/)

		// The first layer is drawn on top.
		const order = () =>
			page.locator('.shape-layer').evaluateAll(all => all.map(element => +getComputedStyle(element).zIndex))
		expect(await order()).toEqual([4, 3, 2, 1])

		// Already at the top: nothing to undo.
		await choose(page, 'Edit', 'layer-top')
		await expect(page.locator('#toast')).toContainText('already at the top')

		await choose(page, 'Edit', 'layer-backward')
		await expect(names).toHaveText(['Rect 2', 'Card', 'Title', 'Ball'])
		await choose(page, 'Edit', 'layer-bottom')
		await expect(names).toHaveText(['Rect 2', 'Title', 'Ball', 'Card'])

		await page.locator('#undo').click()
		await expect(names).toHaveText(['Rect 2', 'Card', 'Title', 'Ball'])
	})

	test('transport: the playback buttons sit centred above the timeline', async ({page}) => {
		const buttons = page.locator('#transport .buttons button')
		await expect(buttons).toHaveText([/Prev/, /Play/, /Pause/, /Stop/, /Forward/, /Restart/])

		// Centred in the window, between the stage and the timeline.
		const box = (await page.locator('#transport .buttons').boundingBox())!
		const width = page.viewportSize()!.width
		expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2)
		const timeline = (await page.locator('#timeline').boundingBox())!
		expect(box.y + box.height).toBeLessThanOrEqual(timeline.y)
		expect(box.y).toBeGreaterThan((await page.locator('#stage').boundingBox())!.y)

		// Undo, Redo and Reset demo are centred in the bar at the top.
		const top = (await page.locator('#bar .buttons').boundingBox())!
		await expect(page.locator('#bar .buttons button')).toHaveText(['Undo', 'Redo', 'Reset demo'])
		expect(Math.abs(top.x + top.width / 2 - width / 2)).toBeLessThan(2)

		// Duration starts the bar, and zoom ends it.
		const left = (await page.locator('#transport #duration').boundingBox())!
		const right = (await page.locator('#transport #zoom').boundingBox())!
		expect(left.x).toBeLessThan(220)
		expect(right.x + right.width).toBeGreaterThan(width - 30)

		// Forward and Prev step between the keyframes of the selected layer, then to the ends.
		const time = page.locator('#time')
		await expect(time).toHaveText('0.00s / 4.00s')
		await page.locator('#next').click()
		const first = await time.textContent()
		expect(first).not.toBe('0.00s / 4.00s')
		await page.locator('#next').click()
		await expect(time).not.toHaveText(first!)
		await page.locator('#prev').click()
		await expect(time).toHaveText(first!)
		await page.locator('#prev').click()
		await expect(time).toHaveText('0.00s / 4.00s')
		for (let i = 0; i < 12; i++) await page.locator('#next').click()
		await expect(time).toHaveText('4.00s / 4.00s')

		// Play, Pause, Stop and Restart.
		await expect(page.locator('#pause')).toBeDisabled()
		await page.locator('#restart').click()
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true')
		await expect(time).not.toHaveText('4.00s / 4.00s')
		await page.locator('#pause').click()
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
		await expect(time).not.toHaveText('0.00s / 4.00s')
		await page.locator('#play').click()
		await expect(page.locator('#pause')).toBeEnabled()
		await page.locator('#stop').click()
		await expect(page.locator('#pause')).toBeDisabled()
		await expect(time).toHaveText('0.00s / 4.00s')
	})

	test('stage: a click outside every layer selects nothing', async ({page}) => {
		// Nothing is selected to begin with, so no path is drawn over the animation.
		await expect(page.locator('.shape-layer.selected')).toHaveCount(0)
		await expect(page.locator('#path')).toHaveCount(0)
		await expect(page.locator('#inspector')).toContainText('Nothing is selected')

		await page.locator('.row.layer', {hasText: 'Ball'}).click()
		await expect(page.locator('.shape-layer.selected')).toHaveCount(1)
		await expect(page.locator('#path')).toBeVisible()

		// The corner of the stage panel is outside the composition.
		await page.locator('#stage').click({position: {x: 4, y: 4}})
		await expect(page.locator('.shape-layer.selected')).toHaveCount(0)
		await expect(page.locator('.row.layer.selected')).toHaveCount(0)
		await expect(page.locator('#path')).toHaveCount(0)
		await expect(page.locator('#inspector')).toContainText('Nothing is selected')

		// An edit elsewhere does not select a layer again; a click on one does.
		await page.locator('#duration').fill('5000')
		await page.locator('#duration').press('Enter')
		await expect(page.locator('.row.layer.selected')).toHaveCount(0)
		await page.locator('.shape-layer').first().click()
		await expect(page.locator('.shape-layer.selected')).toHaveCount(1)

		// The path can also be hidden while a layer is selected.
		await page.locator('.row.layer', {hasText: 'Ball'}).click()
		await expect(page.locator('#path')).toBeVisible()
		await page.locator('#toggle-path').click()
		await expect(page.locator('#path')).toHaveCount(0)
	})

	test('themes: the system theme by default, and a switcher that is remembered', async ({page}) => {
		const theme = () => page.locator('html').getAttribute('data-theme')
		const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

		// Nothing chosen: the page follows the system, in CSS alone. Radix slate step 1.
		await expect(page.locator('#theme')).toHaveValue('system')
		expect(await theme()).toBeNull()
		await page.emulateMedia({colorScheme: 'dark'})
		await expect.poll(background).toBe('rgb(17, 17, 19)')
		await page.emulateMedia({colorScheme: 'light'})
		await expect.poll(background).toBe('rgb(252, 252, 253)')

		// A choice wins over the system, and is still there after a reload.
		await page.selectOption('#theme', 'dark')
		await expect.poll(theme).toBe('dark')
		expect(await background()).toBe('rgb(17, 17, 19)')
		await page.reload()
		await expect(page.locator('#theme')).toHaveValue('dark')
		expect(await theme()).toBe('dark')
		expect(await background()).toBe('rgb(17, 17, 19)')

		// The docs page uses the same choice.
		const docs = await page.context().newPage()
		await docs.goto('docs/index.html')
		await expect(docs.locator('html')).toHaveAttribute('data-theme', 'dark')
		await docs.close()

		// Back to the system.
		await page.selectOption('#theme', 'system')
		await expect.poll(theme).toBeNull()
		expect(await background()).toBe('rgb(252, 252, 253)')
		await page.reload()
		await expect(page.locator('#theme')).toHaveValue('system')
	})

	test('panels: left, right and bottom are resized by their dividers, and remembered', async ({page}) => {
		const width = async (selector: string) => Math.round((await page.locator(selector).boundingBox())!.width)
		const height = async (selector: string) => Math.round((await page.locator(selector).boundingBox())!.height)
		const pull = async (side: string, x: number, y: number) => {
			const box = (await page.locator('.divider-' + side).boundingBox())!
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
			await page.mouse.down()
			await page.mouse.move(box.x + box.width / 2 + x, box.y + box.height / 2 + y, {steps: 5})
			await page.mouse.up()
		}
		expect([await width('#inspector'), await width('#code-panel'), await height('#timeline')]).toEqual([290, 430, 300])
		const stage = await width('#stage')

		await pull('left', 60, 0)
		await pull('right', -50, 0)
		await pull('bottom', 0, -80)
		await expect.poll(() => width('#inspector')).toBe(350)
		expect([await width('#code-panel'), await height('#timeline')]).toEqual([480, 380])
		// The stage gives up the room, and the composition is fitted to what is left.
		expect(await width('#stage')).toBe(stage - 110)

		// Remembered.
		await page.reload()
		expect([await width('#inspector'), await width('#code-panel'), await height('#timeline')]).toEqual([350, 480, 380])

		// A panel has a smallest size, and the stage is never squeezed out.
		await pull('left', -600, 0)
		expect(await width('#inspector')).toBe(200)
		await pull('right', -3000, 0)
		expect(await width('#stage')).toBeGreaterThanOrEqual(250)

		// The arrow keys move a divider too, and a double click brings back the usual size.
		await page.locator('.divider-bottom').focus()
		await page.keyboard.press('ArrowUp')
		expect(await height('#timeline')).toBe(396)
		// The right one first: while it is this wide, it leaves no room for the left one to grow.
		for (const side of ['right', 'left', 'bottom']) await page.locator('.divider-' + side).dblclick()
		expect([await width('#inspector'), await width('#code-panel'), await height('#timeline')]).toEqual([290, 430, 300])
	})

	test('Templates menu: every template opens, plays and compiles', async ({page}) => {
		// Nine templates, each opened, played and checked.
		test.setTimeout(120_000)
		const items = page.locator('[data-action^="template:"]')
		await page.locator('.menu-title', {hasText: 'Templates'}).click()

		// The menu has three entries: the ready-made templates, packs of them, and the demo.
		await expect(page.locator('.menu-items:popover-open > *')).toHaveText([
			/Pre-ready/,
			/Import templates pack/,
			/Demo/,
		])
		await expect(items.first()).toBeHidden()
		await page.locator('[data-submenu="Pre-ready"]').click()
		await expect(items).toHaveText([
			/Dot globe/,
			/Double helix/,
			/Planet and moons/,
			/Card carousel/,
			/Warp tunnel/,
			/Sign-in flow/,
			/Launch film/,
			/Dashboard/,
			/Black hole/,
		])
		// Each one says what it is.
		await expect(items.first()).toContainText('A sphere of dots on a tilted axis')

		// Importing a pack of templates is not available yet.
		await expect(page.locator('[data-action="import-pack"]')).toBeDisabled()
		await expect(page.locator('[data-action="import-pack"]')).toContainText('Import templates pack')
		const actions = await items.evaluateAll(all => all.map(element => (element as HTMLElement).dataset.action!))
		await page.keyboard.press('Escape')

		for (const action of actions) {
			await choose(page, 'Templates', action)
			// Nothing was played yet: a template is at 0s and paused.
			await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
			await expect(page.locator('#time')).toHaveText(/^0\.00s/)
			await expect(page.locator('#code-status')).toHaveText('In sync')
			// The flat scenes are made of dozens of layers; the three.js one is a single layer and two captions.
			expect(await page.locator('.row.layer').count()).toBeGreaterThan(action.endsWith('Black hole') ? 2 : 10)

			// What the template generates reads back as the same timeline.
			await choose(page, 'Format', 'check')
			await expect(page.locator('#dialog')).toContainText('No problems found.')
			await page.locator('#dialog button').click()
		}

		// After the user plays, the next template plays by itself, from the start. Pausing ends that.
		await page.locator('#play').click()
		await choose(page, 'Templates', 'template:Dot globe')
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true')
		await page.locator('#pause').click()
		await choose(page, 'Templates', 'template:Warp tunnel')
		await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
		await expect(page.locator('#time')).toHaveText(/^0\.00s/)

		// The product scenes are over a hundred layers, with round corners and texts that start at a point.
		await choose(page, 'Templates', 'template:Sign-in flow')
		expect(await page.locator('.row.layer').count()).toBeGreaterThan(120)
		await page.locator('.row.layer', {hasText: 'Button shadow'}).first().click()
		await expect(page.locator('[data-layer-field="shape"]')).toHaveValue('rect')
		await expect(page.locator('[data-layer-field="radius"]')).toHaveValue('29')
		await expect(page.locator('.shape-layer.selected')).toHaveCSS('border-radius', '29px')
		await page.locator('.row.layer', {hasText: 'Email label'}).first().click()
		await expect(page.locator('[data-layer-field="align"]')).toHaveValue('left')
		await expect(page.locator('[data-layer-field="shape"]')).toHaveValue('text')
		await expect(page.locator('.shape-layer.selected')).toHaveCSS('transform', /^matrix/)
		await page.locator('#undo').click()

		// The last one is a three.js scene: its canvas has a picture on it, not a blank.
		await choose(page, 'Templates', 'template:Black hole')
		await choose(page, 'Media', 'pause')
		const scene = page.locator('canvas.scene3d')
		await expect(scene).toBeVisible()
		await expect(async () => expect((await scene.screenshot()).length).toBeGreaterThan(12_000)).toPass()
		await page.locator('.row.layer', {hasText: 'Black hole'}).first().click()
		await expect(page.locator('#inspector')).toContainText('drawn with three.js')

		// The scene is in the code panel, as the three.js code that draws it. Editing it there redraws it.
		const box = page.locator('#code')
		await expect(box).toHaveValue(/^import \* as THREE from 'three'$/m)
		await expect(box).toHaveValue(/^function blackHoleScene\(canvas\) \{$/m)
		await expect(box).toHaveValue(/new THREE\.Mesh\(/)
		await expect(box).toHaveValue(/^\tscene: blackHoleScene,$/m)
		await editCode(page, 'const starCount = 7000', 'const starCount = 500')
		await expect(page.locator('#code-status')).toHaveText('In sync')
		await expect(scene).toBeVisible()
		await expect(page.locator('.shape-layer[data-error]')).toHaveCount(0)
		await expect(async () => expect((await scene.screenshot()).length).toBeGreaterThan(12_000)).toPass()
		await page.locator('#undo').click()

		// Any layer can be a three.js scene: it starts as a cube, with its code beside it.
		await choose(page, 'Templates', 'demo')
		await choose(page, 'Media', 'pause')
		await page.locator('.row.layer', {hasText: 'Card'}).click()
		await page.locator('[data-layer-field="shape"]').selectOption('three')
		await expect(box).toHaveValue(/^function cubeScene\(canvas\) \{$/m)
		await expect(box).toHaveValue(/^\tscene: cubeScene,$/m)
		await expect(page.locator('#code-status')).toHaveText('In sync')
		await expect(page.locator('canvas.scene3d')).toBeVisible()
		await expect(page.locator('.shape-layer[data-error]')).toHaveCount(0)
		await page.locator('#undo').click()
		await page.locator('#undo').click()

		// A template is one undo step away from the timeline it replaced.
		await choose(page, 'Media', 'stop')
		// Undo walks back through every template to the timeline that was there at the start.
		while (await page.locator('#undo').isEnabled()) await page.locator('#undo').click()
		await expect(page.locator('.row.layer .name')).toHaveText(['Title', 'Ball', 'Card'])
	})

	test('Format menu: migrates to es6-tween and back', async ({page}) => {
		// Migrations is a submenu, with Import and Export inside it.
		await page.locator('.menu-title', {hasText: 'Format'}).click()
		await expect(page.locator('.menu-items:popover-open > :not(hr)')).toHaveText([
			/Format code/,
			/Check code/,
			/Migrations/,
		])
		await page.locator('[data-submenu="Migrations"]').hover()
		await expect(page.locator('[data-submenu="Migrations"] + .menu-items > *')).toHaveText([/Import/, /Export/])
		await expect(page.locator('[data-action="import-kute"]')).toBeHidden()
		await page.locator('[data-submenu="Import"]').hover()
		await expect(page.locator('[data-submenu="Import"] + .menu-items > *')).toHaveText([
			'Import from es6-tween…',
			'Import from Kute.js…',
		])
		await page.locator('[data-submenu="Export"]').hover()
		await expect(page.locator('[data-action="import-kute"]')).toBeHidden()
		await expect(page.locator('[data-submenu="Export"] + .menu-items > *')).toHaveText([
			'Export to es6-tween…',
			'Export to Kute.js…',
		])
		await page.keyboard.press('Escape')

		const original = await code(page).inputValue()

		await choose(page, 'Format', 'export-es6-tween')
		const exported = await page.locator('#migrated').inputValue()
		expect(exported).toContain("from 'es6-tween'")
		expect(exported).toContain("import OwnEasing from 'owneasing'")
		// The Bounce curve of Ball y, as an owneasing path.
		expect(exported).toMatch(/\.add\(\{from: ball, to: \{y: 230\}, duration: 1600, easing: OwnEasing\('M0,100 C/)

		const downloading = page.waitForEvent('download')
		await page.locator('#dialog [data-download]').click()
		expect((await downloading).suggestedFilename()).toBe('timeline.es6-tween.js')
		await page.locator('#dialog button', {hasText: 'Close'}).click()

		await choose(page, 'File', 'create')
		await expect(page.locator('.row.layer')).toHaveCount(0)

		// Broken code is reported in the dialog, which stays open.
		await choose(page, 'Format', 'import-es6-tween')
		await page.locator('#import-code').fill('new Tween(')
		await page.locator('#dialog [data-import]').click()
		await expect(page.locator('#dialog pre.error')).toBeVisible()

		await page.locator('#import-code').fill(exported)
		await page.locator('#dialog [data-import]').click()
		await expect(page.locator('#dialog')).toBeHidden()
		await expect(page.locator('.row.layer .name')).toHaveText(['Title', 'Ball', 'Card'])
		await expect(code(page)).toHaveValue(original)
	})

	test('Format menu: migrates to Kute.js and back', async ({page}) => {
		await choose(page, 'Format', 'export-kute')
		const exported = await page.locator('#migrated').inputValue()
		expect(exported).toContain("import KUTE from 'kute.js'")
		expect(exported).toContain('<div id="ball"')
		expect(exported).toContain("easing: 'easingCubicInOut'")
		await page.locator('#dialog button', {hasText: 'Close'}).click()

		await choose(page, 'Format', 'import-kute')
		await page.locator('#import-code').fill(`
			KUTE.fromTo('#box', {translateX: 0}, {translateX: 200}, {duration: 1000, easing: 'easingQuadraticOut'}).start()
			KUTE.to('#box', {rotate: 90}, {duration: 500, delay: 1000}).start()
		`)
		await page.locator('#dialog [data-import]').click()
		await expect(page.locator('.row.layer .name')).toHaveText(['box'])
		await expect(keyframes(page, 0, 'x')).toHaveCount(2)
		await expect(code(page)).toHaveValue(
			/new Tween\(box\)\.to\(\{x: 200\}, 1000\)\.easing\(Easing\.Quadratic\.Out\), 0\)/,
		)
		await expect(code(page)).toHaveValue(/new Tween\(box\)\.to\(\{rotation: 90\}, 500\), 1000\)/)

		// The whole demo survives the trip (positions are whole numbers already).
		await page.locator('#undo').click()
		const original = await code(page).inputValue()
		await choose(page, 'Format', 'import-kute')
		await page.locator('#import-code').fill(exported)
		await page.locator('#dialog [data-import]').click()
		await expect(page.locator('.row.layer .name')).toHaveText(['title', 'ball', 'card'])
		const lines = (text: string) => text.split('\n').filter(line => line.includes('.add('))
		expect(lines(await code(page).inputValue())).toEqual(lines(original))
	})

	test('playback draws a new frame on every display frame', async ({page}) => {
		await choose(page, 'Media', 'play')

		// Ball x moves linearly for the first 2.4s: its transform must change on every frame.
		const {frames, changes, layouts} = await page.evaluate(async () => {
			const ball = document.querySelector<HTMLElement>('.shape-layer[data-layer="1"]')!
			let frames = 0
			let changes = 0
			let last = ball.style.transform
			const layouts = new PerformanceObserver(() => {})
			layouts.observe({type: 'layout-shift', buffered: false})
			await new Promise<void>(done => {
				const start = performance.now()
				requestAnimationFrame(function frame(now) {
					frames++
					if (ball.style.transform !== last) changes++
					last = ball.style.transform
					if (now - start < 600) requestAnimationFrame(frame)
					else done()
				})
			})
			return {frames, changes, layouts: layouts.takeRecords().length}
		})
		expect(frames).toBeGreaterThan(10)
		expect(changes).toBeGreaterThanOrEqual(frames - 2)
		// Only transforms move: nothing in the page is laid out again.
		expect(layouts).toBe(0)

		// The playhead advances in real time, whatever the frame rate.
		await choose(page, 'Media', 'stop')
		await choose(page, 'Media', 'play')
		await page.waitForTimeout(1000)
		await choose(page, 'Media', 'pause')
		const seconds = parseFloat((await page.locator('#time').textContent())!)
		expect(seconds).toBeGreaterThan(0.8)
		expect(seconds).toBeLessThan(1.6)
	})
})
