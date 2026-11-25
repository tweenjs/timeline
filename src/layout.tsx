/**
 * The sizes of the panels around the stage: the left one (Properties), the
 * right one (Code) and the bottom one (Timeline). Each is dragged by the
 * divider between it and the stage, and the sizes are remembered.
 *
 * The sizes are CSS variables on the page, which `styles.css` builds the grid
 * from: dragging a divider writes one variable per frame, and nothing is
 * rendered again by Solid.
 */
import {embedded} from './embed'

export type Side = 'left' | 'right' | 'bottom'

export const LAYOUT_KEY = 'tweenjs-timeline-editor-layout'
const DEFAULTS: Record<Side, number> = {left: 290, right: 430, bottom: 300}
const SMALLEST: Record<Side, number> = {left: 200, right: 240, bottom: 120}
/** What must be left for the stage, across and down. */
const STAGE = {width: 260, height: 160}
/** The menu, the toolbar and the playback bar: about this much height is not a panel. */
const BARS = 136
/** The space around and between the three columns: two gaps and two paddings of 8px. */
const GAPS = 32

const sizes: Record<Side, number> = {...DEFAULTS}

/** The largest a panel may be now, given the window and the panel across from it. */
function largest(side: Side): number {
	if (side === 'bottom') return Math.max(SMALLEST.bottom, innerHeight - BARS - STAGE.height)
	const other = side === 'left' ? sizes.right : sizes.left
	return Math.max(SMALLEST[side], innerWidth - other - STAGE.width - GAPS)
}

function show() {
	for (const side of Object.keys(sizes) as Side[]) {
		document.documentElement.style.setProperty('--' + side, Math.min(sizes[side], largest(side)) + 'px')
	}
}

function save() {
	if (embedded) return
	try {
		localStorage.setItem(LAYOUT_KEY, JSON.stringify(sizes))
	} catch {
		// Private browsing: the sizes last for this visit.
	}
}

export function panelSize(side: Side): number {
	return sizes[side]
}

export function setPanelSize(side: Side, size: number, remember = true) {
	sizes[side] = Math.round(Math.min(Math.max(size, SMALLEST[side]), largest(side)))
	show()
	if (remember) save()
}

try {
	const stored = JSON.parse((!embedded && localStorage.getItem(LAYOUT_KEY)) || '{}') as Partial<Record<Side, unknown>>
	for (const side of Object.keys(sizes) as Side[]) {
		const size = stored[side]
		if (typeof size === 'number' && Number.isFinite(size)) sizes[side] = Math.max(SMALLEST[side], size)
	}
} catch {
	// Nothing stored, or not what this version stores: the defaults.
}
show()
// A smaller window squeezes the panels; the sizes that were chosen come back when it grows.
addEventListener('resize', show)

const LABELS: Record<Side, string> = {
	left: 'Resize the Properties panel',
	right: 'Resize the Code panel',
	bottom: 'Resize the Timeline panel',
}

/** The divider between a panel and the stage. Drag it, or use the arrow keys; double-click for the usual size. */
export function Divider(props: {side: Side}) {
	const side = props.side
	// Dragging away from the panel's own edge of the window makes it larger.
	const grow = (from: PointerEvent, to: PointerEvent) =>
		side === 'left'
			? to.clientX - from.clientX
			: side === 'right'
				? from.clientX - to.clientX
				: from.clientY - to.clientY

	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0) return
		event.preventDefault()
		const handle = event.currentTarget as HTMLElement
		const start = Math.min(sizes[side], largest(side))
		let latest: PointerEvent | null = null
		let request = 0

		// Pointer events arrive faster than frames: one resize per frame, with the latest.
		const run = () => {
			request = 0
			if (latest) setPanelSize(side, start + grow(event, latest), false)
			latest = null
		}
		const onMove = (moved: PointerEvent) => {
			latest = moved
			request ||= requestAnimationFrame(run)
		}
		const end = () => {
			removeEventListener('pointermove', onMove)
			removeEventListener('pointerup', end)
			removeEventListener('pointercancel', end)
			cancelAnimationFrame(request)
			run()
			handle.classList.remove('dragging')
			document.documentElement.classList.remove('resizing-' + (side === 'bottom' ? 'rows' : 'columns'))
			handle.setAttribute('aria-valuenow', String(sizes[side]))
			save()
		}
		handle.classList.add('dragging')
		// The cursor keeps its shape wherever the pointer goes, and nothing is selected on the way.
		document.documentElement.classList.add('resizing-' + (side === 'bottom' ? 'rows' : 'columns'))
		addEventListener('pointermove', onMove)
		addEventListener('pointerup', end)
		addEventListener('pointercancel', end)
	}

	const onKeyDown = (event: KeyboardEvent) => {
		const larger = side === 'left' ? 'ArrowRight' : side === 'right' ? 'ArrowLeft' : 'ArrowUp'
		const smaller = side === 'left' ? 'ArrowLeft' : side === 'right' ? 'ArrowRight' : 'ArrowDown'
		if (event.key !== larger && event.key !== smaller) return
		event.preventDefault()
		event.stopPropagation()
		setPanelSize(side, sizes[side] + (event.key === larger ? 16 : -16))
		;(event.currentTarget as HTMLElement).setAttribute('aria-valuenow', String(sizes[side]))
	}

	return (
		<div
			class={['divider', 'divider-' + side]}
			role="separator"
			tabindex="0"
			aria-orientation={side === 'bottom' ? 'horizontal' : 'vertical'}
			aria-label={LABELS[side]}
			aria-valuenow={sizes[side]}
			aria-valuemin={SMALLEST[side]}
			title="Drag to resize. Double-click for the usual size."
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
			onDblClick={event => {
				setPanelSize(side, DEFAULTS[side])
				event.currentTarget.setAttribute('aria-valuenow', String(sizes[side]))
			}}
		/>
	)
}
