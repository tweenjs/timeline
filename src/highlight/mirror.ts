/**
 * Syntax highlighting for a textarea, without a second copy of the editor.
 *
 * A textarea cannot colour its own text, so the code is also drawn by a `<pre>`
 * behind it, with the same metrics, and the textarea's own text is made
 * transparent (what stays on top of it is the caret, the selection and the
 * typing). The colours are not elements: they are ranges of the one text node of
 * the `<pre>` (`StaticRange`, which the browser does not have to keep up to date),
 * painted by the CSS Custom Highlight API (`::highlight()`, in highlight.css),
 * and only the lines in view and around them have any. So a document of 150 KB is one node, and no span is created
 * or laid out.
 *
 * Edits reach the `<pre>` as the smallest replacement (`replaceData`); the
 * tokenizer, debounced, catches up after it. Where the Highlight API is missing, or the
 * code is too big, the textarea shows its plain text.
 */
import type {Kind} from './lezer'

/** More than this is shown plain: tokenizing it would be slower than typing. */
const LIMIT = 600_000
/** The wait after the last change before the tokenizer runs again. */
const DELAY = 60

type Highlights = Map<string, unknown> & {set(name: string, value: unknown): void; delete(name: string): void}
const registry = (): Highlights | undefined => (globalThis.CSS as unknown as {highlights?: Highlights})?.highlights
const supported = () => !!registry() && typeof (globalThis as {Highlight?: unknown}).Highlight === 'function'

/** Makes `area` highlighted; returns what undoes it. */
export function attachHighlight(area: HTMLTextAreaElement): () => void {
	const box = area.parentElement!
	if (!supported()) return () => {}

	const mirror = document.createElement('pre')
	mirror.id = 'code-mirror'
	mirror.setAttribute('aria-hidden', 'true')
	const node = document.createTextNode('')
	mirror.append(node)
	box.prepend(mirror)

	let shown = ''
	// The tokens of `shown`, where each of its lines starts, and which lines are coloured.
	let found: Array<[number, number, Kind]> = []
	let lines: number[] = [0]
	let covered = [1, 0]
	let moving = 0
	let timer = 0
	let tokenize: ((text: string) => Array<[number, number, Kind]>) | undefined
	let loading = false
	let disposed = false
	const kinds = new Set<string>()

	const clear = () => {
		for (const kind of kinds) registry()!.delete('code-' + kind)
		kinds.clear()
		box.classList.remove('highlighted')
		found = []
	}

	const paint = () => {
		timer = 0
		if (disposed) return
		if (shown.length > LIMIT) return clear()
		if (!tokenize) {
			if (loading) return
			loading = true
			import('./lezer').then(
				module => {
					tokenize = module.tokens
					loading = false
					paint()
				},
				() => (loading = false),
			)
			return
		}
		found = tokenize(shown)
		lines = [0]
		for (let i = shown.indexOf('\n'); i !== -1; i = shown.indexOf('\n', i + 1)) lines.push(i + 1)
		covered = [1, 0]
		colour()
	}

	/**
	 * Colours the lines in view and a screenful around them, no more: every
	 * range is paint work in every frame that repaints the panel, and the
	 * playback repaints the page all the time. Scrolling moves the window.
	 */
	const colour = () => {
		if (disposed || !found.length) return
		const line = parseFloat(getComputedStyle(area).lineHeight) || 18
		const first = Math.floor(area.scrollTop / line)
		const count = Math.ceil(area.clientHeight / line)
		// Still inside what is coloured, with a screenful to spare.
		if (
			first >= covered[0] + count / 2 &&
			first + count <= covered[1] - count / 2 &&
			box.classList.contains('highlighted')
		)
			return
		const top = Math.max(0, first - count * 2)
		const bottom = Math.min(lines.length, first + count * 3)
		covered = [top === 0 ? -Infinity : top, bottom === lines.length ? Infinity : bottom]
		const from = lines[top]
		const to = bottom >= lines.length ? shown.length : lines[bottom]
		// The first token that ends after `from`.
		let low = 0
		let high = found.length
		while (low < high) {
			const middle = (low + high) >> 1
			if (found[middle][1] <= from) low = middle + 1
			else high = middle
		}
		const ranges = new Map<string, StaticRange[]>()
		for (let i = low; i < found.length && found[i][0] < to; i++) {
			const [start, end, kind] = found[i]
			// Static: a live Range is updated by the browser at every edit of the text.
			const range = new StaticRange({startContainer: node, startOffset: start, endContainer: node, endOffset: end})
			const list = ranges.get(kind)
			if (list) list.push(range)
			else ranges.set(kind, [range])
		}
		const Highlight = (globalThis as unknown as {Highlight: new (...ranges: StaticRange[]) => unknown}).Highlight
		for (const kind of kinds) if (!ranges.has(kind)) registry()!.delete('code-' + kind)
		kinds.clear()
		for (const [kind, list] of ranges) {
			registry()!.set('code-' + kind, new Highlight(...list))
			kinds.add(kind)
		}
		box.classList.add('highlighted')
	}

	const schedule = () => {
		clearTimeout(timer)
		timer = window.setTimeout(paint, DELAY)
	}

	/** Brings the `<pre>` to the text of the textarea, by changing only what differs. */
	const sync = () => {
		const text = area.value
		if (text === shown) return
		const most = Math.min(shown.length, text.length)
		let start = 0
		while (start < most && shown.charCodeAt(start) === text.charCodeAt(start)) start++
		let end = 0
		while (end < most - start && shown.charCodeAt(shown.length - 1 - end) === text.charCodeAt(text.length - 1 - end))
			end++
		node.replaceData(start, shown.length - start - end, text.slice(start, text.length - end))
		shown = text
		// A very different text (a template, an import) has nothing to keep: do not wait to colour it.
		if (start === 0 && end === 0) {
			clearTimeout(timer)
			timer = window.setTimeout(paint, 0)
		} else schedule()
	}

	const scroll = () => {
		mirror.scrollTop = area.scrollTop
		mirror.scrollLeft = area.scrollLeft
		if (!moving) moving = requestAnimationFrame(() => ((moving = 0), colour()))
	}

	// The editor sets `value` from code, which fires no event: follow it there too.
	const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!
	Object.defineProperty(area, 'value', {
		configurable: true,
		get() {
			return descriptor.get!.call(this)
		},
		set(value: string) {
			descriptor.set!.call(this, value)
			sync()
			scroll()
		},
	})
	area.addEventListener('input', sync)
	area.addEventListener('scroll', scroll, {passive: true})
	sync()
	if (shown) schedule()

	return () => {
		disposed = true
		clearTimeout(timer)
		cancelAnimationFrame(moving)
		area.removeEventListener('input', sync)
		area.removeEventListener('scroll', scroll)
		delete (area as {value?: unknown}).value
		clear()
		mirror.remove()
	}
}
