import {For, Show, createMemo} from 'solid-js'
import {easingFunction, insertNode} from '../model/curveTools'
import {normalizeNodes} from '../model/easingCurve.js'
import type {CurveNode, Keyframe} from '../model/types'
import {clamp, commit, drag, getDoc, locked, player, record, round, setCurve, setDoc, ui} from '../state'

/** The curve tool plots progress 0..1 on x and eased value -0.5..1.5 on y. */
const PLOT = {left: 20, width: 220, bottom: 160, unit: 100, viewWidth: 260, viewHeight: 220, min: -0.5, max: 1.5}

const plotX = (x: number) => PLOT.left + x * PLOT.width
const plotY = (y: number) => PLOT.bottom - y * PLOT.unit

let svg: SVGSVGElement | undefined
let dot: SVGCircleElement | undefined

/** Where the playhead is on the selected keyframe's easing curve. */
player.onFrame(time => {
	if (!dot?.isConnected || !ui.prop) return
	const track = player.doc.layers[ui.layer]?.tracks[ui.prop]
	const from = track?.[ui.key]
	const to = track?.[ui.key + 1]
	const inside = !!from && !!to && time >= from.t && time <= to.t
	dot.style.display = inside ? '' : 'none'
	if (!inside) return
	const x = (time - from.t) / (to.t - from.t)
	const y = clamp(player.easingOf(from)?.(x) ?? x, PLOT.min, PLOT.max)
	dot.setAttribute('transform', `translate(${round(plotX(x))} ${round(plotY(y))})`)
})

/** The nodes of the selected keyframe's curve, as a copy to edit. */
function selectedNodes(): CurveNode[] | null {
	const ease = ui.prop && getDoc().layers[ui.layer]?.tracks[ui.prop][ui.key]?.ease
	return ease && ease.type === 'curve' ? structuredClone(ease.nodes) : null
}

function writeNodes(nodes: CurveNode[]) {
	const {layer, prop, key} = ui
	if (!prop) return
	normalizeNodes(nodes)
	setDoc(draft => {
		setCurve(draft.layers[layer].tracks[prop][key], nodes)
	})
}

/** Pointer position in curve units. */
function locate(pointer: MouseEvent) {
	const box = svg!.getBoundingClientRect()
	const scale = PLOT.viewWidth / box.width
	return {
		x: ((pointer.clientX - box.left) * scale - PLOT.left) / PLOT.width,
		y: clamp((PLOT.bottom - (pointer.clientY - box.top) * scale) / PLOT.unit, PLOT.min, PLOT.max),
	}
}

let lastDown = {time: 0, target: ''}

function onPointerDown(event: PointerEvent) {
	const nodes = selectedNodes()
	if (!nodes || locked()) return

	const data = (event.target as SVGElement).dataset
	const kind = (data.kind ?? '') as '' | 'node' | 'in' | 'out'
	const index = Number(data.index)

	// Double clicks are detected here: the first click may already have changed the graph.
	const target = kind + (kind ? index : '')
	const double = event.timeStamp - lastDown.time < 350 && lastDown.target === target
	lastDown = {time: double ? 0 : event.timeStamp, target}

	if (double) {
		event.preventDefault()
		if (kind === 'node' && index > 0 && index < nodes.length - 1) {
			nodes.splice(index, 1)
			record(() => writeNodes(nodes))
		} else if (!kind) {
			insertNode(nodes, locate(event).x)
			record(() => writeNodes(nodes))
		}
		return
	}

	if (!kind) return
	const fixed = index === 0 || index === nodes.length - 1

	drag(event, moved => {
		const edited = selectedNodes()
		const node = edited?.[index]
		if (!edited || !node) return
		const point = locate(moved)

		if (kind === 'node') {
			if (fixed) return
			node.x = point.x
			node.y = point.y
		} else {
			const [ownX, ownY, otherX, otherY] =
				kind === 'in' ? (['ix', 'iy', 'ox', 'oy'] as const) : (['ox', 'oy', 'ix', 'iy'] as const)
			const direction = kind === 'in' ? -1 : 1
			const dx = Math.max(0, (point.x - node.x) * direction) * direction
			const dy = point.y - node.y
			node[ownX] = dx
			node[ownY] = dy

			// Keep the point smooth: the opposite handle stays in line (Alt breaks it).
			const length = Math.hypot(dx, dy)
			const reach = Math.hypot(node[otherX], node[otherY])
			if (!moved.altKey && !fixed && length > 0 && reach > 0) {
				node[otherX] = (-dx / length) * reach
				node[otherY] = (-dy / length) * reach
			}
		}

		writeNodes(edited)
		commit()
	})
}

/** The easing of the segment that leaves `keyframe`, drawn; and edited by hand when it is a curve. */
export function CurveEditor(props: {keyframe: Keyframe}) {
	const points = createMemo(() => {
		const easing = easingFunction(props.keyframe.ease)
		const list: string[] = []
		for (let i = 0; i <= 160; i++) {
			const x = i / 160
			list.push(round(plotX(x)) + ',' + round(plotY(clamp(easing(x), PLOT.min - 0.1, PLOT.max + 0.1))))
		}
		return list.join(' ')
	})
	const nodes = createMemo(() => {
		const ease = props.keyframe.ease
		return ease.type === 'curve' ? ease.nodes : []
	})

	return (
		<svg
			id="curve"
			viewBox={`0 0 ${PLOT.viewWidth} ${PLOT.viewHeight}`}
			ref={element => (svg = element)}
			onPointerDown={onPointerDown}
		>
			<rect class="unit" x={PLOT.left} y={plotY(1)} width={PLOT.width} height={PLOT.unit} />
			<For each={[0.25, 0.5, 0.75]}>
				{value => <line class="grid" x1={plotX(value)} y1={plotY(1)} x2={plotX(value)} y2={plotY(0)} />}
			</For>
			<line class="grid" x1={PLOT.left} y1={plotY(0.5)} x2={PLOT.left + PLOT.width} y2={plotY(0.5)} />
			<text x={PLOT.left} y={plotY(0) + 12}>
				0
			</text>
			<text x={PLOT.left + PLOT.width} y={plotY(0) + 12} text-anchor="end">
				progress 1
			</text>
			<text x={PLOT.left - 4} y={plotY(1) + 3} text-anchor="end">
				1
			</text>
			<polyline class="shape" points={points()} />

			<For each={nodes()} keyed={false}>
				{(node, index) => (
					<>
						<Show when={index > 0}>
							<line
								class="arm"
								x1={plotX(node().x)}
								y1={plotY(node().y)}
								x2={plotX(node().x + node().ix)}
								y2={plotY(node().y + node().iy)}
							/>
							<circle
								class="handle"
								data-kind="in"
								data-index={index}
								cx={plotX(node().x + node().ix)}
								cy={plotY(node().y + node().iy)}
								r="4"
							/>
						</Show>
						<Show when={index < nodes().length - 1}>
							<line
								class="arm"
								x1={plotX(node().x)}
								y1={plotY(node().y)}
								x2={plotX(node().x + node().ox)}
								y2={plotY(node().y + node().oy)}
							/>
							<circle
								class="handle"
								data-kind="out"
								data-index={index}
								cx={plotX(node().x + node().ox)}
								cy={plotY(node().y + node().oy)}
								r="4"
							/>
						</Show>
					</>
				)}
			</For>
			<For each={nodes()} keyed={false}>
				{(node, index) => (
					<rect
						class={['node', {fixed: index === 0 || index === nodes().length - 1}]}
						data-kind="node"
						data-index={index}
						x={plotX(node().x) - 4.5}
						y={plotY(node().y) - 4.5}
						width="9"
						height="9"
					/>
				)}
			</For>
			<circle class="dot" id="curve-dot" r="3.5" ref={element => (dot = element)} />
		</svg>
	)
}
