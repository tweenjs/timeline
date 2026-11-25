import {For, Show, createMemo} from 'solid-js'
import {easingFunction, sampleTrack, type EasingFn} from '../model/curveTools'
import {COMP, RADIUS, type Keyframe, type Layer, type Prop} from '../model/types'
import type {SceneCode} from '../model/scenes'
import type {SceneView} from '../scene3d/run'
import {clamp, commit, doc, drag, locked, plain, player, round, select, setDoc, setValue, ui} from '../state'

let comp: HTMLElement | undefined
let compScale = 1

/** The element of each layer, by layer index, and the styles last written to it. */
const shapes: Array<HTMLElement | undefined> = []
const written = new WeakMap<HTMLElement, {transform: string; opacity: number}>()

/**
 * The only work done per layer per frame: one `transform` and one `opacity`,
 * both composited without layout or paint, and skipped when unchanged.
 */
player.onFrame(() => {
	const count = player.doc.layers.length
	for (let i = 0; i < count; i++) {
		const element = shapes[i]
		if (!element) continue
		let last = written.get(element)
		if (!last) written.set(element, (last = {transform: '', opacity: NaN}))

		// A 3D scene is not turned or scaled as a picture: those two move its camera.
		const layer = player.doc.layers[i]
		const flat = layer.shape !== 'three'
		const anchor = layer.align === 'left' ? '0' : layer.align === 'right' ? '-100%' : '-50%'
		const transform =
			`translate3d(${round(player.valueOf(i, 'x'))}px, ${round(player.valueOf(i, 'y'))}px, 0) translate(${anchor}, -50%)` +
			(flat ? ` rotate(${round(player.valueOf(i, 'rotation'))}deg) scale(${round(player.valueOf(i, 'scale'))})` : '')
		if (transform !== last.transform) element.style.transform = last.transform = transform

		const opacity = round(clamp(player.valueOf(i, 'opacity'), 0, 1))
		if (opacity !== last.opacity) element.style.opacity = String((last.opacity = opacity))
	}
})

/**
 * The three.js scenes on the stage, by canvas. A scene is the layer's own code
 * (see model/scenes.ts): scene3d/run.ts runs it. That module, and three.js
 * with it, is only loaded once a document has such a layer.
 */
type Scene3d = {layer: number; view?: SceneView; failed?: boolean}
const scenes = new Map<HTMLCanvasElement, Scene3d>()

/** What went wrong in a scene is written over its layer (see `[data-error]` in styles.css). */
function fail(canvas: HTMLCanvasElement, scene: Scene3d, error: unknown) {
	scene.failed = true
	const message = error instanceof Error ? error.message : String(error)
	if (canvas.parentElement) canvas.parentElement.dataset.error = message
	console.error(error)
}

function mountScene(canvas: HTMLCanvasElement, layer: number, code: SceneCode) {
	const scene: Scene3d = {layer}
	scenes.set(canvas, scene)
	import('../scene3d/run')
		.then(({mountScene}) => {
			if (!scenes.has(canvas)) return
			scene.view = mountScene(canvas, code)
			player.emit(true)
		})
		.catch(error => fail(canvas, scene, error))
}

player.onFrame(time => {
	for (const [canvas, scene] of scenes) {
		const layer = player.doc.layers[scene.layer]
		// A canvas that left the page takes its WebGL context with it.
		if (!canvas.isConnected || layer?.shape !== 'three') {
			if (!canvas.isConnected) {
				try {
					scene.view?.dispose?.()
				} catch (error) {
					console.error(error)
				}
				scenes.delete(canvas)
			}
			continue
		}
		if (scene.failed || !scene.view) continue
		const value = (prop: Prop) => round(player.valueOf(scene.layer, prop))
		try {
			scene.view.draw({
				time,
				duration: player.doc.duration,
				playing: player.playing,
				width: layer.width,
				height: layer.height,
				x: value('x'),
				y: value('y'),
				scale: value('scale'),
				rotation: value('rotation'),
				opacity: value('opacity'),
			})
		} catch (error) {
			fail(canvas, scene, error)
		}
	}
})

/** Easing functions per track: a document snapshot is never mutated, so they stay valid. */
const easingCache = new WeakMap<Keyframe[], EasingFn[]>()

/** The value of a property at any time, straight from the document. */
function sampleOf(layer: Layer, prop: Prop, time: number): number {
	const track = layer.tracks[prop]
	let easings = easingCache.get(track)
	if (!easings) easingCache.set(track, (easings = track.slice(0, -1).map(keyframe => easingFunction(keyframe.ease))))
	return sampleTrack(track, easings, time, layer.values[prop])
}

/** The height of the tab over the stage: the composition is fitted below it. */
const TAB = 32

function fit(stage: HTMLElement) {
	compScale = clamp(
		Math.min((stage.clientWidth - 40) / COMP.width, (stage.clientHeight - 40 - TAB) / COMP.height),
		0.2,
		2,
	)
	if (comp) comp.style.transform = `scale(${compScale})`
}

/** Dragging a layer sets its position at the playhead. */
function grab(event: PointerEvent, index: number) {
	select(index)
	const startX = event.clientX
	const startY = event.clientY
	const x = player.valueOf(index, 'x')
	const y = player.valueOf(index, 'y')
	// Selecting works while it plays; moving does not.
	if (locked()) return

	drag(event, moved => {
		setDoc(draft => {
			setValue(draft, index, 'x', Math.round(x + (moved.clientX - startX) / compScale))
			setValue(draft, index, 'y', Math.round(y + (moved.clientY - startY) / compScale))
		})
		commit()
	})
}

function shapeStyle(layer: Layer, order: number) {
	const text = layer.shape === 'text'
	const scene = layer.shape === 'three'
	return {
		'z-index': order,
		color: text ? layer.color : undefined,
		'font-size': text ? layer.height + 'px' : undefined,
		width: text ? undefined : layer.width + 'px',
		height: text ? undefined : layer.height + 'px',
		background: text ? undefined : scene ? '#000' : layer.color,
		'border-radius': text || scene ? undefined : layer.shape === 'circle' ? '50%' : (layer.radius ?? RADIUS) + 'px',
	}
}

export function Stage() {
	/** Motion path of the selected layer, with a dot per position keyframe. */
	const path = createMemo(() => {
		if (!ui.showPath) return null
		const index = ui.layer
		const layer = plain().layers[index]
		if (!layer || (layer.tracks.x.length < 2 && layer.tracks.y.length < 2)) return null

		const times = [...layer.tracks.x, ...layer.tracks.y].map(keyframe => keyframe.t)
		const from = Math.min(...times)
		const to = Math.max(...times)
		const at = (time: number) => [sampleOf(layer, 'x', time), sampleOf(layer, 'y', time)]
		const points: string[] = []
		for (let i = 0; i <= 120; i++)
			points.push(
				at(from + ((to - from) * i) / 120)
					.map(round)
					.join(','),
			)
		return {points: points.join(' '), dots: [...new Set(times)].map(at)}
	})

	return (
		<main
			id="stage"
			// A press on the empty stage, outside every layer, selects nothing.
			onPointerDown={event => {
				if (!(event.target as Element).closest('.shape-layer')) select(-1)
			}}
			ref={element => {
				new ResizeObserver(() => fit(element)).observe(element)
			}}
		>
			<header class="tabs">
				<span class="tab">
					Composition{' '}
					<small>
						{COMP.width} × {COMP.height}
					</small>
				</span>
			</header>
			<div id="comp" ref={element => (comp = element)}>
				{/* The first layer is the top one, like in the layer list. */}
				<For each={doc.layers} keyed={false}>
					{(layer, index) => (
						<div
							class={['shape-layer', {selected: ui.layer === index}]}
							data-layer={index}
							style={shapeStyle(layer(), doc.layers.length - index)}
							ref={element => (shapes[index] = element)}
							onPointerDown={event => grab(event, index)}
						>
							{layer().shape === 'text' ? layer().text : ''}
							{/* A new canvas for every change of the scene's code: a WebGL context cannot be reused. */}
							<Show when={layer().shape === 'three' && layer().scene && JSON.stringify(layer().scene)} keyed>
								{code => <canvas class="scene3d" ref={element => mountScene(element, index, JSON.parse(code))} />}
							</Show>
						</div>
					)}
				</For>
				<Show when={path()}>
					{shown => (
						<svg id="path">
							<polyline points={shown().points} />
							<For each={shown().dots} keyed={false}>
								{dot => <rect x={dot()[0] - 2.5} y={dot()[1] - 2.5} width="5" height="5" />}
							</For>
						</svg>
					)}
				</Show>
			</div>
		</main>
	)
}
