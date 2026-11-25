import type {CurveNode} from './easingCurve.js'
import {CUBE, type SceneCode} from './scenes'

export type {CurveNode}

export const PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const
export type Prop = (typeof PROPS)[number]

/**
 * `three` is a 3D scene drawn with three.js by the layer's own code, its
 * `scene` (see scenes.ts). It is a layer like any other, but its `rotation`
 * and `scale` are not applied to the picture: they are given to the scene,
 * which uses them as it likes (the Black hole moves its camera with them).
 */
export const SHAPES = ['rect', 'circle', 'text', 'three'] as const
/** The shapes the "+" buttons of the timeline add. */
export const BASIC_SHAPES = ['rect', 'circle', 'text'] as const
export type Shape = (typeof SHAPES)[number]

export const PROP_DEFAULTS: Record<Prop, number> = {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1}
export const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#b197fc', '#ffa94d']
export const LINEAR = 'Linear.None'

export const ALIGNS = ['left', 'right'] as const
export type Align = (typeof ALIGNS)[number]

/** The corner radius of a rectangle that does not say its own. */
export const RADIUS = 6

/** The size of the stage, in the units of `x` and `y`. */
export const COMP = {width: 640, height: 360}

/**
 * How the motion from one keyframe to the next is shaped: a tween.js easing by
 * name (f.e. `Quadratic.InOut`), or a curve drawn with the curve tool.
 */
export type Ease = {type: 'preset'; name: string} | {type: 'curve'; nodes: CurveNode[]}

/** `ease` belongs to the keyframe a segment leaves. */
export type Keyframe = {t: number; v: number; ease: Ease}

export type Layer = {
	name: string
	shape: Shape
	color: string
	width: number
	height: number
	text: string
	/** How round the corners of a rectangle are. Without it: `RADIUS`. */
	radius?: number
	/** The code of a `three` layer. */
	scene?: SceneCode
	/** Which side of a text is at `x`. Without it: its middle. */
	align?: Align
	/** The value of every property while it has no keyframes. */
	values: Record<Prop, number>
	/** Keyframes per property, sorted by time. Two never share a time. */
	tracks: Record<Prop, Keyframe[]>
	/** Editor state: the layer's property rows are folded away. */
	closed?: boolean
}

/** The document the editor edits, saves, shares and compiles. */
export type Doc = {duration: number; layers: Layer[]}

export function presetEase(name = LINEAR): Ease {
	return {type: 'preset', name}
}

export function createLayer(
	index: number,
	options: Partial<Omit<Layer, 'tracks' | 'values'>> & {values?: Partial<Record<Prop, number>>} = {},
): Layer {
	const layer: Layer = {
		name: options.name ?? 'Layer ' + (index + 1),
		shape: SHAPES.includes(options.shape as Shape) ? (options.shape as Shape) : 'rect',
		color: options.color ?? COLORS[index % COLORS.length],
		width: options.width ?? 80,
		height: options.height ?? 80,
		text: options.text ?? 'Text',
		values: {...PROP_DEFAULTS, ...options.values},
		tracks: {x: [], y: [], scale: [], rotation: [], opacity: []},
	}
	if (typeof options.radius === 'number' && options.radius >= 0 && options.radius !== RADIUS && layer.shape === 'rect')
		layer.radius = options.radius
	if (ALIGNS.includes(options.align as Align) && layer.shape === 'text') layer.align = options.align
	// A three.js layer always has a scene: a cube, until it is given its own.
	if (layer.shape === 'three') {
		const scene = options.scene ?? CUBE
		layer.scene = {imports: [...scene.imports], source: scene.source}
	}
	return layer
}

export function key(t: number, v: number, ease: Ease = presetEase()): Keyframe {
	return {t, v, ease}
}

/** Every keyframe time of a document. */
export function keyframeTimes(doc: Doc): number[] {
	return doc.layers.flatMap(layer => PROPS.flatMap(prop => layer.tracks[prop].map(keyframe => keyframe.t)))
}
