import {Easing, Timeline, Tween} from '@tweenjs/tween.js'
import {cubicBezier, curveEasing} from './easingCurve.js'
import {easeOf, easingByName, nameByEasing, pathToNodes} from './curveTools'
import {BLACK_HOLE, CUBE, isThreeImport, sameScene, threeImports, type SceneCode} from './scenes'
import {
	LINEAR,
	PROPS,
	RADIUS,
	createLayer,
	keyframeTimes,
	presetEase,
	type Doc,
	type Ease,
	type Layer,
	type Prop,
} from './types'

/**
 * Timeline <-> code compiler.
 *
 * - `generateCode(doc)` writes the document as a tween.js module.
 * - `parseCode(code)` runs such a module against recording `Tween` and
 *   `Timeline` classes and rebuilds the document from what it observed, so the
 *   code may be written freely (loops, labels, nested timelines, ...).
 *
 * The pieces are shared with the Kute.js and es6-tween migrations in
 * `migrate.ts`: they only differ in what they print and what they record.
 */

export type Parsed = {doc: Doc; warnings: string[]}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

export function number(value: number): string {
	return String(+value.toFixed(3))
}

export function string(value: unknown): string {
	return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"
}

/** A unique JavaScript identifier per layer, derived from its name. */
export function identifiers(layers: Layer[], reserved: string[] = []): string[] {
	const taken = new Set(['layers', 'duration', 'timeline', 'tweens', 'tween', ...reserved])
	return layers.map(layer => {
		const words = layer.name.match(/[A-Za-z0-9]+/g) ?? []
		let base = words.map((word, i) => (i === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1))).join('')
		if (!/^[A-Za-z]/.test(base)) base = 'layer' + base
		try {
			new Function('const ' + base + ' = 0')
		} catch {
			base += 'Layer' // a reserved word
		}
		let name = base
		for (let n = 2; taken.has(name); n++) name = base + n
		taken.add(name)
		return name
	})
}

export type Span = {start: number; duration: number; ease: Ease | null; values: Array<[Prop, number, number]>}

/**
 * The tweens of one layer: one per pair of neighbouring keyframes, as
 * `[prop, from, to]` values. Properties that move over the same time span with
 * the same easing share a span. A lone keyframe has no motion, but a
 * zero-length span keeps it in the code so it survives the round trip.
 */
export function layerSpans(layer: Layer, props: readonly Prop[] = PROPS): Span[] {
	const spans = new Map<string, Span>()

	for (const prop of props) {
		const track = layer.tracks[prop]
		const pairs = track.length === 1 ? [[track[0], track[0]]] : track.slice(1).map((to, i) => [track[i], to])

		for (const [from, to] of pairs) {
			const ease = from === to ? null : from.ease
			const id = from.t + '|' + to.t + '|' + JSON.stringify(ease)
			if (!spans.has(id)) spans.set(id, {start: from.t, duration: to.t - from.t, ease, values: []})
			spans.get(id)!.values.push([prop, from.v, to.v])
		}
	}

	return [...spans.values()].sort((a, b) => a.start - b.start)
}

/**
 * The code of the three.js scenes of a document: what they import, the
 * functions themselves, and the name of each layer's function. A function
 * that has a name is written as it is; others are given one.
 */
export type Scenes = {imports: string[]; lines: string[]; names: Map<number, string>}

const FUNCTION_NAME = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/

/** The names scene functions are declared with: layers must not take them. */
export function sceneFunctionNames(doc: Doc): string[] {
	return doc.layers.flatMap(layer => layer.scene?.source.match(FUNCTION_NAME)?.[1] ?? [])
}

export function sceneCode(doc: Doc, taken: string[]): Scenes {
	const scenes: Scenes = {imports: [], lines: [], names: new Map()}
	const used = new Set(taken)
	const declared = new Map<string, string>()
	doc.layers.forEach((layer, i) => {
		const scene = layer.scene
		if (layer.shape !== 'three' || !scene) return
		for (const statement of scene.imports) if (!scenes.imports.includes(statement)) scenes.imports.push(statement)

		// Layers with the same scene share one function.
		let name = declared.get(scene.source)
		if (!name) {
			const own = scene.source.match(FUNCTION_NAME)?.[1]
			if (own && ![...declared.values()].includes(own)) {
				name = own
				scenes.lines.push(scene.source, '')
			} else {
				for (let n = 1; !name || used.has(name); n++) name = 'scene' + n
				scenes.lines.push(`const ${name} = ${scene.source}`, '')
			}
			used.add(name)
			declared.set(scene.source, name)
		}
		scenes.names.set(i, name)
	})
	return scenes
}

/** The plain objects the layers are in code: their look, then their starting values. */
export function layerObjects(doc: Doc, names: string[], scenes?: Scenes): string[] {
	const lines: string[] = []
	doc.layers.forEach((layer, i) => {
		// A keyframed property starts from its first keyframe.
		const values = PROPS.map(prop => {
			const track = layer.tracks[prop]
			return prop + ': ' + number(track.length ? track[0].v : layer.values[prop])
		})
		const look = [`name: ${string(layer.name)}`, `shape: ${string(layer.shape)}`, `color: ${string(layer.color)}`]
		look.push(`width: ${number(layer.width)}`, `height: ${number(layer.height)}`)
		if (layer.shape === 'rect' && layer.radius !== undefined && layer.radius !== RADIUS)
			look.push(`radius: ${number(layer.radius)}`)
		if (layer.shape === 'text') look.push(`text: ${string(layer.text)}`)
		if (layer.shape === 'text' && layer.align) look.push(`align: ${string(layer.align)}`)

		const scene = scenes?.names.get(i)
		lines.push(`const ${names[i]} = {`, `\t${look.join(', ')},`, `\t${values.join(', ')},`)
		if (scene) lines.push(`\tscene: ${scene},`)
		lines.push('}')
	})
	return lines
}

function easeCode(ease: Ease | null): string {
	if (!ease) return ''
	if (ease.type === 'preset') return ease.name === LINEAR ? '' : `.easing(Easing.${ease.name})`
	const nodes = ease.nodes
	if (nodes.length === 2 && !nodes[0].ix && !nodes[0].iy && !nodes[1].ox && !nodes[1].oy) {
		const [a, b] = nodes
		return `.easing(cubicBezier(${[a.ox, a.oy, 1 + b.ix, 1 + b.iy].map(number).join(', ')}))`
	}
	const rows = nodes.map(n => '[' + [n.x, n.y, n.ix, n.iy, n.ox, n.oy].map(number).join(', ') + ']')
	return `.easing(curveEasing([${rows.join(', ')}]))`
}

/** Timeline -> tween.js code. */
export function generateCode(doc: Doc): string {
	const reserved = ['Tween', 'Timeline', 'Easing', 'cubicBezier', 'curveEasing', 'THREE', ...sceneFunctionNames(doc)]
	const names = identifiers(doc.layers, reserved)
	const scenes = sceneCode(doc, [...reserved, ...names])
	const tweens: string[] = []

	doc.layers.forEach((layer, i) => {
		const spans = layerSpans(layer)
		if (spans.length) tweens.push('\t// ' + layer.name.replace(/\s+/g, ' '))
		for (const span of spans) {
			const values = span.values.map(([prop, , to]) => prop + ': ' + number(to)).join(', ')
			const tween = `new Tween(${names[i]}).to({${values}}, ${number(span.duration)})${easeCode(span.ease)}`
			tweens.push(`\t.add(${tween}, ${number(span.start)})`)
		}
	})

	const helpers = ['cubicBezier', 'curveEasing'].filter(name => tweens.some(line => line.includes(name + '(')))
	// Every name comes from the package, whatever the editor does with it itself.
	const lines = [`import {${['Easing', ...helpers, 'Timeline', 'Tween'].join(', ')}} from '@tweenjs/tween.js'`]
	lines.push(...scenes.imports, '', ...scenes.lines, ...layerObjects(doc, names, scenes))
	lines.push('', `export const layers = [${names.join(', ')}]`, `export const duration = ${number(doc.duration)}`, '')
	lines.push('export const timeline = new Timeline()', ...tweens)

	return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Running code
// ---------------------------------------------------------------------------

export function unsupported(what: string): Error {
	return new Error(what + ' is not supported by the timeline editor.')
}

/** `OwnEasing(d)` from the `owneasing` package: an easing drawn as SVG path data. */
export function ownEasing(d: string, _accuracy?: number, width = 100, height = 100) {
	return curveEasing(pathToNodes(d, width, height))
}

/** What every dialect can use without importing it. */
export const commonScope = {
	Easing,
	cubicBezier,
	curveEasing,
	OwnEasing: ownEasing,
	requestAnimationFrame: () => 0,
}

/**
 * Runs a module as a function body: imports are stripped (the names come from
 * `scope` instead) and exports are read back as plain variables.
 */
function moduleBody(code: string): string {
	return code
		.replace(/^[ \t]*import\s[^;'"]*?['"][^'"]*['"][ \t]*;?/gm, '')
		.replace(/^[ \t]*import\s*['"][^'"]*['"][ \t]*;?/gm, '')
		.replace(/\bexport\s+default\s+/g, 'exported.timeline = ')
		.replace(/\bexport\s+(?=const|let|var|function|class)/g, '')
}

/** Whether code is well-formed JavaScript, without running any of it. Returns the problem, or nothing. */
export function syntaxProblem(code: string): string | undefined {
	try {
		new Function(`'use strict'\nconst exported = {}\n${moduleBody(code)}`)
	} catch (error) {
		return (error as Error).message
	}
}

export function runModule(code: string, scope: Record<string, unknown>, exports: string[]): Record<string, unknown> {
	const body = moduleBody(code)
	const read = (name: string) => `${name}: typeof ${name} === 'undefined' ? exported.${name} : ${name}`
	const run = new Function(
		...Object.keys(scope),
		`'use strict'\nconst exported = {}\n${body}\nreturn {${exports.map(read).join(', ')}}`,
	)
	return run(...Object.values(scope))
}

// ---------------------------------------------------------------------------
// Recorded tweens -> document
// ---------------------------------------------------------------------------

/** One tween as a dialect recorded it. `start` is in absolute milliseconds. */
export type Clip = {
	target: unknown
	values: Record<string, unknown>
	/** Explicit starting values (Kute.js `fromTo`). Without it, a tween starts from wherever the property is. */
	from?: Record<string, unknown>
	start: number
	duration: number
	easing: unknown
}

export type Recording = {
	/** The layer of each target, in layer order. */
	targets: unknown[]
	describe: (target: unknown, index: number) => Parameters<typeof createLayer>[1]
	clips: Clip[]
	duration?: unknown
	warnings: Set<string>
}

const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value)

export function buildDoc({targets, describe, clips, duration, warnings}: Recording): Parsed {
	const time = (value: number) => Math.max(0, Math.round(value))
	const layers = targets.map((target, i) => createLayer(i, describe(target, i)))
	const traced = () => warnings.add('A custom easing function was traced into an editable curve.')

	// Like the real thing, a tween starts from wherever the property is when
	// the playhead reaches it: the previous keyframe, or the layer's value.
	const ordered = [...clips].sort((a, b) => a.start - b.start)

	for (const clip of ordered) {
		const index = targets.indexOf(clip.target)
		if (index === -1) {
			const props = Object.keys(clip.values).join(', ')
			throw new Error(
				`The tween of ${props || 'nothing'} at ${time(clip.start)}ms (${time(clip.duration)}ms long) animates an object that is not in \`layers\`.`,
			)
		}
		const layer = layers[index]
		const start = time(clip.start)
		const end = time(clip.start + clip.duration)
		const ease = easeOf(clip.easing, traced)

		for (const [name, value] of Object.entries(clip.values)) {
			const where = `${layer.name} ${name} at ${start}ms`
			if (!PROPS.includes(name as Prop)) {
				warnings.add(`"${name}" is not an animatable property (${PROPS.join(', ')}).`)
				continue
			}
			const prop = name as Prop
			if (!finite(value)) throw new Error(`${where}: only numeric values are supported.`)

			const track = layer.tracks[prop]
			const last = track[track.length - 1]
			if (last && start < last.t) throw new Error(`${where}: tweens of one property may not overlap.`)

			const from = clip.from?.[name]
			if (from !== undefined && !finite(from)) throw new Error(`${where}: only numeric values are supported.`)

			// A tween that goes nowhere on a property without keyframes is a static value.
			if (!last && from === value) {
				layer.values[prop] = value
				continue
			}

			if (last && last.t === start) {
				last.ease = ease
				if (from !== undefined) last.v = from
			} else track.push({t: start, v: from ?? (last ? last.v : layer.values[prop]), ease})

			if (end === start) track[track.length - 1].v = value
			else track.push({t: end, v: value, ease: presetEase()})
		}
	}

	for (const layer of layers) {
		for (const prop of PROPS) {
			const track = layer.tracks[prop]
			for (const keyframe of track) keyframe.ease = structuredClone(keyframe.ease)
			if (track.length) layer.values[prop] = track[0].v
		}
	}

	const doc = {duration: 0, layers}
	const length = finite(duration) && duration > 0 ? Math.round(duration) : 1000
	doc.duration = Math.max(length, ...keyframeTimes(doc))

	return {doc, warnings: [...warnings]}
}

/** Layer options read from a plain layer object in code. */
export function describeObject(object: unknown): Parameters<typeof createLayer>[1] {
	if (!object || typeof object !== 'object') throw new Error('`layers` must contain objects.')
	const source = object as Record<string, unknown>
	const values: Partial<Record<Prop, number>> = {}
	for (const prop of PROPS) if (finite(source[prop])) values[prop] = source[prop] as number
	return {
		name: typeof source.name === 'string' ? source.name : undefined,
		shape: source.shape as Layer['shape'],
		color: typeof source.color === 'string' ? source.color : undefined,
		width: finite(source.width) ? source.width : undefined,
		height: finite(source.height) ? source.height : undefined,
		radius: finite(source.radius) && source.radius >= 0 ? source.radius : undefined,
		text: typeof source.text === 'string' ? source.text : undefined,
		align: source.align as Layer['align'],
		scene: describeScene(source),
		values,
	}
}

/** The scene of a layer object in code: the source of its `scene` function. The imports are added by `withImports()`. */
function describeScene(source: Record<string, unknown>): SceneCode | undefined {
	if (source.shape !== 'three') return undefined
	const name = typeof source.name === 'string' ? source.name : 'A layer'
	if (typeof source.scene !== 'function') {
		throw new Error(
			`${name} has the shape 'three', so it needs \`scene\`: a function that gets a canvas and draws on it.`,
		)
	}
	const text = Function.prototype.toString.call(source.scene)
	try {
		// A method (`scene(canvas) {}`) cannot stand on its own, as it has to in the document.
		new Function(`return (${text}\n)`)
	} catch {
		throw new Error(`Write the \`scene\` of ${name} as a function or an arrow function, not as a method.`)
	}
	return {imports: [], source: text}
}

/** Gives the three.js layers of a document read from `code` the imports that code has. */
export function withImports(parsed: Parsed, code: string): Parsed {
	const imports = threeImports(code)
	for (const layer of parsed.doc.layers) if (layer.scene) layer.scene.imports = [...imports]
	return parsed
}

// ---------------------------------------------------------------------------
// tween.js code -> timeline
// ---------------------------------------------------------------------------

/**
 * Runs the module with stand-ins for `Tween` and `Timeline` and collects every
 * tween it placed.
 *
 * Positions are resolved by the real `Timeline`: the stand-ins only listen. A
 * timeline starts each child exactly once, at the child's offset, when the
 * playhead reaches it, so one update at the very end reports every offset.
 */
function record(code: string): Recording {
	const clips: Clip[] = []
	const warnings = new Set<string>()
	const offsets: number[] = []
	const ignore = (name: string) =>
		function (this: unknown) {
			warnings.add(name + '() callbacks are not kept by the editor.')
			return this
		}

	class RecordingTween extends Tween<any> {
		clip: Omit<Clip, 'start'> & {delay: number}
		constructor(object: unknown) {
			super(object as Record<string, unknown>)
			this.clip = {target: object, values: {}, duration: 1000, delay: 0, easing: Easing.Linear.None}
		}
		override to(values: Record<string, unknown>, duration = 1000) {
			this.clip.values = values
			this.clip.duration = duration
			return super.to(values, duration)
		}
		override duration(duration = 1000) {
			this.clip.duration = duration
			return super.duration(duration)
		}
		override delay(amount = 0) {
			this.clip.delay = amount
			return super.delay(amount)
		}
		override easing(easing: (amount: number) => number = Easing.Linear.None) {
			this.clip.easing = easing
			return this
		}
		override start(time = 0) {
			const {delay, ...clip} = this.clip
			clips.push({...clip, start: offsets.reduce((sum, offset) => sum + offset, time) + delay})
			return this
		}
		override isPlaying() {
			return false
		}
		override update() {
			return false
		}
		override stop() {
			return this
		}
		// Repeats, yoyos and a tween added twice all go through clone().
		override clone(): never {
			throw unsupported('Repeating a tween (repeat, yoyo, or adding it twice)')
		}
		override repeat(): never {
			throw unsupported('Tween.repeat()')
		}
		override yoyo(): never {
			throw unsupported('Tween.yoyo()')
		}
		override chain(): never {
			throw unsupported('Tween.chain()')
		}
		override interpolation(): never {
			throw unsupported('Tween.interpolation()')
		}
	}

	class RecordingTimeline extends Timeline {
		offset = 0
		override start(time = 0) {
			this.offset = time
			return super.start(time)
		}
		override update(time?: number) {
			offsets.push(this.offset)
			try {
				return super.update(time)
			} finally {
				offsets.pop()
			}
		}
		override clone(): never {
			throw unsupported('Repeating a nested timeline')
		}
	}

	for (const name of ['onStart', 'onEveryStart', 'onUpdate', 'onRepeat', 'onComplete', 'onStop']) {
		;(RecordingTween.prototype as any)[name] = ignore('Tween.' + name)
		if (name in Timeline.prototype) (RecordingTimeline.prototype as any)[name] = ignore('Timeline.' + name)
	}

	const scope = {...commonScope, Tween: RecordingTween, Timeline: RecordingTimeline}
	const module = runModule(code, scope, ['layers', 'duration', 'timeline'])

	if (!Array.isArray(module.layers)) throw new Error('The code must define `layers`: an array of layer objects.')
	const timeline = module.timeline
	if (!(timeline instanceof RecordingTimeline)) throw new Error('The code must define `timeline`: a `new Timeline()`.')
	if (!isFinite(timeline.getDuration())) throw unsupported('A timeline that never ends')

	timeline.start(0)
	timeline.update(timeline.getDuration())

	return {targets: module.layers, describe: describeObject, clips, duration: module.duration, warnings}
}

/**
 * Compiles a tween.js module back into a document. Throws an `Error` when the
 * code does not run or uses something the editor cannot show.
 */
export function parseCode(code: string): Parsed {
	let recording: Recording
	try {
		recording = record(code)
	} catch (error) {
		// three.js is not there while the timeline is read: only when a scene is drawn.
		const name = error instanceof ReferenceError && error.message.match(/^(\S+) is not defined/)?.[1]
		if (
			name &&
			threeImports(code).some(statement => new RegExp(`[\\s{,]${name.replace(/\$/g, '\\$')}[\\s},]`).test(statement))
		) {
			throw new Error(
				`${name} is used outside of a scene function. Use three.js inside the function given as \`scene\`.`,
			)
		}
		throw error
	}
	return withImports(buildDoc(recording), code)
}

// ---------------------------------------------------------------------------
// Untrusted documents
// ---------------------------------------------------------------------------

/**
 * Rebuilds a document from untrusted JSON (a shared link, saved storage): only
 * known fields of the expected type are kept, everything else gets a default.
 * Throws when the value is not a document at all.
 */
/**
 * `trusted` is whether the document comes from this editor (its own storage).
 * One that does not may only have the scenes that are built in: any other
 * scene is code, and code is never run without asking.
 */
export function normalizeDoc(raw: any, trusted = true): Doc {
	if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers)) throw new Error('This is not a timeline.')

	const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : undefined)
	const size = (value: unknown) => (finite(value) && value > 0 ? Math.min(value, 10000) : undefined)

	const toEase = (ease: any): Ease => {
		if (ease?.type === 'curve' && Array.isArray(ease.nodes) && ease.nodes.length >= 2 && ease.nodes.length <= 64) {
			const rows = ease.nodes.map((node: any) => ['x', 'y', 'ix', 'iy', 'ox', 'oy'].map(name => node?.[name]))
			// curveEasing() applies the curve invariants to the nodes it is given.
			if (rows.flat().every(finite)) return {type: 'curve', nodes: curveEasing(rows, 1).nodes}
		}
		const easing = easingByName.get(ease?.name)
		return presetEase(easing ? nameByEasing.get(easing) : LINEAR)
	}

	const scene = (source: any): SceneCode | undefined => {
		// Before scenes were code, the black hole was a shape of its own.
		if (source.shape === 'blackhole') return BLACK_HOLE
		if (source.shape !== 'three') return undefined
		const given = source.scene
		const valid =
			typeof given?.source === 'string' &&
			given.source.length <= 500_000 &&
			Array.isArray(given.imports) &&
			given.imports.length <= 40 &&
			given.imports.every(isThreeImport)
		if (!valid) return CUBE
		const found: SceneCode = {imports: [...given.imports], source: given.source}
		if (!trusted && !sameScene(found, BLACK_HOLE) && !sameScene(found, CUBE)) {
			throw new Error(
				'This timeline has a three.js scene of its own. Scenes are code: share it as a link from File › Share.',
			)
		}
		return found
	}

	const layers = raw.layers.slice(0, 400).map((source: any, i: number) => {
		source = source && typeof source === 'object' ? source : {}
		const values: Partial<Record<Prop, number>> = {}
		for (const prop of PROPS) if (finite(source.values?.[prop])) values[prop] = source.values[prop]

		const layer = createLayer(i, {
			name: text(source.name),
			shape: source.shape === 'blackhole' ? 'three' : source.shape,
			color: /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(source.color) ? source.color : undefined,
			width: size(source.width),
			height: size(source.height),
			radius: finite(source.radius) && source.radius >= 0 ? Math.min(source.radius, 10000) : undefined,
			text: text(source.text),
			align: source.align,
			scene: scene(source),
			values,
		})
		if (source.closed === true) layer.closed = true

		for (const prop of PROPS) {
			const track: any[] = Array.isArray(source.tracks?.[prop]) ? source.tracks[prop].slice(0, 2000) : []
			const keyframes = track
				.filter(keyframe => finite(keyframe?.t) && finite(keyframe.v))
				.map(keyframe => ({t: Math.max(0, Math.round(keyframe.t)), v: keyframe.v, ease: toEase(keyframe.ease)}))
				.sort((a, b) => a.t - b.t)
			// Two keyframes of a property cannot share a time.
			layer.tracks[prop] = keyframes.filter((keyframe, k) => k === 0 || keyframe.t !== keyframes[k - 1].t)
		}
		return layer
	})

	const doc: Doc = {duration: finite(raw.duration) ? Math.round(raw.duration) : 1000, layers}
	doc.duration = Math.max(100, doc.duration, ...keyframeTimes(doc))
	return doc
}
