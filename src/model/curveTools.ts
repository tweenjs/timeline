import {Easing} from '@tweenjs/tween.js'
import {cubicBezierNodes, curveEasing, normalizeNodes, type CurveNode} from './easingCurve.js'
import {LINEAR, presetEase, type Ease, type Keyframe} from './types'

export type EasingFn = (amount: number) => number

const MIN_GAP = 0.01
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// ---------------------------------------------------------------------------
// Built-in easings
// ---------------------------------------------------------------------------

/** Names of the tween.js easings, f.e. `Quadratic.InOut`. */
export const easingNames: string[] = []
export const easingByName = new Map<string, EasingFn>()
export const nameByEasing = new Map<EasingFn, string>()

for (const [family, group] of Object.entries(Easing)) {
	if (typeof group !== 'object') continue
	for (const [name, easing] of Object.entries(group as Record<string, EasingFn>)) {
		const fullName = family + '.' + name
		easingByName.set(fullName, easing)
		nameByEasing.set(easing, family === 'Linear' ? LINEAR : fullName)
		if (family !== 'Linear' || name === 'None') easingNames.push(fullName)
	}
}

/** The easing function for a keyframe's `ease`. */
export function easingFunction(ease: Ease): EasingFn {
	if (ease.type !== 'curve') return easingByName.get(ease.name) ?? Easing.Linear.None

	// Building a curve's lookup table takes thousands of steps, and a document
	// is recompiled after every edit: keep the tables of curves that did not change.
	const id = ease.nodes.map(node => `${node.x},${node.y},${node.ix},${node.iy},${node.ox},${node.oy}`).join(';')
	let easing = curveCache.get(id)
	if (!easing) {
		if (curveCache.size >= 4000) curveCache.clear()
		curveCache.set(id, (easing = curveEasing(ease.nodes.map(node => ({...node})))))
	}
	return easing
}

const curveCache = new Map<string, EasingFn>()

/** The `ease` of an easing function found in code. Unknown functions are traced. */
export function easeOf(easing: unknown, onTraced?: () => void): Ease {
	if (typeof easing !== 'function') throw new Error('easing expects a function.')
	const name = nameByEasing.get(easing as EasingFn)
	if (name) return presetEase(name)
	const nodes = (easing as {nodes?: CurveNode[]}).nodes
	if (nodes) return {type: 'curve', nodes: nodes.map(node => ({...node}))}
	onTraced?.()
	return {type: 'curve', nodes: fitCurveNodes(easing as EasingFn)}
}

// ---------------------------------------------------------------------------
// Sampling keyframes
// ---------------------------------------------------------------------------

/** Index of the segment of `track` that contains `time`, or -1 outside of them. */
export function segmentAt(track: Keyframe[], time: number): number {
	if (track.length < 2 || time < track[0].t || time >= track[track.length - 1].t) return -1
	let i = 0
	while (track[i + 1].t <= time) i++
	return i
}

/**
 * The value of a track at `time`. `easings` holds the easing function of each
 * segment (see `trackEasings`). `fallback` is the value without keyframes.
 */
export function sampleTrack(track: Keyframe[], easings: EasingFn[], time: number, fallback: number): number {
	if (!track.length) return fallback
	if (time <= track[0].t) return track[0].v
	const i = segmentAt(track, time)
	if (i === -1) return track[track.length - 1].v
	const from = track[i]
	const to = track[i + 1]
	return from.v + (to.v - from.v) * easings[i]((time - from.t) / (to.t - from.t))
}

export function trackEasings(track: Keyframe[]): EasingFn[] {
	return track.slice(0, -1).map(keyframe => easingFunction(keyframe.ease))
}

// ---------------------------------------------------------------------------
// Curve tool
// ---------------------------------------------------------------------------

export const curvePresets: Record<string, () => CurveNode[]> = {
	Linear: () => cubicBezierNodes(0.33, 0.33, 0.67, 0.67),
	Ease: () => cubicBezierNodes(0.25, 0.1, 0.25, 1),
	'Ease in': () => cubicBezierNodes(0.55, 0, 1, 0.45),
	'Ease out': () => cubicBezierNodes(0, 0.55, 0.45, 1),
	'Ease in-out': () => cubicBezierNodes(0.65, 0, 0.35, 1),
	Overshoot: () => cubicBezierNodes(0.3, 1.45, 0.6, 1),
	Anticipate: () => cubicBezierNodes(0.4, 0, 0.7, -0.45),
	Bounce: () => [
		{x: 0, y: 0, ix: 0, iy: 0, ox: 0.2, oy: 0},
		{x: 0.4, y: 1, ix: -0.08, iy: -0.45, ox: 0.06, oy: -0.24},
		{x: 0.72, y: 1, ix: -0.06, iy: -0.24, ox: 0.04, oy: -0.1},
		{x: 0.9, y: 1, ix: -0.04, iy: -0.1, ox: 0.03, oy: -0.035},
		{x: 1, y: 1, ix: -0.03, iy: -0.035, ox: 0, oy: 0},
	],
}

export function curve(name: string): Ease {
	return {type: 'curve', nodes: curvePresets[name]()}
}

/**
 * Traces any easing function with a curve, so it becomes editable.
 *
 * Nodes go where the function has a corner (f.e. each bounce), then where the
 * curve is furthest off, until it stays within `tolerance` of the function.
 */
export function fitCurveNodes(easing: EasingFn, tolerance = 0.01, maxNodes = 16): CurveNode[] {
	const step = 1 / 2000
	const slope = (from: number, to: number) => (easing(to) - easing(from)) / (to - from)
	const bend = (x: number) => Math.abs(slope(x, x + step) - slope(x - step, x))

	// Corners: where the slope jumps between two neighbouring steps.
	const stops = [0]
	for (let x = 0.02; x < 0.98; x += step) {
		const here = bend(x)
		const isCorner = here > 0.5 && here >= bend(x - step) && here > bend(x + step)
		if (isCorner && x - stops[stops.length - 1] > 0.02) stops.push(x)
	}
	stops.push(1)

	for (;;) {
		// Each side of a node follows the slope on that side, so corners stay
		// sharp. A handle never rises further than its segment does, which
		// keeps near vertical slopes (f.e. Circular) from overshooting.
		const nodes = stops.map((x, i) => {
			const y = easing(x)
			const handle = (reach: number, toX: number, direction: number) => {
				if (!reach) return [0, 0]
				const rise = reach * slope(Math.min(x, toX), Math.max(x, toX))
				const limit = Math.max(0.1, Math.abs(easing(x + direction * reach * 3) - y))
				const scale = Math.min(1, limit / Math.abs(rise))
				return [direction * reach * scale, direction * rise * scale]
			}
			const [ix, iy] = handle(i === 0 ? 0 : (x - stops[i - 1]) / 3, x - 0.001, -1)
			const [ox, oy] = handle(i === stops.length - 1 ? 0 : (stops[i + 1] - x) / 3, x + 0.001, 1)
			return {x, y, ix, iy, ox, oy}
		})
		normalizeNodes(nodes)

		const fitted = curveEasing(nodes)
		let worst = 0
		let error = 0
		for (let x = 0.0025; x < 1; x += 0.0025) {
			const distance = Math.abs(fitted(x) - easing(x))
			if (distance > error) {
				error = distance
				worst = x
			}
		}

		const crowded = stops.some(x => Math.abs(x - worst) < 0.02)
		if (error <= tolerance || crowded || stops.length >= maxNodes) return nodes

		stops.push(worst)
		stops.sort((a, b) => a - b)
	}
}

/**
 * Inserts a node at `x` without changing the shape much: the node sits on the
 * curve and its handles follow the local slope. Returns the new node's index.
 */
export function insertNode(nodes: CurveNode[], x: number): number {
	const easing = curveEasing(nodes)
	x = clamp(x, MIN_GAP, 1 - MIN_GAP)

	let index = nodes.findIndex(node => node.x > x)
	if (index === -1) index = nodes.length - 1

	const span = Math.min(x - nodes[index - 1].x, nodes[index].x - x)
	const reach = span / 3
	const step = Math.min(0.01, span / 2)
	const slope = step > 0 ? (easing(x + step) - easing(x - step)) / (2 * step) : 0

	nodes.splice(index, 0, {x, y: easing(x), ix: -reach, iy: -reach * slope, ox: reach, oy: reach * slope})
	normalizeNodes(nodes)
	return index
}

// ---------------------------------------------------------------------------
// SVG path data (the `owneasing` package draws easings this way)
// ---------------------------------------------------------------------------

const fixed = (value: number) => String(+value.toFixed(2))

/**
 * A curve as SVG path data in a 100 x 100 box, the form `OwnEasing(d)` takes:
 * progress runs left to right, and the value from the bottom (0) to the top (1).
 */
export function nodesToPath(nodes: CurveNode[]): string {
	const point = (x: number, y: number) => fixed(x * 100) + ',' + fixed((1 - y) * 100)
	let path = 'M' + point(nodes[0].x, nodes[0].y)
	for (let i = 0; i < nodes.length - 1; i++) {
		const a = nodes[i]
		const b = nodes[i + 1]
		path += ` C${point(a.x + a.ox, a.y + a.oy)} ${point(b.x + b.ix, b.y + b.iy)} ${point(b.x, b.y)}`
	}
	return path
}

/** Reads SVG path data (M, L, H, V, C, S, Q, T; absolute or relative) as a curve. */
export function pathToNodes(d: string, width = 100, height = 100): CurveNode[] {
	const tokens = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
	type Point = [number, number]
	const beziers: Array<[Point, Point, Point, Point]> = []
	let command = ''
	let current: Point = [0, 0]
	let lastControl: Point | null = null
	let i = 0

	const read = () => {
		const value = parseFloat(tokens[i++])
		if (Number.isNaN(value)) throw new Error('This easing path could not be read.')
		return value
	}

	while (i < tokens.length) {
		if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++]
		const relative = command === command.toLowerCase()
		const base: Point = relative ? current : [0, 0]
		const point = (): Point => [base[0] + read(), base[1] + read()]
		const from = current
		let c1: Point
		let c2: Point
		let to: Point

		switch (command.toUpperCase()) {
			case 'M':
				current = point()
				command = relative ? 'l' : 'L'
				lastControl = null
				continue
			case 'Z':
				continue
			case 'L':
				to = point()
				c1 = [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3]
				c2 = [from[0] + ((to[0] - from[0]) * 2) / 3, from[1] + ((to[1] - from[1]) * 2) / 3]
				break
			case 'H':
				to = [base[0] + read(), from[1]]
				c1 = [from[0] + (to[0] - from[0]) / 3, from[1]]
				c2 = [from[0] + ((to[0] - from[0]) * 2) / 3, from[1]]
				break
			case 'V':
				to = [from[0], base[1] + read()]
				c1 = [from[0], from[1] + (to[1] - from[1]) / 3]
				c2 = [from[0], from[1] + ((to[1] - from[1]) * 2) / 3]
				break
			case 'C':
				c1 = point()
				c2 = point()
				to = point()
				break
			case 'S':
				c1 = lastControl ? [2 * from[0] - lastControl[0], 2 * from[1] - lastControl[1]] : from
				c2 = point()
				to = point()
				break
			case 'Q':
			case 'T': {
				const q: Point =
					command.toUpperCase() === 'Q'
						? point()
						: lastControl
							? [2 * from[0] - lastControl[0], 2 * from[1] - lastControl[1]]
							: from
				to = point()
				c1 = [from[0] + ((q[0] - from[0]) * 2) / 3, from[1] + ((q[1] - from[1]) * 2) / 3]
				c2 = [to[0] + ((q[0] - to[0]) * 2) / 3, to[1] + ((q[1] - to[1]) * 2) / 3]
				beziers.push([from, c1, c2, to])
				current = to
				lastControl = q
				continue
			}
			default:
				throw new Error(`Easing paths with "${command}" commands are not supported.`)
		}

		beziers.push([from, c1, c2, to])
		current = to
		lastControl = c2
	}

	if (!beziers.length) throw new Error('This easing path has no segments.')

	const x = (value: number) => value / width
	const y = (value: number) => 1 - value / height
	const nodes: CurveNode[] = [{x: x(beziers[0][0][0]), y: y(beziers[0][0][1]), ix: 0, iy: 0, ox: 0, oy: 0}]

	for (const [from, c1, c2, to] of beziers) {
		const previous = nodes[nodes.length - 1]
		previous.ox = x(c1[0]) - x(from[0])
		previous.oy = y(c1[1]) - y(from[1])
		nodes.push({x: x(to[0]), y: y(to[1]), ix: x(c2[0]) - x(to[0]), iy: y(c2[1]) - y(to[1]), ox: 0, oy: 0})
	}

	return normalizeNodes(nodes)
}
