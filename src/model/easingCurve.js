/**
 * Custom easing curves for tween.js, as drawn with the timeline editor's curve
 * tool. This file has no dependencies: copy it next to a saved timeline.
 *
 * A curve is a list of nodes sorted by `x` (progress, 0 → 1). `y` is the eased
 * value and may leave 0..1 to overshoot. Each node has an incoming handle
 * (`ix`, `iy`) and an outgoing handle (`ox`, `oy`), stored relative to the
 * node. Neighbouring nodes are joined by a cubic bezier.
 *
 * The first node is pinned to (0, 0) and the last to (1, 1), and handles never
 * leave the horizontal span of their segment, so the curve is always a function
 * of `x` and can be used as an easing function.
 */

const MIN_GAP = 0.01

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value))
}

function bezier(p0, p1, p2, p3, t) {
	const u = 1 - t
	return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** A two-node curve, equivalent to CSS `cubic-bezier(x1, y1, x2, y2)`. */
export function cubicBezierNodes(x1, y1, x2, y2) {
	return [
		{x: 0, y: 0, ix: 0, iy: 0, ox: x1, oy: y1},
		{x: 1, y: 1, ix: x2 - 1, iy: y2 - 1, ox: 0, oy: 0},
	]
}

/**
 * Enforces the curve invariants in place: pinned ends, strictly increasing
 * node `x`, and handles inside their segment's horizontal span. A handle that
 * has to be shortened is scaled, so it keeps its direction.
 */
export function normalizeNodes(nodes) {
	const last = nodes.length - 1

	nodes[0].x = 0
	nodes[0].y = 0
	nodes[last].x = 1
	nodes[last].y = 1

	for (let i = 1; i < last; i++) {
		nodes[i].x = clamp(nodes[i].x, nodes[i - 1].x + MIN_GAP, 1 - MIN_GAP * (last - i))
	}

	for (let i = 0; i <= last; i++) {
		const node = nodes[i]
		const before = i === 0 ? 0 : node.x - nodes[i - 1].x
		const after = i === last ? 0 : nodes[i + 1].x - node.x

		if (node.ix > 0) node.ix = 0
		if (node.ox < 0) node.ox = 0
		if (-node.ix > before) {
			node.iy = before === 0 ? 0 : node.iy * (before / -node.ix)
			node.ix = -before
		}
		if (node.ox > after) {
			node.oy = after === 0 ? 0 : node.oy * (after / node.ox)
			node.ox = after
		}
	}

	return nodes
}

/** Accepts `{x, y, ix, iy, ox, oy}` nodes or compact `[x, y, ix, iy, ox, oy]` rows. */
function toNodes(nodes) {
	return normalizeNodes(
		nodes.map(node => {
			const [x, y, ix = 0, iy = 0, ox = 0, oy = 0] = Array.isArray(node)
				? node
				: [node.x, node.y, node.ix, node.iy, node.ox, node.oy]
			return {x, y, ix, iy, ox, oy}
		}),
	)
}

/**
 * Bakes a curve into an easing function:
 *
 * ```js
 * new Tween(box).to({x: 300}, 1000).easing(curveEasing([[0, 0, 0, 0, 0.3, 0], [1, 1, -0.3, 0, 0, 0]]))
 * ```
 *
 * Each sample solves the bezier for `x` by bisection (a segment is monotonic
 * in `x`), then the easing itself is a table lookup, so it costs about the same
 * per frame as a built-in easing. The returned function exposes the curve it
 * was baked from as `easing.nodes`.
 */
export function curveEasing(nodes, samples = 256) {
	nodes = toNodes(nodes)

	const table = new Float64Array(samples + 1)
	let index = 0

	for (let s = 0; s <= samples; s++) {
		const x = s / samples
		while (index < nodes.length - 2 && x > nodes[index + 1].x) index++
		const a = nodes[index]
		const b = nodes[index + 1]

		let low = 0
		let high = 1
		for (let i = 0; i < 32; i++) {
			const middle = (low + high) / 2
			if (bezier(a.x, a.x + a.ox, b.x + b.ix, b.x, middle) < x) low = middle
			else high = middle
		}
		table[s] = bezier(a.y, a.y + a.oy, b.y + b.iy, b.y, (low + high) / 2)
	}

	table[0] = 0
	table[samples] = 1

	function easing(amount) {
		if (amount <= 0) return 0
		if (amount >= 1) return 1
		const position = amount * samples
		const i = Math.floor(position)
		return table[i] + (table[i + 1] - table[i]) * (position - i)
	}
	easing.nodes = nodes
	return easing
}

/** The easing of CSS `cubic-bezier(x1, y1, x2, y2)`. */
export function cubicBezier(x1, y1, x2, y2) {
	return curveEasing(cubicBezierNodes(x1, y1, x2, y2))
}
