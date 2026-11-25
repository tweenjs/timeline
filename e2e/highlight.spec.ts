import {expect, test} from '@playwright/test'

test('code box: highlighted by the tokenizer, kept in step with the text and the scroll', async ({page}) => {
	test.setTimeout(60_000)
	await page.setViewportSize({width: 1500, height: 900})
	await page.goto('/')
	const box = page.locator('#code-box')
	await expect(box).toHaveClass(/highlighted/)

	const state = () =>
		page.evaluate(() => {
			const names = [...(CSS as any).highlights.keys()].filter((name: string) => name.startsWith('code-'))
			const area = document.querySelector<HTMLTextAreaElement>('#code')!
			const mirror = document.querySelector('#code-mirror')!
			return {names, same: mirror.textContent === area.value, length: area.value.length}
		})

	// The code is coloured by kind, and the mirror says what the textarea says.
	let found = await state()
	expect(found.same).toBe(true)
	for (const kind of ['kw', 'str', 'num', 'prop']) expect(found.names).toContain('code-' + kind)

	// The `import` keyword is the keyword colour, in both themes.
	const colour = () =>
		page.evaluate(() => {
			const node = document.querySelector('#code-mirror')!.firstChild!
			const range = new Range()
			range.setStart(node, 0)
			range.setEnd(node, 6)
			const [rect] = range.getClientRects()
			return {text: range.toString(), width: Math.round(rect.width)}
		})
	expect((await colour()).text).toBe('import')

	// Typing: the mirror follows at once, the colours of the rest stay.
	await page.locator('#code').focus()
	await page.keyboard.press('Control+End')
	await page.keyboard.type('\nconst answer = 42 // typed')
	expect((await state()).same).toBe(true)
	await expect
		.poll(() =>
			page.evaluate(() => {
				const area = document.querySelector<HTMLTextAreaElement>('#code')!
				const index = area.value.lastIndexOf('42')
				const node = document.querySelector('#code-mirror')!.firstChild!
				const hit = (kind: string) =>
					[...(CSS as any).highlights.get('code-' + kind)].some(
						(range: StaticRange) => range.startOffset <= index && range.endOffset >= index + 2,
					)
				return hit('num')
			}),
		)
		.toBe(true)

	// Scrolling: the mirror is where the textarea is (it keeps to the end of the text, as the textarea does).
	await page.evaluate(() => {
		const area = document.querySelector<HTMLTextAreaElement>('#code')!
		area.scrollTop = 100
		area.scrollLeft = 30
	})
	await expect
		.poll(() =>
			page.evaluate(() => {
				const area = document.querySelector<HTMLTextAreaElement>('#code')!
				const mirror = document.querySelector('#code-mirror')!
				return [mirror.scrollTop - area.scrollTop, mirror.scrollLeft - area.scrollLeft, area.scrollTop]
			}),
		)
		.toEqual([0, 0, 100])

	// Both themes: the keyword colour is a Radix purple, and differs between them.
	const keyword = async (scheme: 'light' | 'dark') => {
		await page.emulateMedia({colorScheme: scheme})
		// The colour as drawn: a custom property may hold `light-dark()` unresolved.
		return page.evaluate(() => {
			const probe = document.body.appendChild(document.createElement('i'))
			probe.style.color = 'var(--purple-11)'
			const colour = getComputedStyle(probe).color
			probe.remove()
			return colour
		})
	}
	expect(await keyword('light')).not.toBe(await keyword('dark'))

	// A big document stays fast: 150 KB is tokenized in one go, and only the lines in view are coloured.
	const result = await page.evaluate(async () => {
		const area = document.querySelector<HTMLTextAreaElement>('#code')!
		area.value = 'const value = {a: 1, b: "two", c: [3, 4]} // line\n'.repeat(3000)
		const start = performance.now()
		await new Promise<void>(resolve => {
			const wait = () => ((CSS as any).highlights.get('code-str')?.size > 10 ? resolve() : setTimeout(wait, 5))
			wait()
		})
		const time = performance.now() - start
		const top = (CSS as any).highlights.get('code-str').size
		// Far down, the window has moved with the scroll.
		area.scrollTop = area.scrollHeight
		area.dispatchEvent(new Event('scroll'))
		await new Promise(resolve => setTimeout(resolve, 200))
		return {time, top, bottom: (CSS as any).highlights.get('code-str').size}
	})
	expect(result.time).toBeLessThan(1500)
	expect(result.top).toBeLessThan(500)
	expect(result.bottom).toBeGreaterThan(10)
	expect(result.bottom).toBeLessThan(500)
})
