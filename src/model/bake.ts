import {easingByName, fitCurveNodes} from './curveTools'
import {curveEasing, normalizeNodes} from './easingCurve.js'
import {presetEase, type Ease, type Keyframe} from './types'

/**
 * Turns any motion, given as a function of time, into keyframes.
 *
 * Between two keyframes the editor can only ease, so each stretch of the
 * function is matched against the built-in easings first (a quarter turn of
 * a circle is exactly `Sinusoidal.In` or `.Out`), then traced with the curve
 * tool, and split in two when neither follows it within `tolerance`.
 */

const CANDIDATES = [
	'Linear.None',
	'Sinusoidal.In',
	'Sinusoidal.Out',
	'Sinusoidal.InOut',
	'Quadratic.In',
	'Quadratic.Out',
	'Quadratic.InOut',
	'Cubic.In',
	'Cubic.Out',
	'Cubic.InOut',
]
const SAMPLES = 16
/** The motion is read this many times per stretch; fitting works on those readings. */
const READINGS = SAMPLES * 8
const MIN_SEGMENT = 40 // ms
const MAX_NODES = 5

const round = (value: number) => Math.round(value * 1000) / 1000 + 0

/**
 * `breaks` are the times that must be keyframes (at least the start and the
 * end): where the motion changes character, or jumps. A jump is written as two
 * breaks one millisecond apart, with `motion` returning the value before the
 * jump at the first.
 */
export function bake(motion: (time: number) => number, breaks: number[], tolerance: number): Keyframe[] {
	const times = [...new Set(breaks.map(Math.round))].sort((a, b) => a - b)
	const keyframes: Keyframe[] = []

	const segment = (from: number, to: number, depth: number) => {
		const start = round(motion(from))
		const delta = round(motion(to)) - start
		const span = to - from
		const readings: number[] = []
		for (let i = 0; i <= READINGS; i++) readings.push(motion(from + (span * i) / READINGS))
		const values: number[] = []
		for (let i = 1; i < SAMPLES; i++) values.push(readings[i * 8])

		let ease: Ease | null = null
		if (span <= MIN_SEGMENT || depth >= 6) ease = presetEase()
		else if (Math.abs(delta) <= tolerance) {
			// Ends where it starts: fine if it never left.
			if (values.every(value => Math.abs(value - start) <= tolerance)) ease = presetEase()
		} else {
			const shape = values.map(value => (value - start) / delta)
			const fits = (easing: (amount: number) => number, slack: number) =>
				shape.every((value, i) => Math.abs(value - easing((i + 1) / SAMPLES)) * Math.abs(delta) <= slack)

			const name = CANDIDATES.find(candidate => fits(easingByName.get(candidate)!, tolerance))
			if (name) ease = presetEase(name)
			else if (shape.every(value => value > -0.4 && value < 1.4)) {
				const easing = (amount: number) => {
					if (amount <= 0) return 0
					if (amount >= 1) return 1
					const at = amount * READINGS
					const i = Math.floor(at)
					return (readings[i] + (readings[i + 1] - readings[i]) * (at - i) - start) / delta
				}
				const traced = fitCurveNodes(easing, Math.min(0.03, Math.max(0.004, tolerance / Math.abs(delta))), MAX_NODES)
				const nodes = normalizeNodes(
					traced.map(node => ({
						x: round(node.x),
						y: round(node.y),
						ix: round(node.ix),
						iy: round(node.iy),
						ox: round(node.ox),
						oy: round(node.oy),
					})),
				)
				if (nodes.length <= MAX_NODES && fits(curveEasing(nodes), tolerance * 2)) ease = {type: 'curve', nodes}
			}
		}

		if (ease) keyframes.push({t: from, v: start, ease})
		else {
			const middle = Math.round((from + to) / 2)
			segment(from, middle, depth + 1)
			segment(middle, to, depth + 1)
		}
	}

	for (let i = 0; i < times.length - 1; i++) segment(times[i], times[i + 1], 0)
	const end = times[times.length - 1]
	keyframes.push({t: end, v: round(motion(end)), ease: presetEase()})
	return keyframes
}

/** Whether baked keyframes never move. */
export function isStill(keyframes: Keyframe[]): boolean {
	return keyframes.every(keyframe => keyframe.v === keyframes[0].v && keyframe.ease.type === 'preset')
}
