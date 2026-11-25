import {VERSION} from '@tweenjs/tween.js'
import {embedded, embedQuery} from './embed'
import {createSignal, createStore, flush, snapshot} from 'solid-js'
import type {JSX} from '@solidjs/web'
import {generateCode, normalizeDoc, parseCode, syntaxProblem, type Parsed} from './model/compiler'
import {DIALECTS, exporters, importers, type Dialect} from './model/migrate'
import {decodeCode, decodeDoc, shareUrl} from './model/share'
import {demo, templates} from './model/templates'
import {
	COMP,
	PROPS,
	createLayer,
	keyframeTimes,
	presetEase,
	type CurveNode,
	type Doc,
	type Keyframe,
	type Prop,
	type Shape,
} from './model/types'
import {Player} from './player'
import {saveTheme, storedTheme, type Theme} from './theme'

/**
 * Editor state and every action on it.
 *
 * - `doc` is a Solid store: the views read it property by property, so an
 *   edit redraws only what it touched.
 * - `current` is the same document as a plain snapshot, taken after each
 *   edit. The player, the compiler, undo and storage work on it.
 * - `player` owns the playhead. Nothing that changes on every frame is
 *   reactive state (see player.ts).
 */

export const STORAGE_KEY = 'tweenjs-timeline-editor-v1'
export const SNAP = 10 // ms
export const STEPS: Record<Prop, number> = {x: 1, y: 1, scale: 0.05, rotation: 1, opacity: 0.05}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const snap = (time: number) => Math.round(time / SNAP) * SNAP
export const round = (value: number) => +value.toFixed(3)

function load(): Doc | null {
	// An embedded editor starts from the demo, not from the user's saved timeline.
	if (embedded) return null
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		return raw ? normalizeDoc(JSON.parse(raw)) : null
	} catch {
		return null
	}
}

/** The document as a plain object. Replaced, never mutated. */
let current: Doc = load() ?? demo()

export const [doc, setDoc] = createStore<Doc>(structuredClone(current))
/** `current` as a signal, for views that draw from the whole document (curves, motion paths). */
export const [plain, setPlain] = createSignal<Doc>(current, {equals: false})
export const getDoc = () => current

export type Status = {kind: '' | 'warn' | 'error'; text: string}

export const [ui, setUi] = createStore({
	/**
	 * Selection. No layer (-1) to begin with, so the stage shows only the animation.
	 * `prop` and `key` are unset (null / -1) when only a layer is selected.
	 */
	layer: -1,
	prop: null as Prop | null,
	key: -1,
	/** Pixels per millisecond in the timeline panel. */
	zoom: 0.2,
	playing: false,
	loop: true,
	showCode: true,
	/** Whether the stage draws the path the selected layer travels. */
	showPath: true,
	/** 'system' follows the operating system. */
	theme: storedTheme(),
	canUndo: false,
	canRedo: false,
	status: {kind: '', text: 'In sync'} as Status,
	toast: '',
	toastShown: false,
})

export const player = new Player()
player.onState(playing => {
	setUi(state => {
		state.playing = playing
	})
})

/** Applies pending state to the DOM, then lets the frame listeners draw on it. */
export function sync() {
	flush()
	player.emit(true)
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const undoStack: string[] = []
const redoStack: string[] = []
let dragging = false
let unsaved = false

function remember(before = JSON.stringify(current)) {
	undoStack.push(before)
	if (undoStack.length > 200) undoStack.shift()
	redoStack.length = 0
}

function save() {
	unsaved = false
	if (embedded) return
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
	} catch {
		// Storage can be unavailable (private mode). The editor still works.
	}
}

/** Call after the store changed: takes the snapshot, recompiles, saves and redraws. */
export function commit({fromCode = false} = {}) {
	flush()
	const next = snapshot(doc) as Doc
	current = next

	const layer = next.layers[ui.layer]
	setUi(state => {
		if (!layer) {
			// Nothing selected (-1) stays that way; a selected layer that is gone moves to the last one.
			if (state.layer !== -1) state.layer = Math.max(0, next.layers.length - 1)
			state.prop = null
			state.key = -1
		} else if (state.prop && !layer.tracks[state.prop][state.key]) state.key = -1
		state.canUndo = undoStack.length > 0
		state.canRedo = redoStack.length > 0
	})
	setPlain(next)
	flush()

	player.setDoc(next)

	// Writing code and storage on every pointer move would cost frames: a drag
	// writes them once, when it ends.
	if (!fromCode) {
		if (dragging) codeStale = true
		else writeCode()
	}
	if (dragging) unsaved = true
	else save()
}

/**
 * While the timeline plays nothing is moved or changed: look, scrub and pause,
 * then edit. Says so, and returns whether the edit is refused.
 */
export function locked(): boolean {
	if (!player.playing) return false
	toast('Pause to edit: nothing can be moved or changed while it plays.')
	return true
}

/** Applies an undoable change to the document. */
export function change(mutate: (draft: Doc) => unknown) {
	if (locked()) return
	remember()
	// A store setter that returns a value replaces the store with it: never pass that on.
	setDoc(draft => {
		mutate(draft)
	})
	commit()
}

/** Gives a keyframe (of a store draft) a curve easing, writing no more than what changed. */
export function setCurve(keyframe: Keyframe, nodes: CurveNode[]) {
	const ease = keyframe.ease
	if (ease.type !== 'curve') keyframe.ease = {type: 'curve', nodes}
	else if (ease.nodes.length !== nodes.length) ease.nodes = nodes
	// Same points, moved: write the numbers, so only what reads them redraws.
	else nodes.forEach((node, i) => Object.assign(ease.nodes[i], node))
}

/** Like `change()`, for an edit that writes to the store itself. */
export function record(edit: () => void) {
	if (locked()) return
	remember()
	edit()
	commit()
}

function setDocument(next: Doc) {
	setDoc(draft => {
		draft.duration = next.duration
		draft.layers = next.layers
	})
}

function restore(from: string[], to: string[]) {
	const json = from.pop()
	if (!json) return
	to.push(JSON.stringify(current))
	setDocument(JSON.parse(json))
	commit()
}

export const undo = () => restore(undoStack, redoStack)
export const redo = () => restore(redoStack, undoStack)

/** Replaces the timeline with one that came from outside the editor, as one undo step. */
export function replaceDoc(next: Doc) {
	remember()
	setDocument(next)
	setUi(state => {
		state.layer = -1
		state.prop = null
		state.key = -1
	})
	commit()
	player.seek(0)
}

export function select(layer: number, prop: Prop | null = null, key = -1) {
	if (layer === ui.layer && prop === ui.prop && key === ui.key) return
	setUi(state => {
		state.layer = layer
		state.prop = prop
		state.key = key
	})
	sync()
}

function insertKeyframe(track: Keyframe[], time: number, value: number): number {
	track.push({t: time, v: value, ease: presetEase()})
	track.sort((a, b) => a.t - b.t)
	return track.findIndex(keyframe => keyframe.t === time)
}

/**
 * Sets a property at the playhead. An animated property gets (or updates) a
 * keyframe there; a static one just changes its value. Returns the keyframe's
 * index, or -1.
 */
export function setValue(draft: Doc, layerIndex: number, prop: Prop, value: number): number {
	const layer = draft.layers[layerIndex]
	const track = layer.tracks[prop]
	if (!track.length) {
		layer.values[prop] = value
		return -1
	}
	const index = player.keyframeAt(track)
	if (index === -1) return insertKeyframe(track, Math.round(player.time), value)
	track[index].v = value
	return index
}

export function editValue(layerIndex: number, prop: Prop, value: number) {
	let key = -1
	change(draft => {
		key = setValue(draft, layerIndex, prop, value)
	})
	select(layerIndex, prop, key)
}

export function toggleKeyframe(layerIndex: number, prop: Prop) {
	const value = player.valueOf(layerIndex, prop)
	let key = -1
	change(draft => {
		const layer = draft.layers[layerIndex]
		const track = layer.tracks[prop]
		const index = player.keyframeAt(track)
		if (index === -1) key = insertKeyframe(track, Math.round(player.time), value)
		else {
			track.splice(index, 1)
			if (!track.length) layer.values[prop] = value
		}
	})
	select(layerIndex, prop, key)
}

export function addKeyframe(layerIndex: number, prop: Prop, time: number) {
	if (current.layers[layerIndex].tracks[prop].some(keyframe => keyframe.t === time)) return
	const value = player.sample(layerIndex, prop, time)
	let key = -1
	change(draft => {
		key = insertKeyframe(draft.layers[layerIndex].tracks[prop], time, value)
	})
	select(layerIndex, prop, key)
}

export function selectedKeyframe(): Keyframe | null {
	return (ui.prop && current.layers[ui.layer]?.tracks[ui.prop][ui.key]) || null
}

export function removeSelectedKeyframe() {
	const keyframe = selectedKeyframe()
	const {layer, prop, key} = ui
	if (!keyframe || !prop) return
	change(draft => {
		const track = draft.layers[layer].tracks[prop]
		track.splice(key, 1)
		if (!track.length) draft.layers[layer].values[prop] = keyframe.v
	})
	select(layer, prop, -1)
}

/** Moves a keyframe in time. Two keyframes of a property cannot share a time. Returns whether it moved. */
export function moveKeyframe(layerIndex: number, prop: Prop, from: number, time: number): boolean {
	const track = current.layers[layerIndex].tracks[prop]
	if (track[from].t === time || track.some(other => other.t === time)) return false
	setDoc(draft => {
		const moved = draft.layers[layerIndex].tracks[prop]
		moved[from].t = time
		moved.sort((a, b) => a.t - b.t)
	})
	setUi(state => {
		state.key = [...track.map(keyframe => keyframe.t).filter((_, i) => i !== from), time]
			.sort((a, b) => a - b)
			.indexOf(time)
	})
	commit()
	return true
}

export function addLayer(shape: Shape = 'rect') {
	change(draft => {
		const count = draft.layers.filter(layer => layer.shape === shape).length
		const name = shape[0].toUpperCase() + shape.slice(1) + ' ' + (count + 1)
		const layer = createLayer(draft.layers.length, {name, shape, values: {x: COMP.width / 2, y: COMP.height / 2}})
		if (shape === 'text') layer.height = 40
		draft.layers.unshift(layer)
	})
	setUi(state => {
		state.layer = 0
		state.prop = null
		state.key = -1
	})
	sync()
}

export function removeLayer(index: number) {
	change(draft => {
		draft.layers.splice(index, 1)
	})
}

export function foldLayer(index: number) {
	setDoc(draft => {
		draft.layers[index].closed = !draft.layers[index].closed
	})
	// Folding is editor state: it is saved, but it is neither code nor an undo step.
	commit({fromCode: true})
}

export type LayerMove = 'top' | 'bottom' | 'forward' | 'backward'

/** Restacks the selected layer. The first layer is drawn on top. */
export function moveLayer(move: LayerMove) {
	const from = ui.layer
	const count = current.layers.length
	if (!current.layers[from]) return toast('Select a layer first.')

	const to = {top: 0, bottom: count - 1, forward: from - 1, backward: from + 1}[move]
	if (to < 0 || to >= count || to === from) {
		return toast(`${current.layers[from].name} is already at the ${to <= from ? 'top' : 'bottom'}.`)
	}
	setUi(state => {
		state.layer = to
	})
	change(draft => {
		const [layer] = draft.layers.splice(from, 1)
		draft.layers.splice(to, 0, layer)
	})
}

export function setDuration(value: number) {
	const duration = Math.max(100, Math.round(value) || 0, ...keyframeTimes(current))
	if (duration !== current.duration) {
		change(draft => {
			draft.duration = duration
		})
	}
	return duration
}

/** Stretches or squeezes the whole timeline in time. */
export function scaleTime(factor: number) {
	if (factor === 1) return
	const time = Math.round(player.time * factor)
	change(draft => {
		for (const layer of draft.layers) {
			for (const prop of PROPS) {
				let previous = -1
				for (const keyframe of layer.tracks[prop]) {
					// Squeezed keyframes may round to the same time: keep them apart.
					keyframe.t = Math.max(previous + 1, Math.round(keyframe.t * factor))
					previous = keyframe.t
				}
			}
		}
		draft.duration = Math.max(100, Math.round(draft.duration * factor), ...keyframeTimes(draft))
	})
	player.seek(time)
}

/**
 * Runs a pointer drag. Pointer events arrive faster than frames on many
 * devices: `move` runs once per frame, with the latest event. It may edit the
 * document freely (calling `commit()` to show it): the whole drag becomes one
 * undo step.
 */
export function drag(event: PointerEvent, move: (event: PointerEvent) => void) {
	event.preventDefault()
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
	const before = JSON.stringify(current)
	let latest: PointerEvent | null = null
	let request = 0
	dragging = true

	const run = () => {
		request = 0
		if (!latest) return
		const pointer = latest
		latest = null
		move(pointer)
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
		dragging = false

		if (JSON.stringify(current) !== before) remember(before)
		if (codeStale) writeCode()
		if (unsaved) save()
		setUi(state => {
			state.canUndo = undoStack.length > 0
			state.canRedo = redoStack.length > 0
		})
		sync()
	}
	addEventListener('pointermove', onMove)
	addEventListener('pointerup', end)
	addEventListener('pointercancel', end)
}

// ---------------------------------------------------------------------------
// Transport and view
// ---------------------------------------------------------------------------

export function setLoop(loop: boolean) {
	player.loop = loop
	setUi(state => {
		state.loop = loop
	})
}

export function setZoom(zoom: number) {
	setUi(state => {
		state.zoom = zoom
	})
	sync()
}

export function setTheme(theme: Theme) {
	saveTheme(theme)
	setUi(state => {
		state.theme = theme
	})
}

export function togglePath() {
	setUi(state => {
		state.showPath = !state.showPath
	})
}

export function toggleCode() {
	setUi(state => {
		state.showCode = !state.showCode
	})
	sync()
}

// ---------------------------------------------------------------------------
// Code panel: timeline <-> code
// ---------------------------------------------------------------------------

let codeElement: HTMLTextAreaElement | undefined
let codeTimer = 0
let codeStale = false

export function registerCode(element: HTMLTextAreaElement) {
	codeElement = element
}

export const getCode = () => codeElement?.value ?? generateCode(current)

function setStatus(kind: Status['kind'], text: string) {
	setUi(state => {
		state.status.kind = kind
		state.status.text = text
	})
}

/** Timeline -> code, after every edit made in the editor. */
export function writeCode() {
	clearTimeout(codeTimer)
	codeStale = false
	if (codeElement) codeElement.value = generateCode(current)
	setStatus('', 'In sync')
}

/** Folded layers are editor state, not part of the code. */
function keepFolds(next: Doc) {
	next.layers.forEach((layer, i) => {
		if (current.layers[i]?.closed) layer.closed = true
	})
}

/**
 * Code -> timeline, as the code is typed. Broken code leaves the timeline as it
 * was. Returns whether the code compiled.
 */
export function readCode(): boolean {
	clearTimeout(codeTimer)
	let result: Parsed
	try {
		result = parseCode(getCode())
	} catch (error) {
		setStatus('error', (error as Error).message)
		return false
	}
	keepFolds(result.doc)

	// Compare what the code means, not how it is written.
	if (generateCode(result.doc) !== generateCode(current)) {
		remember()
		setDocument(result.doc)
		commit({fromCode: true})
	}
	if (result.warnings.length) setStatus('warn', result.warnings.join(' '))
	else setStatus('', 'In sync')
	return true
}

export function codeTyped() {
	clearTimeout(codeTimer)
	setStatus('warn', 'Editing…')
	codeTimer = window.setTimeout(readCode, 350)
}

// ---------------------------------------------------------------------------
// Toast and dialog
// ---------------------------------------------------------------------------

let toastTimer = 0

/** Set while an embedded editor is being set up: what it does then is not news. */
let quiet = false

export function toast(message: string) {
	if (quiet) return
	clearTimeout(toastTimer)
	setUi(state => {
		state.toast = message
		state.toastShown = true
	})
	toastTimer = window.setTimeout(() => {
		setUi(state => {
			state.toastShown = false
		})
	}, 2600)
}

/**
 * A modal dialog. With `confirm` (a button label), the dialog gets a Cancel
 * button and `onConfirm` runs with the form's fields when it is accepted.
 */
export type DialogSpec = {
	title: string
	body: () => JSX.Element
	confirm?: string
	onConfirm?: (fields: FormData) => void
	wide?: boolean
}

export const [dialog, setDialog] = createSignal<DialogSpec | null>(null)
let dialogElement: HTMLDialogElement | undefined

export function registerDialog(element: HTMLDialogElement) {
	dialogElement = element
	element.addEventListener('close', () => {
		const spec = dialog()
		const accepted = element.returnValue === 'ok'
		const form = element.querySelector('form')
		const fields = form ? new FormData(form) : new FormData()
		setDialog(null)
		flush()
		if (accepted) spec?.onConfirm?.(fields)
	})
}

export const dialogOpen = () => !!dialogElement?.open

export function openDialog(spec: DialogSpec) {
	setDialog(spec)
	flush()
	if (!dialogElement) return
	dialogElement.returnValue = ''
	if (!dialogElement.open) dialogElement.showModal()
}

export function closeDialog() {
	dialogElement?.close()
}

const message = (title: string, body: () => JSX.Element) => openDialog({title, body})

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------

function download(name: string, text: string) {
	const link = document.createElement('a')
	link.href = URL.createObjectURL(new Blob([text], {type: 'text/javascript'}))
	link.download = name
	link.click()
	setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

async function copy(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		return false
	}
}

function pickFile(): Promise<File | undefined> {
	return new Promise(resolve => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = '.js,.mjs,.ts,text/javascript'
		input.onchange = () => resolve(input.files?.[0])
		input.click()
	})
}

type Check = {part: string; ok: boolean | null; detail: string}

/**
 * A link that cannot be opened: what is wrong, and in which part. The link
 * itself (is it base64 of text?), the code (does it run?), the timeline (can
 * what it builds be shown?): the first part that fails is marked, the ones
 * after it were not reached.
 */
function brokenLink(checks: Check[], code?: string) {
	openDialog({
		title: 'This link is broken',
		wide: true,
		body: () => (
			<>
				<p>The shared timeline could not be opened. This is how far it got:</p>
				<ul class="checks">
					{checks.map(check => (
						<li data-ok={String(check.ok)}>
							<b>{check.part}</b>
							<span>{check.detail}</span>
						</li>
					))}
				</ul>
				{code !== undefined && (
					<pre id="broken-code" class="scroll">
						{code}
					</pre>
				)}
			</>
		),
	})
}

/** Runs code that was accepted, and opens it: or says which part of the link is broken. */
function openCode(code: string, opened: string) {
	const link: Check = {part: 'Link', ok: true, detail: `Holds ${code.length.toLocaleString('en')} characters of code.`}
	let parsed: Parsed
	try {
		parsed = parseCode(code)
	} catch (error) {
		const reason = (error as Error).message
		// An error of the editor's own is about what the code builds; any other is the code failing to run.
		const own = (error as Error).constructor === Error
		return brokenLink(
			[
				link,
				{part: 'Code', ok: own, detail: own ? 'Runs.' : reason},
				{part: 'Timeline', ok: own ? false : null, detail: own ? reason : 'Not reached.'},
			],
			code,
		)
	}
	// What was written is what the code panel shows, when there is one to show it.
	if (codeElement && !codeStale) {
		codeElement.value = code
		if (!readCode()) return actions.check()
	} else replaceDoc(parsed.doc)
	rest()
	toast(opened)
}

/**
 * Opens the timeline of a shared link, if the page was opened with one: the
 * fragment is the code, in base64. The code would be run, so it is shown first
 * and opened only when that is accepted.
 */
export async function openSharedLink() {
	const fragment = location.hash.slice(1)
	if (!fragment) return
	history.replaceState(null, '', location.pathname + location.search)
	const old = fragment.match(/^t=(.+)$/)?.[1]
	let code: string
	try {
		// A link from before links held code: the document, as data.
		if (old) {
			replaceDoc(await decodeDoc(old))
			rest()
			return toast('Opened the shared timeline. Undo brings back yours.')
		}
		code = decodeCode(fragment)
	} catch (error) {
		return brokenLink([
			{
				part: 'Link',
				ok: false,
				detail: `${(error as Error).message} (${fragment.length.toLocaleString('en')} characters after the #.)`,
			},
			{part: 'Code', ok: null, detail: 'Not reached.'},
			{part: 'Timeline', ok: null, detail: 'Not reached.'},
		])
	}

	// Code that cannot even be read is refused before anyone is asked to run it.
	const problem = syntaxProblem(code)
	if (problem !== undefined) {
		return brokenLink(
			[
				{part: 'Link', ok: true, detail: `Holds ${code.length.toLocaleString('en')} characters of code.`},
				{part: 'Code', ok: false, detail: problem},
				{part: 'Timeline', ok: null, detail: 'Not reached.'},
			],
			code,
		)
	}

	openDialog({
		title: 'Open shared timeline',
		wide: true,
		confirm: 'Open',
		body: () => (
			<>
				<p>
					This link holds the code below. Opening it <b>runs it in this page</b> and replaces your timeline (Undo brings
					it back). Only open code from someone you trust.
				</p>
				<pre id="shared-code" class="scroll">
					{code}
				</pre>
			</>
		),
		onConfirm: () => openCode(code, 'Opened the shared timeline. Undo brings back yours.'),
	})
}

function summary(checked: Doc) {
	const keyframes = keyframeTimes(checked).length
	return `${checked.layers.length} layers, ${keyframes} keyframes, ${checked.duration}ms.`
}

/** Shows the timeline as code for another library. */
function exportTo(dialect: Dialect) {
	const code = exporters[dialect](current)
	const name = `timeline.${dialect}.js`
	const [copied, setCopied] = createSignal(false)

	openDialog({
		title: `Export to ${DIALECTS[dialect]}`,
		wide: true,
		body: () => (
			<>
				<p>
					The timeline as {DIALECTS[dialect]} code. Curves drawn with the curve tool become{' '}
					<a href="https://www.npmjs.com/package/owneasing" target="_blank" rel="noopener">
						owneasing
					</a>{' '}
					paths.
				</p>
				<textarea id="migrated" readonly spellcheck={false} wrap="off" value={code} />
				<p>
					{dialect === 'kute'
						? 'Kute.js animates elements, and one tween writes its element’s whole transform: the comment at the top lists the (nested) elements this code expects. Positions and angles are whole numbers.'
						: 'One es6-tween Timeline: each tween is a plain {from, to, duration} object, added at its time. {startTime: 0} makes those times count from the start of the timeline.'}
				</p>
				<div class="dialog-tools">
					<button
						type="button"
						onClick={async () => {
							if (await copy(code)) setCopied(true)
							else (document.getElementById('migrated') as HTMLTextAreaElement).select()
						}}
					>
						{copied() ? 'Copied' : 'Copy'}
					</button>
					<button type="button" data-download onClick={() => download(name, code)}>
						Download {name}
					</button>
				</div>
			</>
		),
	})
}

/** Reads code written for another library into the timeline. */
function importFrom(dialect: Dialect) {
	const [problem, setProblem] = createSignal('')
	let field!: HTMLTextAreaElement

	const run = () => {
		let result: Parsed
		try {
			result = importers[dialect](field.value)
		} catch (error) {
			setProblem((error as Error).message)
			return
		}
		closeDialog()
		replaceDoc(result.doc)
		rest()
		if (result.warnings.length) setStatus('warn', result.warnings.join(' '))
		toast(`Imported from ${DIALECTS[dialect]}: ${summary(result.doc)}`)
	}

	openDialog({
		title: `Import from ${DIALECTS[dialect]}`,
		wide: true,
		body: () => (
			<>
				<p>
					Paste {DIALECTS[dialect]} code, or open a file. The code is run to see what it animates:{' '}
					<b>only import code you trust.</b>
				</p>
				<textarea
					id="import-code"
					ref={field}
					spellcheck={false}
					wrap="off"
					placeholder={
						dialect === 'kute'
							? "KUTE.fromTo('#box', {translateX: 0}, {translateX: 200}, {duration: 1000}).start()"
							: 'new Tween(box).to({x: 200}, 1000).start()'
					}
				/>
				{problem() && <pre class="error">{problem()}</pre>}
				<div class="dialog-tools">
					<button
						type="button"
						onClick={async () => {
							const file = await pickFile()
							if (file) field.value = await file.text()
						}}
					>
						Open file…
					</button>
					<button type="button" class="solid" data-import onClick={run}>
						Import
					</button>
				</div>
			</>
		),
	})
}

/** The times the transport steps between: the keyframes of the selected layer, or of all of them. */
function stops(): number[] {
	const layers = current.layers[ui.layer] ? [current.layers[ui.layer]] : current.layers
	return layers.flatMap(layer => Object.values(layer.tracks).flatMap(track => track.map(keyframe => keyframe.t)))
}

/** A timeline of the user's own, new or opened: it waits at 0s, however it was playing before. */
function rest() {
	userPlays = false
	player.pause()
	player.seek(0)
}

/** Whether the user chose to play, and has not paused since: a new template then plays by itself. */
let userPlays = false

export const actions: Record<string, () => unknown> = {
	create() {
		replaceDoc({duration: 4000, layers: []})
		rest()
		toast('New empty timeline. Add a layer from Edit › New layer.')
	},

	async open() {
		const file = await pickFile()
		if (!file || !codeElement) return
		// Opening a file is the same as typing its code: it compiles, or reports why not.
		codeElement.value = await file.text()
		if (readCode()) {
			rest()
			toast('Opened ' + file.name)
		} else actions.check()
	},

	save: () => download('timeline.js', getCode()),

	async share() {
		// The code as it is written, if it compiles; else the code of the timeline that is shown.
		const url = shareUrl(codeElement && !codeStale && readCode() ? codeElement.value : generateCode(current))

		if (navigator.share) {
			try {
				return await navigator.share({title: 'tween.js timeline', url})
			} catch (error) {
				if ((error as Error).name === 'AbortError') return // the share sheet was dismissed
			}
		}

		// No share sheet (most desktop browsers): copy the link, or show it.
		if (await copy(url)) return toast('Link copied to the clipboard.')
		message('Share', () => (
			<>
				<p>Copy this link to share the timeline:</p>
				<label>
					<input readonly value={url} />
				</label>
			</>
		))
		dialogElement?.querySelector('input')?.select()
	},

	scale() {
		openDialog({
			title: 'Scale',
			confirm: 'Scale',
			body: () => (
				<>
					<p>Stretch or squeeze the whole timeline in time. Keyframes keep their values and easings.</p>
					<label>
						Scale <input name="percent" type="number" min="1" max="10000" step="any" value="100" required /> %
					</label>
					<p>The timeline is {current.duration}ms long: 50% plays it twice as fast, 200% half as fast.</p>
				</>
			),
			onConfirm: fields => scaleTime(clamp(Number(fields.get('percent')) || 100, 1, 10000) / 100),
		})
	},

	'layer-new': () => addLayer('rect'),
	'layer-top': () => moveLayer('top'),
	'layer-forward': () => moveLayer('forward'),
	'layer-backward': () => moveLayer('backward'),
	'layer-bottom': () => moveLayer('bottom'),

	/** To the keyframe before the playhead: of the selected layer, or of any layer. Else the start. */
	prev: () => player.seek(Math.max(0, ...stops().filter(time => time < player.time - 0.5))),
	/** To the keyframe after the playhead, else the end. */
	next: () => player.seek(Math.min(current.duration, ...stops().filter(time => time > player.time + 0.5))),
	play() {
		userPlays = true
		player.play()
	},
	pause() {
		userPlays = false
		player.pause()
	},
	stop() {
		userPlays = false
		player.pause()
		player.seek(0)
	},
	restart() {
		userPlays = true
		player.pause()
		player.seek(0)
		player.play()
	},

	/** Rewrites the code in the editor's own style. */
	format() {
		if (!readCode()) return actions.check()
		writeCode()
		toast('Code formatted.')
	},

	/** Compiles the code and reports what it found, without changing the timeline. */
	check() {
		try {
			const {doc: checked, warnings} = parseCode(getCode())
			message('Check code', () => (
				<>
					<p>
						{warnings.length ? 'The code compiles, with notes:' : 'No problems found.'} {summary(checked)}
					</p>
					{warnings.map(warning => (
						<pre class="warn">{warning}</pre>
					))}
				</>
			))
		} catch (error) {
			message('Check code', () => (
				<>
					<p>The code does not compile. The timeline keeps its last working state until this is fixed.</p>
					<pre class="error">{(error as Error).message}</pre>
				</>
			))
		}
	},

	'export-es6-tween': () => exportTo('es6-tween'),
	'export-kute': () => exportTo('kute'),
	'import-es6-tween': () => importFrom('es6-tween'),
	'import-kute': () => importFrom('kute'),

	demo() {
		replaceDoc(demo())
		// Like a template: it plays if the user was playing.
		player.pause()
		player.seek(0)
		if (userPlays) player.play()
	},

	about() {
		message('About', () => (
			<>
				<p>
					A small keyframe editor built on{' '}
					<a href="https://github.com/tweenjs/tween.js" target="_blank" rel="noopener">
						tween.js
					</a>{' '}
					{VERSION}: every timeline here is a <code>Timeline</code> of <code>Tween</code>s, and the code panel is that
					timeline as a module you can paste into your own project.
				</p>
				<p>
					Timelines are saved in this browser only. A shared link carries the code itself, in base64 after the #:
					nothing is uploaded.
				</p>
				<p>
					<a href="docs/index.html" target="_blank" rel="noopener">
						How to use the editor
					</a>
				</p>
			</>
		))
	},
}

for (const template of templates) {
	actions['template:' + template.name] = () => {
		replaceDoc(template.make())
		// A template plays if the user was playing, and is otherwise at 0s, paused.
		player.pause()
		player.seek(0)
		if (userPlays) player.play()
		toast(`${template.name}: ${userPlays ? 'Space pauses' : 'Space plays'}, Undo brings back your timeline.`)
	}
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export function onKeyDown(event: KeyboardEvent) {
	if (dialogOpen()) return
	const target = event.target as HTMLElement
	const mod = event.ctrlKey || event.metaKey
	const key = event.key.toLowerCase()

	// File shortcuts also work while typing code.
	const shortcut = mod && ({s: 'save', o: 'open'} as Record<string, string>)[key]
	if (shortcut) {
		event.preventDefault()
		return actions[shortcut]()
	}

	if (target.closest('input, textarea, select')) return
	// Space on a focused button would also press it.
	if (target instanceof HTMLButtonElement) target.blur()

	const step = SNAP * (event.shiftKey ? 10 : 1)

	if (mod && key === 'z') event.shiftKey ? redo() : undo()
	else if (mod && key === 'y') redo()
	else if (mod && key === ']') moveLayer(event.shiftKey ? 'top' : 'forward')
	else if (mod && key === '[') moveLayer(event.shiftKey ? 'bottom' : 'backward')
	else if (mod) return
	else if (key === ' ') player.playing ? actions.pause() : actions.play()
	else if (key === 'delete' || key === 'backspace') removeSelectedKeyframe()
	else if (key === 'pageup') actions.prev()
	else if (key === 'pagedown') actions.next()
	else if (key === 'home') player.seek(0)
	else if (key === 'end') player.seek(current.duration)
	else if (key === 'arrowleft') player.seek(snap(player.time) - step)
	else if (key === 'arrowright') player.seek(snap(player.time) + step)
	else return

	event.preventDefault()
}

/** What the address of an embedded editor asks for: see embed.ts. */
function applyEmbed() {
	const query = embedQuery
	quiet = true
	const template = query.get('template')
	if (template) actions['template:' + template]?.()

	const layer = current.layers.findIndex(item => item.name === query.get('select'))
	if (layer !== -1) {
		const prop = query.get('prop') as Prop | null
		select(layer, prop && PROPS.includes(prop) ? prop : null, prop ? Number(query.get('key') ?? 0) : -1)
	}
	const seek = query.get('seek')
	if (seek !== null) player.seek(Number(seek) || 0)
	if (query.has('play')) actions.play()
	for (const name of query.get('do')?.split(',') ?? []) actions[name]?.()
	quiet = false

	// The menus are drawn by now: open the one that is asked for.
	const title = query.get('menu')
	if (title) {
		requestAnimationFrame(() => {
			const open = [...document.querySelectorAll<HTMLElement>('.menu-title')].find(item => item.textContent === title)
			const sub = query.get('sub')
			if (sub) document.querySelector(`[data-submenu="${sub}"]`)?.parentElement?.classList.add('open')
			;(open?.nextElementSibling as HTMLElement | null)?.showPopover()
		})
	}
}

/** Shows the document that was loaded. Call once, after the first render. */
export function start() {
	player.loop = ui.loop
	commit()
	if (embedded) applyEmbed()
	void openSharedLink()
}
