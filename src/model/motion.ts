import {curve} from './curveTools'
import {
	COMP,
	RADIUS,
	createLayer,
	key,
	presetEase,
	type Doc,
	type Ease,
	type Layer,
	type Prop,
	type Shape,
} from './types'

/**
 * Product motion: three scenes of the kind a motion designer makes for a
 * launch. An interface is built on screen piece by piece, a pointer uses it,
 * and one thing leads to the next. Each scene is 14 to 16 seconds and over a
 * hundred layers, and each is made of nothing but the editor's own parts:
 * rectangles, circles and text, with keyframes on position, scale, rotation
 * and opacity. Take them apart in the timeline.
 *
 * The tricks, since a layer cannot change its width or be cut by another:
 * - text is "typed" by a cover of the background colour that slides off it,
 *   with a caret on the cover's edge;
 * - a bar "grows" by rising from behind a strip of the background colour;
 * - a number "counts" by one text sliding out as the next slides in;
 * - a soft glow is a stack of faint circles.
 */

const CX = COMP.width / 2
const CY = COMP.height / 2
const ms = (seconds: number) => Math.round(seconds * 1000)
/** About how wide a text is drawn, in the editor's bold font: enough to align things by. */
const textWidth = (text: string, size: number) => text.length * size * 0.6

type Easing = string | Ease
const ease = (easing: Easing): Ease => (typeof easing === 'string' ? presetEase(easing) : easing)

/** The value a property has after its last keyframe. */
const now = (layer: Layer, prop: Prop) => {
	const track = layer.tracks[prop]
	return track.length ? track[track.length - 1].v : layer.values[prop]
}

/**
 * Moves a property to `value` between two times, in seconds. Before `from` it
 * holds what it had: moves are written in the order they happen.
 */
function to(layer: Layer, prop: Prop, from: number, until: number, value: number, easing: Easing = 'Cubic.Out') {
	const track = layer.tracks[prop]
	const start = ms(from)
	const end = Math.max(start + 1, ms(until))
	const last = track[track.length - 1]
	if (last && start < last.t)
		throw new Error(`${layer.name} ${prop}: ${start}ms is before its last keyframe, ${last.t}ms`)
	if (last && last.t === start) last.ease = ease(easing)
	else track.push(key(start, now(layer, prop), ease(easing)))
	track.push(key(end, value))
}

/** A change with no motion: one millisecond. */
const jump = (layer: Layer, prop: Prop, at: number, value: number) =>
	to(layer, prop, at, at + 0.001, value, 'Linear.None')

const show = (layer: Layer, at: number, length = 0.22, opacity = 1) =>
	to(layer, 'opacity', at, at + length, opacity, 'Quadratic.Out')
const hide = (layer: Layer, at: number, length = 0.2) => {
	if (now(layer, 'opacity') > 0) to(layer, 'opacity', at, at + length, 0, 'Quadratic.In')
}

/** Appears with a small overshoot, like something placed on a table. */
function pop(layer: Layer, at: number, length = 0.45, from = 0.6, opacity = 1) {
	if (layer.tracks.scale.length) jump(layer, 'scale', at - 0.001, from)
	else layer.values.scale = from
	to(layer, 'scale', at, at + length, 1, 'Back.Out')
	show(layer, at, Math.min(0.18, length), opacity)
}

/** Appears while it settles upwards into its place. */
function rise(layer: Layer, at: number, by = 12, length = 0.5, opacity = 1) {
	const y = now(layer, 'y')
	if (layer.tracks.y.length) jump(layer, 'y', at - 0.001, y + by)
	else layer.values.y = y + by
	to(layer, 'y', at, at + length, y, 'Cubic.Out')
	show(layer, at, Math.min(0.3, length), opacity)
}

/** Pressed and let go. */
function press(layer: Layer, at: number) {
	to(layer, 'scale', at, at + 0.09, 0.94, 'Quadratic.Out')
	to(layer, 'scale', at + 0.09, at + 0.36, 1, 'Back.Out')
}

/** Grows and shrinks once: a heartbeat. */
function pulse(layer: Layer, at: number, by = 1.06, length = 0.7) {
	to(layer, 'scale', at, at + length * 0.45, by, 'Sinusoidal.InOut')
	to(layer, 'scale', at + length * 0.45, at + length, 1, 'Sinusoidal.InOut')
}

/** A scene under construction. Layers are added from the back to the front. */
class Scene {
	layers: Layer[] = []

	private add(
		name: string,
		shape: Shape,
		color: string,
		width: number,
		height: number,
		x: number,
		y: number,
		opacity: number,
	) {
		const layer = createLayer(this.layers.length, {name, shape, color, width, height, values: {x, y, opacity}})
		// Folded in the timeline: there are over a hundred of them.
		layer.closed = true
		this.layers.push(layer)
		return layer
	}
	/** Hidden until it is shown, unless `opacity` says otherwise. */
	rect(name: string, color: string, width: number, height: number, x: number, y: number, radius = 6, opacity = 0) {
		const layer = this.add(name, 'rect', color, width, height, x, y, opacity)
		if (radius !== RADIUS) layer.radius = radius
		return layer
	}
	dot(name: string, color: string, size: number, x: number, y: number, opacity = 0) {
		return this.add(name, 'circle', color, size, size, x, y, opacity)
	}
	/** Text, centred on `x`. */
	text(name: string, text: string, color: string, size: number, x: number, y: number, opacity = 0) {
		const layer = this.add(name, 'text', color, 80, size, x, y, opacity)
		layer.text = text
		return layer
	}
	/** Text that starts at `left`. */
	textFrom(name: string, text: string, color: string, size: number, left: number, y: number, opacity = 0) {
		const layer = this.text(name, text, color, size, left, y, opacity)
		layer.align = 'left'
		return layer
	}

	/** A ring that spreads from a click and fades. */
	ripple(name: string, color: string, x: number, y: number, at: number, size = 44) {
		const ring = this.dot(name, color, size, x, y)
		ring.values.scale = 0.2
		jump(ring, 'opacity', at, 0.32)
		to(ring, 'scale', at, at + 0.6, 2.2, 'Cubic.Out')
		to(ring, 'opacity', at + 0.001, at + 0.6, 0, 'Quadratic.Out')
		return ring
	}

	/**
	 * Text that is typed: a cover of the colour behind it slides off to the
	 * right, in bursts, with a caret on its edge. The cover needs that much
	 * room to the right of the text, on the same colour.
	 */
	typed(
		name: string,
		text: string,
		color: string,
		size: number,
		left: number,
		y: number,
		behind: string,
		caret: string,
		from: number,
		until: number,
	) {
		// Fonts differ: the cover is wider than the text is likely to be.
		const width = textWidth(text, size) * 1.12 + 8
		const words = this.textFrom(name, text, color, size, left, y)
		const cover = this.rect(name + ' cover', behind, width, size + 8, left + width / 2 - 2, y, 0)
		const bar = this.rect(name + ' caret', caret, 2, size + 4, left - 1, y, 1)
		jump(words, 'opacity', from, 1)
		jump(cover, 'opacity', from - 0.01, 1)
		show(bar, from - 0.25, 0.1)
		// Typed in four bursts, with the short stops of someone thinking.
		const steps = [0, 0.3, 0.34, 0.62, 0.66, 0.9, 0.93, 1]
		const reach = [0, 0.36, 0.36, 0.63, 0.63, 0.88, 0.88, 1]
		for (let i = 1; i < steps.length; i++) {
			const start = from + (until - from) * steps[i - 1]
			const end = from + (until - from) * steps[i]
			to(cover, 'x', start, end, left + width / 2 - 2 + width * reach[i], 'Linear.None')
			to(bar, 'x', start, end, left - 1 + width * reach[i], 'Linear.None')
		}
		// The caret blinks twice, then goes.
		for (let i = 0; i < 2; i++) {
			jump(bar, 'opacity', until + 0.2 + i * 0.5, 0)
			jump(bar, 'opacity', until + 0.45 + i * 0.5, 1)
		}
		jump(bar, 'opacity', until + 1.2, 0)
		jump(cover, 'opacity', until + 0.05, 0)
		return {words, cover, bar}
	}

	/** A pointer: a dark dot with a light edge. `move` takes it somewhere. */
	pointer(x: number, y: number, onDark = false) {
		const edge = this.dot('Pointer edge', onDark ? '#0b0c10' : '#ffffff', 20, x, y)
		const body = this.dot('Pointer', onDark ? '#ffffff' : '#17181c', 15, x, y)
		const parts = [edge, body]
		return {
			parts,
			show: (at: number) => parts.forEach(part => show(part, at, 0.25, part === edge ? 0.9 : 1)),
			hide: (at: number) => parts.forEach(part => hide(part, at, 0.25)),
			move: (from: number, until: number, toX: number, toY: number) => {
				for (const part of parts) {
					to(part, 'x', from, until, toX, 'Cubic.InOut')
					to(part, 'y', from, until, toY, 'Quartic.InOut')
				}
			},
			click: (at: number) => parts.forEach(part => press(part, at)),
		}
	}

	/** Everything that can still be seen fades out: the end of the loop. */
	clear(at: number, length = 0.5, keep: Layer[] = []) {
		for (const layer of this.layers) {
			if (keep.includes(layer) || now(layer, 'opacity') <= 0) continue
			const track = layer.tracks.opacity
			const start = Math.max(at, track.length ? track[track.length - 1].t / 1000 : 0)
			to(layer, 'opacity', start, Math.max(start + 0.05, at + length), 0, 'Quadratic.In')
		}
	}

	/** The first layer of a document is the one in front. */
	done(duration: number): Doc {
		return {duration: ms(duration), layers: [...this.layers].reverse()}
	}
}

// ---------------------------------------------------------------------------
// Sign-in flow
// ---------------------------------------------------------------------------

/**
 * A button, a pointer, and what follows: an email typed, a password, a six
 * digit code, and a profile with a bell that rings. On a light ground.
 */
export function signIn(): Doc {
	const scene = new Scene()
	const ground = '#ecece7'
	const ink = '#101114'
	const soft = '#8d8d86'
	const white = '#ffffff'
	const well = '#f1f1ec'
	const blue = '#2f6bff'
	const green = '#1fa971'
	const red = '#f0483e'

	scene.rect('Ground', ground, COMP.width, COMP.height, CX, CY, 0, 1)
	// A grid of dots, like a design canvas. It breathes once, outwards from the middle.
	for (let row = 0; row < 5; row++) {
		for (let column = 0; column < 9; column++) {
			const x = 40 + column * 70
			const y = 40 + row * 70
			const dot = scene.dot(`Grid ${row + 1}.${column + 1}`, '#cfcfc8', 3, x, y, 1)
			const wave = 1.9 + Math.hypot(x - CX, y - CY) / 420
			to(dot, 'scale', wave, wave + 0.25, 2.2, 'Quadratic.Out')
			to(dot, 'scale', wave + 0.25, wave + 0.9, 1, 'Quadratic.InOut')
		}
	}

	// --- 1. The button.
	const shadow = scene.rect('Button shadow', '#c9c9c2', 190, 58, CX, CY + 7, 29)
	const button = scene.rect('Button', ink, 190, 58, CX, CY, 29)
	const buttonText = scene.text('Button text', 'Sign in', white, 21, CX, CY)
	pop(button, 0.25, 0.55, 0.4)
	show(shadow, 0.45, 0.4, 0.55)
	show(buttonText, 0.4, 0.3)
	const click1 = scene.ripple('Click 1', blue, CX + 24, CY + 6, 1.85)
	press(button, 1.85)
	press(buttonText, 1.85)

	// --- 2. The card the button becomes.
	const cardShadow = scene.rect('Card shadow', '#d6d6cf', 316, 262, CX, CY + 8, 22)
	const card = scene.rect('Card', white, 316, 258, CX, CY, 20)
	for (const part of [button, buttonText, shadow]) hide(part, 2.22, 0.22)
	to(button, 'scale', 2.22, 2.5, 1.5, 'Quadratic.In')
	card.values.scale = 0.42
	show(card, 2.2, 0.2)
	to(card, 'scale', 2.2, 2.85, 1, curve('Overshoot'))
	show(cardShadow, 2.5, 0.5, 0.6)

	const left = CX - 128
	const title = scene.textFrom('Title', 'Welcome back', ink, 19, left, 82)
	const sub = scene.textFrom('Subtitle', 'Sign in to continue', soft, 11, left, 104)
	rise(title, 2.6)
	rise(sub, 2.72)

	// Email: a label, a line under it, and the address typed on it.
	const emailLabel = scene.textFrom('Email label', 'EMAIL', soft, 8, left, 132)
	const emailLine = scene.rect('Email line', '#deded7', 256, 2, CX, 163, 1)
	const emailFocus = scene.rect('Email focus', blue, 256, 2, CX, 163, 1)
	rise(emailLabel, 2.85, 8)
	show(emailLine, 2.9)
	const email = scene.typed('Email', 'ada@lovelace.dev', ink, 13, left, 149, white, blue, 3.35, 4.75)
	show(emailFocus, 3.1, 0.2)
	hide(emailFocus, 5.0, 0.25)

	// Password: ten dots, one per key.
	const passLabel = scene.textFrom('Password label', 'PASSWORD', soft, 8, left, 184)
	const passLine = scene.rect('Password line', '#deded7', 256, 2, CX, 215, 1)
	const passFocus = scene.rect('Password focus', blue, 256, 2, CX, 215, 1)
	rise(passLabel, 2.95, 8)
	show(passLine, 3.0)
	show(passFocus, 5.05, 0.2)
	const secret: Layer[] = []
	for (let i = 0; i < 10; i++) {
		const dot = scene.dot(`Password ${i + 1}`, ink, 7, left + 4 + i * 13, 201)
		pop(dot, 5.2 + i * 0.095 + (i > 5 ? 0.12 : 0), 0.22, 0.2)
		secret.push(dot)
	}
	hide(passFocus, 6.35, 0.25)

	const go = scene.rect('Continue', ink, 256, 34, CX, 252, 10)
	const goText = scene.text('Continue text', 'Continue', white, 12, CX, 252)
	rise(go, 3.05, 10)
	rise(goText, 3.1, 10)
	const click2 = scene.ripple('Click 2', blue, CX + 30, 254, 6.75)
	press(go, 6.75)
	press(goText, 6.75)

	// --- 3. The code that was sent.
	const form = [emailLabel, emailLine, email.words, passLabel, passLine, ...secret, go, goText, title, sub]
	form.forEach((part, i) => hide(part, 7.05 + (i % 5) * 0.03, 0.22))
	const title2 = scene.textFrom('Title 2', 'Check your email', ink, 19, left, 82)
	const sub2 = scene.textFrom('Subtitle 2', 'We sent a 6-digit code', soft, 11, left, 104)
	rise(title2, 7.3)
	rise(sub2, 7.4)

	const code = '482916'
	const boxes: Layer[] = []
	const digits: Layer[] = []
	const done: Layer[] = []
	const boxX = (i: number) => CX - 110 + i * 44
	for (let i = 0; i < 6; i++) boxes.push(scene.rect(`Code box ${i + 1}`, well, 36, 46, boxX(i), 162, 9))
	for (let i = 0; i < 6; i++) done.push(scene.rect(`Code right ${i + 1}`, '#d5f2e4', 36, 46, boxX(i), 162, 9))
	const marker = scene.rect('Code marker', blue, 22, 3, boxX(0), 178, 1.5)
	for (let i = 0; i < 6; i++) digits.push(scene.text(`Code ${i + 1}`, code[i], ink, 20, boxX(i), 161))
	boxes.forEach((box, i) => rise(box, 7.45 + i * 0.06, 14, 0.45))
	show(marker, 7.9)
	digits.forEach((digit, i) => {
		const at = 8.25 + i * 0.26
		pop(digit, at, 0.3, 0.3)
		if (i < 5) to(marker, 'x', at + 0.1, at + 0.24, boxX(i + 1), 'Quadratic.InOut')
	})
	hide(marker, 9.75, 0.15)
	// Right: the boxes turn green one after another, and nod.
	done.forEach((mark, i) => {
		show(mark, 9.95 + i * 0.05, 0.18)
		pulse(boxes[i], 9.95 + i * 0.05, 1.08, 0.4)
		pulse(digits[i], 9.95 + i * 0.05, 1.12, 0.4)
	})
	const wait = [0, 1, 2].map(i => scene.dot(`Waiting ${i + 1}`, green, 7, CX - 12 + i * 12, 224))
	wait.forEach((dot, i) => {
		show(dot, 10.2 + i * 0.08, 0.15)
		for (let beat = 0; beat < 2; beat++) {
			const at = 10.3 + i * 0.12 + beat * 0.42
			to(dot, 'y', at, at + 0.16, 217, 'Quadratic.Out')
			to(dot, 'y', at + 0.16, at + 0.36, 224, 'Quadratic.In')
		}
	})

	// --- 4. The profile.
	const codeParts = [title2, sub2, ...boxes, ...done, ...digits, ...wait]
	codeParts.forEach((part, i) => hide(part, 11.15 + (i % 6) * 0.025, 0.2))
	to(card, 'scale', 11.15, 11.35, 0.95, 'Quadratic.InOut')
	to(card, 'scale', 11.35, 11.85, 1, 'Back.Out')

	const halo = scene.dot('Avatar halo', '#dde6ff', 74, CX, 106)
	const avatar = scene.dot('Avatar', blue, 60, CX, 106)
	const initials = scene.text('Initials', 'AL', white, 21, CX, 106)
	pop(halo, 11.4, 0.6, 0.3)
	pop(avatar, 11.48, 0.55, 0.3)
	pop(initials, 11.6, 0.4, 0.5)
	const name = scene.text('Name', 'Ada Lovelace', ink, 18, CX, 160)
	const role = scene.text('Role', 'Analytical engines', soft, 11, CX, 180)
	rise(name, 11.7)
	rise(role, 11.8)
	const stats: Array<[string, string]> = [
		['128', 'posts'],
		['24', 'teams'],
		['9', 'alerts'],
	]
	stats.forEach(([value, label], i) => {
		const x = CX - 88 + i * 88
		rise(scene.rect(`Stat ${label}`, well, 78, 48, x, 228, 11), 11.95 + i * 0.08, 14)
		rise(scene.text(`Stat ${label} value`, value, ink, 16, x, 222), 12.02 + i * 0.08, 10)
		rise(scene.text(`Stat ${label} name`, label, soft, 9, x, 239), 12.06 + i * 0.08, 10)
	})

	// The bell, top right: it rings, a badge appears, and the count goes up.
	const bellX = CX + 126
	const bellY = 66
	const bellGround = scene.dot('Bell ground', well, 34, bellX, bellY)
	const bellTop = scene.dot('Bell top', ink, 12, bellX, bellY - 4)
	const bellBody = scene.rect('Bell', ink, 12, 9, bellX, bellY, 2)
	const bellRim = scene.rect('Bell rim', ink, 18, 3, bellX, bellY + 6, 1.5)
	const bellDrop = scene.dot('Bell clapper', ink, 4, bellX, bellY + 10)
	for (const part of [bellGround, bellTop, bellBody, bellRim, bellDrop]) pop(part, 12.3, 0.4, 0.4)
	// It swings from its top: every part turns, and the lower ones move the furthest.
	for (const part of [bellTop, bellBody, bellRim, bellDrop]) {
		const below = part.values.y - (bellY - 10)
		;[18, -15, 10, -6, 0].forEach((angle, i) => {
			const at = 12.95 + i * 0.11
			to(part, 'rotation', at, at + 0.11, angle, 'Sinusoidal.InOut')
			to(part, 'x', at, at + 0.11, bellX - Math.sin((angle * Math.PI) / 180) * below, 'Sinusoidal.InOut')
		})
	}
	const badge = scene.dot('Badge', red, 17, bellX + 11, bellY - 11)
	const count3 = scene.text('Badge 3', '3', white, 10, bellX + 11, bellY - 11)
	const count4 = scene.text('Badge 4', '4', white, 10, bellX + 11, bellY - 3)
	pop(badge, 13.15, 0.4, 0.2)
	pop(count3, 13.22, 0.3, 0.3)
	to(count3, 'y', 14.0, 14.2, bellY - 19, 'Quadratic.In')
	hide(count3, 14.0, 0.18)
	show(count4, 14.05, 0.15)
	to(count4, 'y', 14.05, 14.3, bellY - 11, 'Back.Out')
	pulse(badge, 14.05, 1.25, 0.4)

	// A message drops in from the top.
	const toast = scene.rect('Message', ink, 214, 34, CX, -24, 17, 1)
	const toastDot = scene.dot('Message dot', green, 9, CX - 86, -24, 1)
	const toastText = scene.text('Message text', 'Welcome back, Ada', white, 11, CX + 6, -24, 1)
	for (const part of [toast, toastDot, toastText]) {
		to(part, 'y', 13.5, 14.05, 26, curve('Overshoot'))
		to(part, 'y', 15.3, 15.65, -24, 'Cubic.In')
	}

	// The pointer, in front of everything.
	const pointer = scene.pointer(520, 318)
	pointer.show(0.9)
	pointer.move(1.0, 1.75, CX + 24, CY + 6)
	pointer.click(1.85)
	pointer.move(2.5, 3.2, CX + 96, 150)
	pointer.move(4.9, 5.15, CX + 96, 202)
	pointer.move(6.1, 6.65, CX + 30, 254)
	pointer.click(6.75)
	pointer.move(7.2, 7.9, CX + 150, 250)
	pointer.move(12.5, 12.95, bellX + 22, bellY + 24)
	pointer.hide(15.2)
	void click1
	void click2

	scene.clear(15.75, 0.5, [scene.layers[0], ...scene.layers.slice(1, 46)])
	return scene.done(16.4)
}

// ---------------------------------------------------------------------------
// Launch film
// ---------------------------------------------------------------------------

/**
 * A mark, a prompt, code streaming past, and the page it makes: a glass card
 * with a headline and a button that asks to be pressed. On a dark ground with
 * slow warm light.
 */
export function launchFilm(): Doc {
	const scene = new Scene()
	const ground = '#0a0a0c'
	const white = '#f4f3ef'
	const soft = '#8c8b93'
	const orange = '#ff8a1f'
	const amber = '#ffc531'
	const ember = '#c2410c'
	const panel = '#17171c'
	const length = 15.6

	scene.rect('Ground', ground, COMP.width, COMP.height, CX, CY, 0, 1)

	// Slow light: three glows, each a stack of faint circles, that drift the whole time.
	const glows: Array<[string, string, number, number, number, number, number]> = [
		['Glow amber', amber, 150, 300, 250, 420, 130],
		['Glow orange', orange, 470, 110, 210, 330, 250],
		['Glow ember', ember, 330, 330, 290, 200, 90],
	]
	for (const [name, color, x, y, size, toX, toY] of glows) {
		for (let ring = 0; ring < 9; ring++) {
			const glow = scene.dot(`${name} ${ring + 1}`, color, size * (1 - ring * 0.1), x, y, 0)
			show(glow, 0.1 + ring * 0.04, 1.2, 0.026 + ring * 0.003)
			// Inner rings lag a little: the light seems to flow.
			const lag = ring * 0.07
			to(glow, 'x', 0.2 + lag, length * 0.5 + lag, toX, 'Sinusoidal.InOut')
			to(glow, 'x', length * 0.5 + lag, length - 0.3, x, 'Sinusoidal.InOut')
			to(glow, 'y', 0.2 + lag, length * 0.5 + lag, toY, 'Sinusoidal.InOut')
			to(glow, 'y', length * 0.5 + lag, length - 0.3, y, 'Sinusoidal.InOut')
			to(glow, 'opacity', length - 0.9, length - 0.3, 0, 'Quadratic.In')
		}
	}

	// --- 1. The mark: twelve rays around a core, and a name.
	const rays: Layer[] = []
	const burst = (centerX: number, centerY: number, reach: number, at: number, tag: string) => {
		const made: Layer[] = []
		for (let i = 0; i < 12; i++) {
			const angle = (i / 12) * Math.PI * 2
			const ray = scene.rect(`${tag} ray ${i + 1}`, i % 3 ? orange : amber, 6, i % 2 ? 22 : 30, centerX, centerY, 3)
			ray.values.rotation = (i / 12) * 360
			ray.values.scale = 0.3
			const start = at + i * 0.035
			show(ray, start, 0.15)
			to(ray, 'x', start, start + 0.6, centerX + Math.sin(angle) * reach, 'Back.Out')
			to(ray, 'y', start, start + 0.6, centerY - Math.cos(angle) * reach, 'Back.Out')
			to(ray, 'scale', start, start + 0.6, 1, 'Back.Out')
			// A wave runs around the rays.
			pulse(ray, start + 0.7, 1.28, 0.5)
			made.push(ray)
		}
		return made
	}
	rays.push(...burst(CX, 150, 40, 0.3, 'Mark'))
	const core = scene.dot('Mark core', white, 20, CX, 150)
	pop(core, 0.25, 0.5, 0.2)
	const name = scene.text('Name', 'tween.js', white, 30, CX, 232)
	const tag = scene.text('Tagline', 'motion, written as code', soft, 12, CX, 258)
	rise(name, 0.95, 16)
	rise(tag, 1.15, 12)
	// The mark leaves upwards as the prompt arrives.
	rays.forEach((ray, i) => {
		hide(ray, 2.5 + i * 0.015, 0.25)
		to(ray, 'y', 2.5 + i * 0.015, 2.85, now(ray, 'y') - 30, 'Cubic.In')
	})
	for (const part of [core, name, tag]) {
		hide(part, 2.55, 0.25)
		to(part, 'y', 2.55, 2.85, now(part, 'y') - 24, 'Cubic.In')
	}

	// --- 2. The prompt.
	const barLeft = CX - 200
	const promptEdge = scene.rect('Prompt edge', '#34343c', 404, 52, CX, 180, 26)
	const promptBar = scene.rect('Prompt', panel, 400, 48, CX, 180, 24)
	rise(promptEdge, 2.8, 22, 0.6)
	rise(promptBar, 2.8, 22, 0.6)
	const spark = scene.dot('Prompt spark', orange, 9, barLeft + 24, 180)
	pop(spark, 3.1, 0.35, 0.2)
	const prompt = scene.typed(
		'Prompt text',
		'A landing page, in motion',
		white,
		13,
		barLeft + 42,
		180,
		panel,
		orange,
		3.45,
		4.95,
	)
	const send = scene.dot('Send', orange, 34, barLeft + 374, 180)
	const sendArrow = scene.rect('Send arrow', ground, 3.5, 14, barLeft + 374, 181, 1.75)
	const sendTip = scene.rect('Send tip left', ground, 3.5, 10, barLeft + 371, 177.5, 1.75)
	const sendTip2 = scene.rect('Send tip right', ground, 3.5, 10, barLeft + 377, 177.5, 1.75)
	sendTip.values.rotation = 45
	sendTip2.values.rotation = -45
	for (const part of [send, sendArrow, sendTip, sendTip2]) pop(part, 5.05, 0.4, 0.3)
	scene.ripple('Send click', orange, barLeft + 374, 180, 5.75, 40)
	for (const part of [send, sendArrow, sendTip, sendTip2]) press(part, 5.75)
	const promptParts = [promptEdge, promptBar, spark, prompt.words, send, sendArrow, sendTip, sendTip2]
	// The prompt moves up and gets smaller. Each part shrinks about its own middle,
	// so each also moves towards the middle of the bar.
	for (const part of promptParts) {
		const middle = part === prompt.words ? now(part, 'x') + textWidth(part.text, part.height) * 0.55 : now(part, 'x')
		const shift = part === prompt.words ? textWidth(part.text, part.height) * 0.55 : 0
		to(part, 'x', 6.15, 6.65, CX + (middle - CX) * 0.8 - shift, 'Cubic.InOut')
		to(part, 'y', 6.15, 6.65, now(part, 'y') - 136, 'Cubic.InOut')
		to(part, 'scale', 6.15, 6.65, 0.8, 'Cubic.InOut')
		to(part, 'opacity', 6.15, 6.65, part === promptEdge ? 0.5 : 0.75, 'Quadratic.Out')
	}

	// --- 3. Code streams past: lines of coloured tokens that write themselves and scroll away.
	const tokens = ['#6f6e78', orange, '#5fc9a4', '#7aa7ff', amber, '#e8e7ee']
	const next = (
		seed => () =>
			(seed = (seed * 16807) % 2147483647) / 2147483647
	)(42)
	const stream: Layer[] = []
	for (let line = 0; line < 13; line++) {
		const indent = [0, 1, 2, 2, 1, 1, 2, 3, 2, 1, 0, 1, 0][line] * 18
		let x = 150 + indent
		const parts = 2 + Math.floor(next() * 2.4)
		for (let part = 0; part < parts; part++) {
			const width = 22 + Math.floor(next() * 5) * 13
			const y = 122 + line * 17
			const token = scene.rect(
				`Code ${line + 1}.${part + 1}`,
				tokens[Math.floor(next() * tokens.length)],
				width,
				7,
				x + width / 2 - 14,
				y,
				3.5,
			)
			const at = 6.35 + line * 0.085 + part * 0.05
			show(token, at, 0.12, 0.92)
			to(token, 'x', at, at + 0.3, x + width / 2, 'Cubic.Out')
			// The page scrolls: every line goes up, the top ones leave first.
			to(token, 'y', 7.75, 8.75, y - 150, 'Cubic.InOut')
			to(token, 'opacity', 7.85 + line * 0.035, 8.25 + line * 0.035, 0, 'Quadratic.In')
			stream.push(token)
			x += width + 8
		}
	}
	const working = scene.textFrom('Working', 'Generating', soft, 11, 150, 98)
	rise(working, 6.3, 8)
	;[0, 1, 2].forEach(i => {
		const dot = scene.dot(`Working ${i + 1}`, orange, 5, 150 + textWidth('Generating', 11) * 1.15 + 8 + i * 9, 99)
		show(dot, 6.4, 0.15)
		for (let beat = 0; beat < 3; beat++) pulse(dot, 6.5 + i * 0.13 + beat * 0.45, 1.9, 0.36)
		hide(dot, 7.95, 0.2)
	})
	hide(working, 7.95, 0.2)
	for (const part of promptParts) hide(part, 7.9, 0.3)

	// --- 4. The page, on glass.
	const glassEdge = scene.rect('Glass edge', '#ffffff', 536, 286, CX, CY + 4, 22)
	const glass = scene.rect('Glass', '#1b1b21', 532, 282, CX, CY + 4, 20)
	const sheen = scene.rect('Glass rule', '#ffffff', 532, 1, CX, CY + 4 - 141 + 36, 0)
	for (const part of [glassEdge, glass, sheen]) {
		part.values.scale = 0.9
		part.values.y += 26
		to(part, 'scale', 8.2, 9.0, 1, 'Cubic.Out')
		to(part, 'y', 8.2, 9.0, now(part, 'y') - 26, 'Cubic.Out')
	}
	show(glassEdge, 8.2, 0.4, 0.16)
	show(glass, 8.2, 0.4, 0.82)
	show(sheen, 8.4, 0.6, 0.08)

	const top = CY + 4 - 141
	const edge = CX - 266
	;['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) =>
		pop(scene.dot(`Window ${i + 1}`, color, 8, edge + 22 + i * 14, top + 20), 8.75 + i * 0.07, 0.3, 0.2),
	)
	const brand = scene.dot('Brand', orange, 12, edge + 34, top + 54)
	const brandName = scene.textFrom('Brand name', 'studio', white, 13, edge + 46, top + 54)
	pop(brand, 9.0, 0.35, 0.2)
	rise(brandName, 9.05, 8)
	;['Work', 'Motion', 'Pricing', 'About'].forEach((item, i) =>
		rise(scene.text(`Nav ${item}`, item, soft, 10, CX + 40 + i * 58, top + 54), 9.1 + i * 0.07, 8),
	)
	const navMark = scene.rect('Nav mark', orange, 30, 2, CX + 40, top + 66, 1)
	show(navMark, 9.5, 0.2)

	const lines: Array<[string, string, number, number]> = [
		['Headline 1', 'Premium Motion', 32, top + 114],
		['Headline 2', 'Design, in code.', 32, top + 150],
	]
	lines.forEach(([label, text, size, y], i) => {
		const line = scene.text(label, text, white, size, CX, y)
		line.values.scale = 0.94
		rise(line, 9.45 + i * 0.16, 26, 0.75)
		to(line, 'scale', 9.45 + i * 0.16, 10.2 + i * 0.16, 1, 'Cubic.Out')
	})
	const stroke = scene.rect('Headline stroke', orange, 150, 5, CX - 60, top + 173, 2.5)
	show(stroke, 10.05, 0.15)
	to(stroke, 'x', 10.05, 10.6, CX, 'Cubic.Out')
	const lead = scene.text('Lead', 'Timelines, easing curves and keyframes that ship.', soft, 11, CX, top + 198)
	rise(lead, 10.2, 10)

	const ring = scene.rect('Button ring', orange, 132, 38, CX - 70, top + 240, 19)
	const cta = scene.rect('Button', orange, 132, 38, CX - 70, top + 240, 19)
	const ctaText = scene.text('Button text', 'See pricing', ground, 12, CX - 70, top + 240)
	const ghost = scene.rect('Second button', '#ffffff', 132, 38, CX + 76, top + 240, 19)
	const ghostText = scene.text('Second button text', 'Watch reel', white, 12, CX + 76, top + 240)
	pop(cta, 10.5, 0.5, 0.5)
	pop(ctaText, 10.56, 0.45, 0.5)
	pop(ghost, 10.6, 0.5, 0.5, 0.1)
	pop(ghostText, 10.66, 0.45, 0.5)
	// The button asks to be pressed: three beats, each sending out a ring.
	for (let beat = 0; beat < 3; beat++) {
		const at = 11.15 + beat * 0.75
		pulse(cta, at, 1.07, 0.6)
		pulse(ctaText, at, 1.07, 0.6)
		jump(ring, 'opacity', at, 0.45)
		jump(ring, 'scale', at - 0.001, 1)
		to(ring, 'scale', at, at + 0.7, 1.45, 'Cubic.Out')
		to(ring, 'opacity', at + 0.001, at + 0.7, 0, 'Quadratic.Out')
	}
	;['60 fps', 'Solid 2', 'three.js'].forEach((chip, i) => {
		const y = top + 102 + i * 30
		rise(scene.rect(`Chip ${chip}`, '#ffffff', 62, 22, edge + 490, y, 11), 10.75 + i * 0.09, 10, 0.4, 0.09)
		rise(scene.text(`Chip ${chip} text`, chip, white, 9, edge + 490, y), 10.8 + i * 0.09, 10, 0.4, 0.85)
	})

	const pointer = scene.pointer(560, 330, true)
	pointer.show(4.9)
	pointer.move(5.0, 5.65, barLeft + 378, 184)
	pointer.click(5.75)
	pointer.move(6.0, 6.6, 590, 300)
	pointer.move(12.3, 13.2, CX - 44, top + 246)
	pointer.click(13.35)
	press(cta, 13.35)
	press(ctaText, 13.35)
	scene.ripple('Button click', white, CX - 44, top + 246, 13.35, 40)
	pointer.hide(13.8)

	// --- 5. The page leaves, and the mark signs off.
	for (const layer of scene.layers.slice(scene.layers.indexOf(glassEdge))) {
		if (pointer.parts.includes(layer) || now(layer, 'opacity') <= 0) continue
		const from = Math.max(
			13.75,
			layer.tracks.opacity.length ? layer.tracks.opacity[layer.tracks.opacity.length - 1].t / 1000 : 0,
		)
		to(layer, 'opacity', from, Math.max(from + 0.05, 14.1), 0, 'Quadratic.In')
	}
	const outro = burst(CX, 150, 38, 14.0, 'Outro')
	const outroCore = scene.dot('Outro core', white, 18, CX, 150)
	pop(outroCore, 14.0, 0.4, 0.2)
	const built = scene.text('Built with', 'Built with tween.js', white, 18, CX, 236)
	rise(built, 14.25, 12)
	for (const part of [...outro, outroCore, built]) to(part, 'opacity', length - 0.6, length - 0.2, 0, 'Quadratic.In')

	return scene.done(length)
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * A dashboard with moving parts: a side bar, numbers that count, bars that
 * grow, a line that draws itself with a reader running along it, and a
 * progress meter. The pointer changes the view twice, and everything answers.
 */
export function dashboard(): Doc {
	const scene = new Scene()
	const ground = '#0e1014'
	const card = '#171a21'
	const raised = '#1f232c'
	const white = '#eceef4'
	const soft = '#858a9a'
	const blue = '#5b8cff'
	const green = '#34d6a0'
	const orange = '#ffb24a'
	const pink = '#ff6b9d'
	const length = 17.2

	scene.rect('Ground', ground, COMP.width, COMP.height, CX, CY, 0, 1)

	// --- The side bar.
	const side = scene.rect('Side bar', card, 112, 336, 68, CY, 14)
	side.values.x = 68 - 40
	show(side, 0.15, 0.4)
	to(side, 'x', 0.15, 0.75, 68, 'Cubic.Out')
	pop(scene.dot('Logo', blue, 18, 32, 34), 0.5, 0.45, 0.2)
	rise(scene.textFrom('Logo name', 'pulse', white, 13, 46, 34), 0.58, 8)
	const navY = (i: number) => 78 + i * 30
	const active = scene.rect('Nav active', raised, 96, 24, 68, navY(0), 8)
	show(active, 0.95, 0.25)
	// Every item is lit the same way: the one in use is opaque, the others are dimmed.
	const DIM = 0.45
	const navDots: Layer[] = []
	const navNames: Layer[] = []
	;['Overview', 'Traffic', 'Revenue', 'Teams', 'Settings'].forEach((item, i) => {
		const dot = scene.rect(`Nav ${item} icon`, blue, 8, 8, 34, navY(i), 2.5)
		const name = scene.textFrom(`Nav ${item}`, item, white, 10, 46, navY(i))
		rise(dot, 0.75 + i * 0.06, 8, 0.5, i ? DIM : 1)
		rise(name, 0.78 + i * 0.06, 8, 0.5, i ? DIM : 1)
		navDots.push(dot)
		navNames.push(name)
	})
	const plan = scene.rect('Plan', raised, 96, 54, 68, 300, 10)
	rise(plan, 1.15, 12)
	rise(scene.textFrom('Plan name', 'Pro plan', white, 10, 30, 288), 1.22, 8)
	rise(scene.textFrom('Plan use', '72% of events', soft, 8, 30, 302), 1.27, 8)
	const usage = scene.rect('Plan meter', '#2c313c', 78, 4, 68, 315, 2)
	const used = scene.rect('Plan meter used', green, 56, 4, 57 - 56, 315, 2)
	show(usage, 1.3)
	show(used, 1.45, 0.1)
	to(used, 'x', 1.45, 2.3, 57, 'Cubic.Out')
	// The meter grows from behind the side bar's own colour.
	scene.rect('Plan meter mask', raised, 9, 10, 24.5, 315, 0, 1)
	scene.rect('Plan meter edge', card, 8, 10, 16, 315, 0, 1)

	// --- The top bar.
	const titleA = scene.textFrom('Title', 'Overview', white, 18, 140, 30)
	const titleB = scene.textFrom('Title 2', 'Traffic', white, 18, 140, 30)
	const titleC = scene.textFrom('Title 3', 'Revenue', white, 18, 140, 30)
	rise(titleA, 0.6, 10)
	const range = scene.rect('Range', card, 96, 24, 520, 30, 12)
	rise(range, 0.8, 8)
	rise(scene.text('Range text', 'Last 30 days', soft, 9, 520, 30), 0.85, 8)
	pop(scene.dot('Avatar', pink, 24, 606, 30), 0.9, 0.4, 0.3)
	rise(scene.text('Avatar text', 'A', ground, 11, 606, 30), 0.98, 6)

	// --- Three numbers. Each counts up twice: the old value leaves upwards, the new one comes from below.
	const figures: Array<[string, string[], string, string]> = [
		['Visitors', ['12.4k', '18.9k', '24.1k'], '+4.2%', green],
		['Sign-ups', ['842', '1,306', '1,718'], '+11%', green],
		['Churn', ['2.9%', '2.4%', '1.8%'], '-0.5', orange],
	]
	const changes = [6.55, 11.75]
	figures.forEach(([label, values, delta, color], i) => {
		const x = 196 + i * 124
		const at = 1.1 + i * 0.12
		const tile = scene.rect(`${label} card`, card, 114, 70, x, 94, 12)
		rise(tile, at, 18, 0.55)
		rise(scene.textFrom(`${label} name`, label, soft, 9, x - 45, 74), at + 0.1, 8)
		const chip = scene.rect(`${label} change`, color, 36, 15, x + 33, 74, 7.5)
		const chipText = scene.text(`${label} change text`, delta, ground, 8, x + 33, 74)
		pop(chip, at + 0.75, 0.4, 0.3, 0.92)
		pop(chipText, at + 0.8, 0.35, 0.3)
		values.forEach((value, step) => {
			const figure = scene.textFrom(`${label} ${step + 1}`, value, white, 22, x - 45, 102)
			if (step === 0) rise(figure, at + 0.2, 12)
			else {
				figure.values.y = 116
				show(figure, changes[step - 1] + i * 0.07 + 0.08, 0.16)
				to(figure, 'y', changes[step - 1] + i * 0.07 + 0.08, changes[step - 1] + i * 0.07 + 0.42, 102, 'Back.Out')
			}
			if (step < values.length - 1) {
				const leave = changes[step] + i * 0.07
				to(figure, 'y', leave, leave + 0.22, 90, 'Quadratic.In')
				hide(figure, leave, 0.2)
			}
		})
		changes.forEach((change, step) => {
			pulse(chip, change + i * 0.07 + 0.3, 1.18, 0.4)
			pulse(chipText, change + i * 0.07 + 0.3, 1.18, 0.4)
			void step
		})
	})

	// --- A meter, top right: twenty segments that fill.
	const meterX = 568
	const meter = scene.rect('Goal card', card, 114, 70, meterX, 94, 12)
	rise(meter, 1.46, 18, 0.55)
	rise(scene.textFrom('Goal name', 'Monthly goal', soft, 9, meterX - 45, 74), 1.56, 8)
	const goals = ['38%', '64%', '90%']
	const filled = [8, 13, 18]
	goals.forEach((value, step) => {
		const figure = scene.textFrom(`Goal ${step + 1}`, value, white, 22, meterX - 45, 98)
		if (step === 0) rise(figure, 1.66, 12)
		else {
			show(figure, changes[step - 1] + 0.35, 0.16)
			figure.values.scale = 0.8
			to(figure, 'scale', changes[step - 1] + 0.35, changes[step - 1] + 0.7, 1, 'Back.Out')
		}
		if (step < goals.length - 1) hide(figure, changes[step] + 0.25, 0.14)
	})
	for (let i = 0; i < 20; i++) {
		const x = meterX - 47 + i * 5
		rise(scene.rect(`Goal track ${i + 1}`, '#2a2f3a', 3, 8, x, 118, 1.5), 1.75 + i * 0.012, 4, 0.25)
		const segment = scene.rect(`Goal ${i + 1}`, i < 13 ? blue : green, 3, 8, x, 118, 1.5)
		const step = filled.findIndex(count => i < count)
		const at = step === 0 ? 2.1 + i * 0.05 : changes[step - 1] + 0.3 + (i - filled[step - 1]) * 0.06
		if (step >= 0) pop(segment, at, 0.25, 0.2)
	}

	// --- Bars, bottom left: twelve, growing from the floor of the card.
	const floor = 318
	const bars = scene.rect('Bars card', card, 238, 190, 258, 245, 12)
	rise(bars, 1.6, 20, 0.6)
	rise(scene.textFrom('Bars name', 'Sessions per day', white, 10, 152, 166), 1.75, 8)
	rise(scene.textFrom('Bars note', 'thousands', soft, 8, 152, 180), 1.8, 8)
	;[0, 1, 2].forEach(i =>
		show(scene.rect(`Bars rule ${i + 1}`, '#232833', 214, 1, 258, floor - 30 - i * 30, 0), 1.95 + i * 0.05, 0.3),
	)
	const heights = [
		[34, 52, 44, 70, 58, 86, 64, 48, 76, 92, 60, 72],
		[56, 40, 72, 50, 88, 62, 96, 70, 54, 78, 100, 84],
		[70, 84, 60, 96, 74, 104, 82, 110, 92, 78, 106, 98],
	]
	const columns: Layer[] = []
	for (let i = 0; i < 12; i++) {
		const x = 158 + i * 18.2
		const tall = 112
		const column = scene.rect(`Bar ${i + 1}`, '#39445f', 11, tall, x, floor + tall / 2, 4)
		show(column, 2.0, 0.05)
		to(column, 'y', 2.05 + i * 0.045, 2.75 + i * 0.045, floor + tall / 2 - heights[0][i], 'Back.Out')
		changes.forEach((change, step) => {
			const at = change + 0.1 + i * 0.03
			to(column, 'y', at, at + 0.7, floor + tall / 2 - heights[step + 1][i], curve('Overshoot'))
		})
		columns.push(column)
	}
	// The tallest bar is lit. When the view changes the light sinks, and comes up where the new tallest is.
	const tallest = (step: number) => heights[step].indexOf(Math.max(...heights[step]))
	const lit = scene.rect('Bar lit', blue, 11, 112, 158 + tallest(0) * 18.2, floor + 56, 4)
	show(lit, 2.0, 0.05)
	to(lit, 'y', 2.05 + tallest(0) * 0.045, 2.75 + tallest(0) * 0.045, floor + 56 - heights[0][tallest(0)], 'Back.Out')
	changes.forEach((change, step) => {
		to(lit, 'y', change, change + 0.3, floor + 56, 'Quadratic.In')
		jump(lit, 'x', change + 0.3, 158 + tallest(step + 1) * 18.2)
		to(lit, 'y', change + 0.35, change + 1.05, floor + 56 - heights[step + 1][tallest(step + 1)], curve('Overshoot'))
	})
	// What is below the floor is hidden: by the card's own colour, then by the ground's.
	scene.rect('Bars floor', card, 238, 22, 258, floor + 11, 0, 0)
	scene.rect('Bars below', ground, 250, 30, 258, floor + 22 + 15, 0, 1)
	const barsFloor = scene.layers[scene.layers.length - 2]
	show(barsFloor, 1.95, 0.1)
	const barsFoot = scene.rect('Bars foot', card, 238, 20, 258, floor + 12, 10)
	show(barsFoot, 1.95, 0.1)
	;['Mon', 'Thu', 'Sun', 'Wed'].forEach((day, i) =>
		rise(scene.text(`Bars day ${day}`, day, soft, 7, 158 + i * 54.6 + 9, floor + 10), 2.5 + i * 0.06, 6),
	)
	// A note that follows the tallest bar.
	const note = scene.rect(
		'Bars note card',
		white,
		40,
		18,
		158 + tallest(0) * 18.2,
		floor - heights[0][tallest(0)] - 14,
		6,
	)
	const noteText = scene.text('Bars note text', '9.2k', ground, 9, now(note, 'x'), now(note, 'y'))
	const noteTexts = ['10.0k', '11.0k'].map(value =>
		scene.text(`Bars note ${value}`, value, ground, 9, now(note, 'x'), now(note, 'y')),
	)
	pop(note, 3.5, 0.4, 0.3)
	pop(noteText, 3.55, 0.35, 0.3)
	changes.forEach((change, step) => {
		const x = 158 + tallest(step + 1) * 18.2
		const y = floor - heights[step + 1][tallest(step + 1)] - 14
		for (const part of [note, noteText, ...noteTexts]) {
			to(part, 'x', change + 0.15, change + 0.85, x, 'Cubic.InOut')
			to(part, 'y', change + 0.15, change + 0.85, y, 'Cubic.InOut')
		}
		hide(step ? noteTexts[step - 1] : noteText, change + 0.3, 0.12)
		show(noteTexts[step], change + 0.45, 0.14)
	})

	// --- A line, bottom right: points joined by strokes, and a reader that runs along it.
	const lineLeft = 404
	const base = 318
	const line = scene.rect('Line card', card, 228, 190, 506, 245, 12)
	rise(line, 1.75, 20, 0.6)
	rise(scene.textFrom('Line name', 'Revenue', white, 10, lineLeft, 166), 1.9, 8)
	rise(scene.textFrom('Line note', 'this month', soft, 8, lineLeft, 180), 1.95, 8)
	;[0, 1, 2].forEach(i =>
		show(scene.rect(`Line rule ${i + 1}`, '#232833', 204, 1, 506, base - 30 - i * 30, 0), 2.1 + i * 0.05, 0.3),
	)
	const levels = [22, 34, 28, 46, 40, 58, 52, 70, 64, 80, 74, 96, 88, 108]
	const pointX = (i: number) => lineLeft + 4 + i * 15.2
	const pointY = (i: number) => base - 12 - levels[i]
	for (let i = 0; i < levels.length - 1; i++) {
		const dx = pointX(i + 1) - pointX(i)
		const dy = pointY(i + 1) - pointY(i)
		const stroke = scene.rect(
			`Line stroke ${i + 1}`,
			green,
			Math.hypot(dx, dy) + 1,
			2,
			pointX(i) + dx / 2,
			pointY(i) + dy / 2,
			1,
		)
		stroke.values.rotation = (Math.atan2(dy, dx) * 180) / Math.PI
		stroke.values.scale = 0.2
		const at = 2.75 + i * 0.075
		show(stroke, at, 0.1, 0.9)
		to(stroke, 'scale', at, at + 0.2, 1, 'Cubic.Out')
	}
	levels.forEach((_, i) => {
		const point = scene.dot(
			`Line point ${i + 1}`,
			i === levels.length - 1 ? white : green,
			i === levels.length - 1 ? 7 : 5,
			pointX(i),
			pointY(i),
		)
		pop(point, 2.7 + i * 0.075, 0.3, 0.2)
	})
	// The reader: a hairline with a dot that keeps to the line, and the value it reads.
	const hair = scene.rect('Reader line', '#3a4152', 1, 124, pointX(0), base - 68, 0)
	const reader = scene.dot('Reader', white, 9, pointX(0), pointY(0))
	const readerRing = scene.dot('Reader ring', green, 17, pointX(0), pointY(0))
	const tip = scene.rect('Reader card', raised, 44, 18, pointX(0), pointY(0) - 20, 6)
	const tipTexts = ['$2.1k', '$4.6k', '$7.9k', '$11k'].map(value =>
		scene.text(`Reader ${value}`, value, white, 9, pointX(0), pointY(0) - 20),
	)
	const sweeps: Array<[number, number, number]> = [
		[4.1, 6.3, 13],
		[7.6, 9.4, 4],
		[9.7, 11.5, 13],
		[12.9, 14.6, 8],
	]
	show(hair, 4.0, 0.2)
	show(readerRing, 4.0, 0.2, 0.3)
	pop(reader, 4.0, 0.3, 0.3)
	pop(tip, 4.05, 0.3, 0.4)
	show(tipTexts[0], 4.1, 0.15)
	let from = 0
	for (const [start, end, target] of sweeps) {
		const steps = Math.abs(target - from)
		const direction = Math.sign(target - from)
		for (let step = 1; step <= steps; step++) {
			const i = from + step * direction
			const begin = start + ((end - start) * (step - 1)) / steps
			const finish = start + ((end - start) * step) / steps
			for (const part of [reader, readerRing]) {
				to(part, 'x', begin, finish, pointX(i), 'Linear.None')
				to(part, 'y', begin, finish, pointY(i), 'Linear.None')
			}
			to(hair, 'x', begin, finish, pointX(i), 'Linear.None')
			for (const part of [tip, ...tipTexts]) {
				to(part, 'x', begin, finish, Math.min(pointX(i), 590), 'Linear.None')
				to(part, 'y', begin, finish, pointY(i) - 20, 'Linear.None')
			}
		}
		from = target
	}
	// What it reads changes as it passes.
	;[5.0, 5.8, 6.25].forEach((at, i) => {
		hide(tipTexts[i], at, 0.1)
		show(tipTexts[i + 1], at + 0.08, 0.12)
	})
	;[8.4, 10.6].forEach((at, i) => {
		const leaving = i ? tipTexts[1] : tipTexts[3]
		const coming = i ? tipTexts[3] : tipTexts[1]
		hide(leaving, at, 0.1)
		show(coming, at + 0.08, 0.12)
	})
	hide(tipTexts[3], 13.7, 0.1)
	show(tipTexts[2], 13.78, 0.12)
	for (let beat = 0; beat < 3; beat++) pulse(readerRing, 14.75 + beat * 0.5, 1.5, 0.45)

	// --- A message, when the export is done.
	const done = scene.rect('Message', white, 196, 36, CX + 60, 380, 12, 1)
	const doneDot = scene.dot('Message dot', green, 10, CX - 20, 380, 1)
	const doneText = scene.text('Message text', 'Report exported', ground, 11, CX + 66, 380, 1)
	for (const part of [done, doneDot, doneText]) {
		to(part, 'y', 14.9, 15.45, 332, curve('Overshoot'))
		to(part, 'y', 16.25, 16.6, 380, 'Cubic.In')
	}

	// --- The pointer changes the view twice: the side bar, the title, the numbers and the bars all answer.
	const pointer = scene.pointer(300, 340, true)
	pointer.show(5.5)
	;[1, 2].forEach((item, step) => {
		const at = changes[step]
		pointer.move(at - 0.85, at - 0.15, 86, navY(item) + 4)
		pointer.click(at - 0.05)
		scene.ripple(`Nav click ${step + 1}`, blue, 86, navY(item) + 4, at - 0.05, 30)
		to(active, 'y', at, at + 0.4, navY(item), curve('Overshoot'))
		const [leaving, coming] = step ? [titleB, titleC] : [titleA, titleB]
		to(leaving, 'x', at, at + 0.25, now(leaving, 'x') - 14, 'Quadratic.In')
		hide(leaving, at, 0.2)
		coming.values.x += 14
		show(coming, at + 0.2, 0.2)
		to(coming, 'x', at + 0.2, at + 0.55, now(coming, 'x') - 14, 'Cubic.Out')
		pulse(navDots[item], at, 1.6, 0.4)
		for (const part of [navDots[item], navNames[item]]) to(part, 'opacity', at, at + 0.3, 1, 'Quadratic.Out')
		for (const part of [navDots[item - 1], navNames[item - 1]]) to(part, 'opacity', at, at + 0.3, DIM, 'Quadratic.Out')
		if (!step) pointer.move(at + 0.6, at + 1.4, 150, 300)
	})
	pointer.move(12.6, 13.4, 330, 344)
	pointer.hide(13.6)

	scene.clear(length - 0.75, 0.5, [scene.layers[0]])
	return scene.done(length)
}
