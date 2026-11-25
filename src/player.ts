import {Timeline, Tween} from '@tweenjs/tween.js'
import {easingFunction, segmentAt, type EasingFn} from './model/curveTools'
import {PROPS, type Doc, type Keyframe, type Prop} from './model/types'

/**
 * The playback engine. It is deliberately not reactive: it owns a plain
 * snapshot of the document compiled to a tween.js `Timeline`, a playhead, and
 * the `requestAnimationFrame` loop. Views subscribe and write to the DOM
 * themselves, so a frame costs a timeline update and a few style writes, never
 * a render.
 *
 * - `onFrame` listeners run on every frame, at the display's refresh rate.
 *   They should only write `transform` and `opacity`.
 * - `onSlow` listeners run at most 30 times a second while playing (and at
 *   once when paused): text and form fields nobody can read faster.
 */

export type FrameListener = (time: number) => void

const SLOW = 1000 / 30
/** A frame never advances more than this: a tab that was hidden resumes, it does not jump. */
const MAX_STEP = 250
const SNAP = 10

export class Player {
	doc: Doc = {duration: 0, layers: []}
	time = 0
	playing = false
	loop = true

	private timeline = new Timeline()
	/** Keyframe -> the tweened `{k}` progress of the segment that leaves it. */
	private progress = new Map<Keyframe, {k: number}>()
	/** Keyframe -> easing function of the segment that leaves it. */
	private easings = new Map<Keyframe, EasingFn>()

	private frameListeners = new Set<FrameListener>()
	private slowListeners = new Set<FrameListener>()
	private stateListeners = new Set<(playing: boolean) => void>()
	private request = 0
	private last = -1
	private lastSlow = 0

	onFrame(listener: FrameListener) {
		this.frameListeners.add(listener)
		return () => this.frameListeners.delete(listener)
	}

	onSlow(listener: FrameListener) {
		this.slowListeners.add(listener)
		return () => this.slowListeners.delete(listener)
	}

	onState(listener: (playing: boolean) => void) {
		this.stateListeners.add(listener)
		return () => this.stateListeners.delete(listener)
	}

	/**
	 * Compiles a document. One tween per pair of neighbouring keyframes: each
	 * drives a private 0 -> 1 progress with the segment's easing, and a value is
	 * read from the segment under the playhead. Unlike tweening the layer
	 * directly, this stays exact however the playhead is scrubbed: no tween
	 * depends on where another one left the property.
	 */
	setDoc(doc: Doc) {
		this.doc = doc
		this.timeline = new Timeline()
		this.progress = new Map()
		this.easings = new Map()

		for (const layer of doc.layers) {
			for (const prop of PROPS) {
				const track = layer.tracks[prop]
				for (let i = 0; i < track.length - 1; i++) {
					const state = {k: 0}
					const easing = easingFunction(track[i].ease)
					this.progress.set(track[i], state)
					this.easings.set(track[i], easing)
					this.timeline.add(new Tween(state).to({k: 1}, track[i + 1].t - track[i].t).easing(easing), track[i].t)
				}
			}
		}

		this.timeline.start(0)
		this.time = Math.min(Math.max(this.time, 0), doc.duration)
		this.apply()
		this.emit(true)
	}

	private apply() {
		// A timeline that reached its end has stopped: start it again to scrub.
		if (!this.timeline.isPlaying()) this.timeline.start(0)
		this.timeline.update(this.time)
	}

	/** Runs the listeners. `now` forces the slow ones too. */
	emit(now = false) {
		const time = this.time
		for (const listener of this.frameListeners) listener(time)

		const stamp = performance.now()
		if (now || !this.playing || stamp - this.lastSlow >= SLOW) {
			this.lastSlow = stamp
			for (const listener of this.slowListeners) listener(time)
		}
	}

	/** The value of a property at the playhead, as animated by the timeline. */
	valueOf(layerIndex: number, prop: Prop): number {
		const layer = this.doc.layers[layerIndex]
		const track = layer.tracks[prop]
		if (!track.length) return layer.values[prop]
		if (this.time <= track[0].t) return track[0].v
		const i = segmentAt(track, this.time)
		if (i === -1) return track[track.length - 1].v
		return track[i].v + (track[i + 1].v - track[i].v) * this.progress.get(track[i])!.k
	}

	/** The value of a property at any time, without moving the playhead. */
	sample(layerIndex: number, prop: Prop, time: number): number {
		const layer = this.doc.layers[layerIndex]
		const track = layer.tracks[prop]
		if (!track.length) return layer.values[prop]
		if (time <= track[0].t) return track[0].v
		const i = segmentAt(track, time)
		if (i === -1) return track[track.length - 1].v
		const from = track[i]
		const to = track[i + 1]
		return from.v + (to.v - from.v) * this.easings.get(from)!((time - from.t) / (to.t - from.t))
	}

	/** The easing function of the segment that leaves a keyframe. */
	easingOf(keyframe: Keyframe): EasingFn | undefined {
		return this.easings.get(keyframe)
	}

	/** Index of the keyframe of a track that sits on the playhead, or -1. */
	keyframeAt(track: readonly {t: number}[]): number {
		return track.findIndex(keyframe => Math.abs(keyframe.t - this.time) < 0.5)
	}

	seek(time: number) {
		this.time = Math.min(Math.max(time, 0), this.doc.duration)
		this.apply()
		this.emit(true)
	}

	play() {
		if (this.playing) return
		if (this.time >= this.doc.duration) this.time = 0
		this.playing = true
		this.last = -1
		this.apply()
		this.emit(true)
		this.request = requestAnimationFrame(this.tick)
		for (const listener of this.stateListeners) listener(true)
	}

	pause() {
		if (!this.playing) return
		this.playing = false
		cancelAnimationFrame(this.request)
		// Rest on the same grid the editor snaps to.
		this.time = Math.min(Math.max(Math.round(this.time / SNAP) * SNAP, 0), this.doc.duration)
		this.apply()
		this.emit(true)
		for (const listener of this.stateListeners) listener(false)
	}

	toggle() {
		if (this.playing) this.pause()
		else this.play()
	}

	/**
	 * One display frame. Time comes from the frame's own timestamp, so the
	 * animation advances by exactly the display's frame interval: 60, 120 or
	 * 144 times a second, whatever the screen does.
	 */
	private tick = (stamp: number) => {
		if (!this.playing) return
		const step = this.last < 0 ? 0 : Math.min(stamp - this.last, MAX_STEP)
		this.last = stamp
		this.time += step

		const duration = this.doc.duration
		if (this.time >= duration) {
			if (this.loop && duration > 0) this.time %= duration
			else {
				this.time = duration
				this.apply()
				this.pause()
				return
			}
		}

		this.apply()
		this.emit()
		this.request = requestAnimationFrame(this.tick)
	}
}
