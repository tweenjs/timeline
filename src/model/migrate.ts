import {Easing} from '@tweenjs/tween.js'
import {nodesToPath} from './curveTools'
import {
	buildDoc,
	commonScope,
	describeObject,
	identifiers,
	layerObjects,
	sceneCode,
	sceneFunctionNames,
	withImports,
	layerSpans,
	number,
	runModule,
	string,
	unsupported,
	type Clip,
	type Parsed,
	type Span,
} from './compiler'
import {LINEAR, type Doc, type Ease, type Layer, type Prop} from './types'

/**
 * Migrations: the timeline as es6-tween or Kute.js code, and back.
 *
 * Both libraries take an easing function, so a custom curve is written as
 * `OwnEasing('M0,100 C…')` from the `owneasing` package (SVG path data in a
 * 100 x 100 box) instead of the editor's own curve helper.
 */

export type Dialect = 'es6-tween' | 'kute'
export const DIALECTS: Record<Dialect, string> = {'es6-tween': 'es6-tween', kute: 'Kute.js'}

const ownEasingCode = (ease: Ease & {type: 'curve'}) => `OwnEasing(${string(nodesToPath(ease.nodes))})`
const comment = (layer: Layer) => '\t// ' + layer.name.replace(/\s+/g, ' ')

// ---------------------------------------------------------------------------
// es6-tween
// ---------------------------------------------------------------------------

/**
 * Timeline -> es6-tween code: one es6-tween `Timeline`. Each tween is added
 * at its time as a plain `{from, to, duration, easing}` object: `add()` makes
 * the Tween. Like tween.js, es6-tween starts a tween from wherever the
 * property is when its time comes.
 *
 * Three things in es6-tween 5.5.11 (`src/Timeline.js`) decide the shape of
 * this. Each was seen in es6-tween itself, and `test/model.test.mjs` plays the
 * export in it.
 * - `new Timeline()` starts at `now()`, and `add()` never places a tween before
 *   the start of its timeline, so every position would be late by the age of
 *   the page. `{startTime: 0}` makes positions count from zero.
 * - `add()` without a position continues from a length that counts each
 *   position twice, so every tween is added at an explicit time.
 * - A Timeline ends at that same length: the longest tween, or twice the last
 *   position, not where its last tween ends. When that is too early, an entry
 *   as long as the document, which animates nothing, keeps it open.
 * `Timeline.to()` is not used: it starts the timeline at once, which moves its
 * start to `now()` and makes whatever is added next late.
 */
export function exportEs6Tween(doc: Doc): string {
	const reserved = ['Timeline', 'Easing', 'autoPlay', 'OwnEasing', 'timeline', 'THREE', ...sceneFunctionNames(doc)]
	const names = identifiers(doc.layers, reserved)
	const scenes = sceneCode(doc, [...reserved, ...names])
	const tweens: string[] = []
	/** Where es6-tween ends the timeline, and where the animation ends. */
	let length = 0
	let end = 0

	doc.layers.forEach((layer, i) => {
		const spans = layerSpans(layer)
		if (spans.length) tweens.push(comment(layer))
		for (const span of spans) {
			const values = span.values.map(([prop, , to]) => prop + ': ' + number(to)).join(', ')
			let tween = `{from: ${names[i]}, to: {${values}}, duration: ${number(span.duration)}`
			if (span.ease?.type === 'curve') tween += `, easing: ${ownEasingCode(span.ease)}`
			else if (span.ease && span.ease.name !== LINEAR) tween += `, easing: Easing.${span.ease.name}`
			tweens.push(`\t.add(${tween}}, ${number(span.start)})`)
			length = Math.max(length, span.start * 2, span.duration)
			end = Math.max(end, span.start + span.duration)
		}
	})

	if (length < end) {
		tweens.push('\t// es6-tween would end this timeline before its last tween does. This keeps it open.')
		tweens.push(`\t.add({from: {}, to: {}, duration: ${number(end)}}, 0)`)
	}

	const lines = [
		`import {${tweens.some(line => line.includes('Easing.')) ? 'Easing, ' : ''}Timeline, autoPlay} from 'es6-tween'`,
	]
	if (tweens.some(line => line.includes('OwnEasing('))) lines.push("import OwnEasing from 'owneasing'")
	lines.push(...scenes.imports, '', ...scenes.lines, ...layerObjects(doc, names, scenes))
	lines.push('', `export const layers = [${names.join(', ')}]`, `export const duration = ${number(doc.duration)}`)
	lines.push('', 'autoPlay(true)', '')
	lines.push('// `startTime: 0`: the positions below count from the start of the timeline.')
	lines.push('export const timeline = new Timeline({startTime: 0})', ...tweens, '', 'timeline.start()')

	return lines.join('\n') + '\n'
}

/** es6-tween code -> timeline. */
export function importEs6Tween(code: string): Parsed {
	const clips: Clip[] = []
	const warnings = new Set<string>()
	const targets: unknown[] = []

	const ignore = (name: string) =>
		function (this: unknown) {
			warnings.add(name + '() listeners are not kept by the editor.')
			return this
		}

	class Es6Tween {
		target: unknown
		values: Record<string, unknown> = {}
		length = 1000
		wait = 0
		ease: unknown = Easing.Linear.None
		placed = false
		clip: Clip | null = null

		constructor(node: unknown, object?: unknown) {
			this.target = object ?? node
			if (!this.target || typeof this.target !== 'object') throw unsupported('Tweening an element or selector')
		}
		to(values: Record<string, unknown>, duration: unknown = 1000) {
			this.values = values
			if (typeof duration === 'number') this.length = duration
			else if (duration && typeof duration === 'object') {
				// Options are applied by method name, in the order they are written.
				for (const [name, value] of Object.entries(duration as Record<string, unknown>)) {
					const method = (this as unknown as Record<string, unknown>)[name]
					if (name === 'to' || name === 'start' || typeof method !== 'function') continue
					method.apply(this, Array.isArray(value) ? value : [value])
				}
			}
			return this
		}
		duration(amount: number) {
			this.length = amount
			return this
		}
		delay(amount: number) {
			this.wait = amount
			return this
		}
		easing(easing: unknown) {
			this.ease = easing
			if (this.clip) this.clip.easing = easing
			return this
		}
		place(offset: number) {
			if (this.placed) return
			this.placed = true
			// A tween of nothing only takes time: it is not a layer.
			if (!this.values || !Object.keys(this.values).length) return
			if (!targets.includes(this.target)) targets.push(this.target)
			this.clip = {target: this.target, values: this.values, start: offset, duration: this.length, easing: this.ease}
			clips.push(this.clip)
		}
		start(time?: unknown) {
			this.place((typeof time === 'number' ? time : 0) + this.wait)
			return this
		}
		repeat(times: number) {
			if (times) throw unsupported('Tween.repeat()')
			return this
		}
		yoyo(yoyo: boolean) {
			if (yoyo) throw unsupported('Tween.yoyo()')
			return this
		}
		reverse(): never {
			throw unsupported('Tween.reverse()')
		}
		interpolation(): never {
			throw unsupported('Tween.interpolation()')
		}
		chainedTweens(): never {
			throw unsupported('Tween.chainedTweens()')
		}
	}

	/** Timelines that es6-tween ends before their last tween: [its end, the end of the tween]. */
	const cutShort = new Map<object, [number, number]>()

	/** Follows `src/Timeline.js` of es6-tween 5.5.11, quirks included. */
	class Es6Timeline {
		/** What es6-tween calls the duration, and the `afterLast` label: where `add()` continues. */
		end = 0
		labels = new Map<string, number>()
		defaults: Record<string, unknown>
		tweens: Es6Tween[] = []
		/** Where the last tween ends. */
		last = 0
		/** `to()` starts the timeline, which moves its start to `now()`. */
		started = false

		constructor(params?: Record<string, unknown>) {
			this.defaults = params ?? {}
			if (this.defaults.startTime !== 0) {
				warnings.add(
					'A Timeline made without {startTime: 0} starts its tweens late, by the age of the page. It is read as if it started at 0.',
				)
			}
		}

		addLabel(name: string, offset: number) {
			this.labels.set(name, offset)
			return this
		}
		add(tween: Es6Tween | Es6Tween[], position?: number | string): this {
			if (Array.isArray(tween)) {
				for (const each of tween) this.add(each, position)
				return this
			}
			// A plain {from, to, duration, ...} object is made into a tween.
			if (!(tween instanceof Es6Tween)) {
				const options = tween as unknown as Record<string, unknown>
				if (!options || typeof options !== 'object') throw unsupported('Timeline.add() with ' + String(tween))
				tween = new Es6Tween(options.from).to(options.to as Record<string, unknown>, options)
			}
			if (this.started) {
				warnings.add(
					'Timeline.to() starts the timeline, so es6-tween plays what is added after it late, by the age of the page. It is read at the time it was given.',
				)
			}
			this.tweens.push(tween)

			// The parameters of the timeline are applied to each tween, by method name.
			for (const [method, value] of Object.entries(this.defaults)) {
				const apply = (tween as unknown as Record<string, unknown>)[method]
				if (typeof apply === 'function') apply.call(tween, value)
			}

			let offset = this.end
			if (typeof position === 'number') offset = position
			else if (typeof position === 'string' && position !== 'afterLast') {
				if (!this.labels.has(position)) throw unsupported(`The timeline position "${position}"`)
				offset = this.labels.get(position)!
			}
			// es6-tween takes the later of the tween's own delay and its position...
			const start = Math.max(offset, tween.wait)
			tween.place(start)
			// ...and counts the position twice in the length that the next add() continues from.
			this.end = Math.max(this.end, start + offset, tween.length)
			this.last = Math.max(this.last, start + tween.length)
			if (this.end < this.last) cutShort.set(this, [this.end, this.last])
			else cutShort.delete(this)
			return this
		}
		/**
		 * `to(objects, values, params)`: one tween per object, staggered. Objects
		 * come in an array: es6-tween adds nothing for a single plain object.
		 */
		to(nodes: unknown, to: unknown, params?: unknown): this {
			if (!Array.isArray(nodes)) {
				if (typeof nodes === 'string' || (nodes as {nodeType?: unknown})?.nodeType) {
					throw unsupported('Timeline.to() with an element or selector')
				}
				warnings.add('Timeline.to() with one plain object adds nothing in es6-tween. Pass an array: to([object], …).')
				this.started = true
				return this
			}
			const count = nodes.length
			const options = (index: number): Record<string, unknown> => ({
				...this.defaults,
				...((typeof params === 'function' ? params(index, count) : params) as object),
			})
			// Timing is read from the parameters as written, like es6-tween does.
			const shared = {...this.defaults, ...(typeof params === 'function' ? {} : (params as object))} as Record<
				string,
				unknown
			>
			const label = shared.label
			const offset =
				typeof label === 'number'
					? label
					: typeof label === 'string' && label !== 'afterLast'
						? (this.labels.get(label) ?? 0)
						: this.end
			const stagger = typeof shared.stagger === 'number' ? shared.stagger : 0
			const length = typeof shared.duration === 'number' ? shared.duration : 1000
			const mode = shared.mode
			if (mode === 'shuffle') throw unsupported('Timeline.to() with mode "shuffle", which is random,')
			const at = (index: number) =>
				mode === 'reverse'
					? stagger * (count - 1) - stagger * index + offset
					: mode === 'async'
						? offset
						: mode === 'sequence' || mode === 'delayed'
							? (stagger || length / (count - 1)) * index + offset
							: mode === 'oneByOne'
								? length
								: stagger * index + offset

			nodes.forEach((node, index) => {
				const values = typeof to === 'function' ? to(index, count) : to
				this.add(new Es6Tween(node).to({...(values as object)}, options(index)), at(index))
			})
			this.started = true
			return this
		}
		from(): never {
			throw unsupported('Timeline.from(), which only animates elements,')
		}
		fromTo(): never {
			throw unsupported('Timeline.fromTo(), which only animates elements,')
		}
		/** Sets the easing of the tweens added so far. */
		easing(easing: unknown) {
			for (const tween of this.tweens) tween.easing(easing)
			return this
		}
		repeat(times: number) {
			if (times) throw unsupported('Timeline.repeat()')
			return this
		}
		yoyo(yoyo: boolean) {
			if (yoyo) throw unsupported('Timeline.yoyo()')
			return this
		}
	}

	const chain = function (this: unknown) {
		return this
	}
	for (const name of ['stop', 'pause', 'play', 'restart', 'update', 'seek', 'easing', 'delay', 'start']) {
		if (!(name in Es6Tween.prototype)) (Es6Tween.prototype as any)[name] = chain
		if (!(name in Es6Timeline.prototype)) (Es6Timeline.prototype as any)[name] = chain
	}
	for (const name of ['on', 'once', 'off']) {
		;(Es6Tween.prototype as any)[name] = ignore('Tween.' + name)
		;(Es6Timeline.prototype as any)[name] = ignore('Timeline.' + name)
	}

	const steps = (count: number) => (amount: number) => Math.min(1, Math.floor(amount * count) / count)
	const noop = () => undefined
	const library = {
		Tween: Es6Tween,
		Timeline: Es6Timeline,
		Easing: {...Easing, Stepped: {steps}},
		autoPlay: noop,
		update: noop,
		onTick: noop,
		add: noop,
		remove: noop,
		removeAll: noop,
		now: () => 0,
	}
	const module = runModule(code, {...commonScope, ...library, TWEEN: library}, ['layers', 'duration'])

	for (const [end, last] of cutShort.values()) {
		warnings.add(
			`es6-tween ends this Timeline at ${end}ms, before its last tween ends at ${last}ms. It is read to the end. See the docs for how to keep it open.`,
		)
	}

	// Objects listed in `layers` come first, in that order. Without the list, each
	// tweened object is a layer.
	const layers = Array.isArray(module.layers) ? [...module.layers] : []
	for (const target of targets) if (!layers.includes(target)) layers.push(target)
	if (!layers.length) throw new Error('No tweens were started. Start each tween, or add it to a Timeline.')

	return withImports(
		buildDoc({targets: layers, describe: describeObject, clips, duration: module.duration, warnings}),
		code,
	)
}

// ---------------------------------------------------------------------------
// Kute.js
// ---------------------------------------------------------------------------

const TRANSFORM: Prop[] = ['x', 'y', 'rotation', 'scale']
const KUTE_NAME: Record<Prop, string> = {
	x: 'translateX',
	y: 'translateY',
	rotation: 'rotate',
	scale: 'scale',
	opacity: 'opacity',
}

/** Kute.js reads translate and rotate values as whole numbers. */
const kuteValue = (prop: Prop, value: number) =>
	prop === 'scale' || prop === 'opacity' ? number(value) : String(Math.round(value))

function kuteEasing(ease: Ease | null): string {
	if (!ease || (ease.type === 'preset' && ease.name === LINEAR)) return "'linear'"
	if (ease.type === 'curve') return ownEasingCode(ease)
	return string('easing' + ease.name.replace('.', ''))
}

/**
 * Splits the transform properties of a layer over elements. One Kute.js tween
 * writes an element's whole `transform`, so properties that move on their own
 * timing each need their own (nested) element. Neighbours that move together,
 * and properties that do not move at all, share one.
 */
function transformGroups(layer: Layer): Prop[][] {
	const timing = (prop: Prop) => JSON.stringify(layer.tracks[prop].map(keyframe => [keyframe.t, keyframe.ease]))
	const groups: Prop[][] = []
	let current: Prop[] = []
	let moving: string | null = null

	for (const prop of TRANSFORM) {
		const own = layer.tracks[prop].length ? timing(prop) : null
		if (own && moving && own !== moving) {
			groups.push(current)
			current = []
			moving = null
		}
		current.push(prop)
		moving ??= own
	}
	groups.push(current)
	return groups
}

/** Timeline -> Kute.js code. */
export function exportKute(doc: Doc): string {
	const names = identifiers(doc.layers, ['KUTE', 'OwnEasing'])
	const tweens: string[] = []
	const markup: string[] = []

	const tween = (selector: string, span: Span, held: Array<[Prop, number]>) => {
		const side = (index: 1 | 2) =>
			[...held.map(([prop, value]) => [prop, value] as const), ...span.values.map(v => [v[0], v[index]] as const)]
				.map(([prop, value]) => KUTE_NAME[prop] + ': ' + kuteValue(prop, value))
				.join(', ')
		const options = [`duration: ${number(span.duration)}`]
		if (span.start) options.push(`delay: ${number(span.start)}`)
		options.push(`easing: ${kuteEasing(span.ease)}`)
		tweens.push(`\tKUTE.fromTo(${string(selector)}, {${side(1)}}, {${side(2)}}, {${options.join(', ')}}),`)
	}

	doc.layers.forEach((layer, i) => {
		const id = names[i]
		const start = (prop: Prop) => (layer.tracks[prop].length ? layer.tracks[prop][0].v : layer.values[prop])
		const before = tweens.length
		let open = ''
		let close = ''

		transformGroups(layer).forEach((group, g) => {
			const selector = g === 0 ? id : id + '-' + group[0]
			const held = group
				.filter(prop => !layer.tracks[prop].length)
				.map(prop => [prop, layer.values[prop]] as [Prop, number])
			for (const span of layerSpans(layer, group)) tween('#' + selector, span, held)

			const transform = group
				.filter(prop => start(prop) !== (prop === 'scale' ? 1 : 0))
				.map(prop => {
					if (prop === 'x' || prop === 'y') return `translate${prop.toUpperCase()}(${Math.round(start(prop))}px)`
					return prop === 'rotation' ? `rotate(${Math.round(start(prop))}deg)` : `scale(${number(start(prop))})`
				})
			const styles = transform.length ? [`transform: ${transform.join(' ')}`] : []
			if (g === 0 && start('opacity') !== 1) styles.push(`opacity: ${number(start('opacity'))}`)
			open += `<div id="${selector}"${styles.length ? ` style="${styles.join('; ')}"` : ''}>`
			close += '</div>'
		})

		for (const span of layerSpans(layer, ['opacity'])) tween('#' + id, span, [])
		if (tweens.length > before) tweens.splice(before, 0, comment(layer))
		markup.push('//   ' + open + close)
	})

	const lines = ["import KUTE from 'kute.js'"]
	if (tweens.some(line => line.includes('OwnEasing('))) lines.push("import OwnEasing from 'owneasing'")
	lines.push(
		'',
		'// Kute.js animates elements, and one tween writes the whole transform of its',
		'// element. Properties that move on their own timing therefore sit on their own',
		'// nested element. This code expects:',
		'//',
		...markup,
		'',
		'export const tweens = [',
		...tweens,
		']',
		'',
		'for (const tween of tweens) tween.start()',
	)

	return lines.join('\n') + '\n'
}

/** Kute.js code -> timeline. Each animated element becomes a layer. */
export function importKute(code: string): Parsed {
	const clips: Clip[] = []
	const warnings = new Set<string>()
	const targets: string[] = []

	/** `#ball-y` is a nested element of the layer `#ball` (see `exportKute`). */
	const layerOf = (target: unknown) => {
		if (typeof target !== 'string') throw unsupported('A Kute.js target that is not a selector')
		const selector = target.trim().replace(/-(x|y|rotation|scale|opacity)$/, '')
		if (!targets.includes(selector)) targets.push(selector)
		return selector
	}

	const amount = (value: unknown) => (typeof value === 'string' ? parseFloat(value) : value)
	const values = (source: Record<string, unknown> | undefined) => {
		const result: Record<string, unknown> = {}
		for (const [name, value] of Object.entries(source ?? {})) {
			if (name === 'translateX') result.x = amount(value)
			else if (name === 'translateY') result.y = amount(value)
			else if (name === 'translate' || name === 'translate3d') {
				const [x, y = 0] = Array.isArray(value) ? value : [value]
				result.x = amount(x)
				result.y = amount(y)
			} else if (name === 'rotate' || name === 'rotateZ') result.rotation = amount(value)
			else if (name === 'scale' || name === 'opacity') result[name] = amount(value)
			else warnings.add(`Kute.js "${name}" has no matching layer property, so it was left out.`)
		}
		return result
	}

	const easing = (value: unknown): unknown => {
		if (value === undefined || value === 'linear') return Easing.Linear.None
		if (typeof value !== 'string') return value
		const [, family, direction] = /^easing([A-Z][a-z]+)(InOut|In|Out)$/.exec(value) ?? []
		const group = (Easing as unknown as Record<string, Record<string, unknown>>)[family]
		if (!group?.[direction]) throw unsupported(`The Kute.js easing "${value}"`)
		return group[direction]
	}

	class KuteTween {
		private chained: KuteTween[] = []
		private placed = false
		constructor(
			private target: string,
			private from: Record<string, unknown> | undefined,
			private to: Record<string, unknown>,
			private options: Record<string, unknown> = {},
		) {
			if (options.repeat) throw unsupported('The Kute.js `repeat` option')
			if (options.yoyo) throw unsupported('The Kute.js `yoyo` option')
		}
		place(offset: number) {
			if (this.placed) return
			this.placed = true
			const duration = typeof this.options.duration === 'number' ? this.options.duration : 700
			const start = offset + (typeof this.options.delay === 'number' ? this.options.delay : 0)
			clips.push({
				target: this.target,
				from: this.from,
				values: this.to,
				start,
				duration,
				easing: easing(this.options.easing),
			})
			for (const next of this.chained) next.place(start + duration)
		}
		start() {
			this.place(0)
			return this
		}
		chain(...tweens: Array<KuteTween | KuteTween[]>) {
			this.chained = tweens.flat()
			return this
		}
	}
	const chain = function (this: unknown) {
		return this
	}
	for (const name of ['stop', 'pause', 'resume', 'stopChainedTweens']) (KuteTween.prototype as any)[name] = chain

	const KUTE = {
		to: (target: unknown, to: Record<string, unknown>, options?: Record<string, unknown>) =>
			new KuteTween(layerOf(target), undefined, values(to), options),
		fromTo: (
			target: unknown,
			from: Record<string, unknown>,
			to: Record<string, unknown>,
			options?: Record<string, unknown>,
		) => new KuteTween(layerOf(target), values(from), values(to), options),
		allTo: (): never => {
			throw unsupported('KUTE.allTo()')
		},
		allFromTo: (): never => {
			throw unsupported('KUTE.allFromTo()')
		},
	}

	// Code usually looks elements up first: a selector stands in for its element.
	const document = {
		querySelector: (selector: string) => selector,
		getElementById: (id: string) => '#' + id,
		querySelectorAll: (selector: string) => [selector],
	}
	const module = runModule(code, {...commonScope, KUTE, document}, ['duration'])
	if (!clips.length) throw new Error('No tweens were started. Call start() on each Kute.js tween.')

	const describe = (target: unknown) => ({name: String(target).replace(/^[#.]/, '') || 'Layer'})
	return buildDoc({targets, describe, clips, duration: module.duration, warnings})
}

export const exporters: Record<Dialect, (doc: Doc) => string> = {'es6-tween': exportEs6Tween, kute: exportKute}
export const importers: Record<Dialect, (code: string) => Parsed> = {'es6-tween': importEs6Tween, kute: importKute}
