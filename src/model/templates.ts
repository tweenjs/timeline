import {bake, isStill} from './bake'
import {curve, easingByName} from './curveTools'
import {dashboard, launchFilm, signIn} from './motion'
import {BLACK_HOLE} from './scenes'
import {COMP, PROPS, createLayer, key, presetEase, type Doc, type Layer, type Prop, type Shape} from './types'

/**
 * Ready-made timelines: five 3D-looking scenes made of flat layers, and one
 * real 3D scene (the black hole, drawn with three.js).
 *
 * The editor is flat: a layer has a position, a scale, a rotation and an
 * opacity. Depth is drawn the way a 2D animator would: each scene is written
 * as 3D motion, projected, and baked into ordinary keyframes (see bake.ts).
 * Far things are smaller and dimmer, and something that passes behind another
 * is a pair of layers, one above and one below, that swap at the crossing.
 * Every scene loops, and every layer, keyframe and easing can be edited.
 */

export type Template = {name: string; description: string; make: () => Doc}

const CX = COMP.width / 2
const CY = COMP.height / 2
const TOLERANCE: Record<Prop, number> = {x: 0.5, y: 0.5, scale: 0.01, rotation: 0.3, opacity: 0.015}

const rad = (degrees: number) => (degrees * Math.PI) / 180
/** A value by depth: `far` at -1 (away from the viewer), `near` at 1. */
const depth = (z: number, far: number, near: number) => far + ((near - far) * (z + 1)) / 2
const pad = (index: number) => String(index + 1).padStart(2, '0')

function mix(from: string, to: string, amount: number): string {
	const channel = (color: string, i: number) => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16)
	return (
		'#' +
		[0, 1, 2]
			.map(i =>
				Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount)
					.toString(16)
					.padStart(2, '0'),
			)
			.join('')
	)
}

/** A layer, folded in the timeline: these scenes have dozens. */
function shape(name: string, kind: Shape, color: string, width: number, height = width): Layer {
	const layer = createLayer(0, {name, shape: kind, color, width, height})
	layer.closed = true
	return layer
}

type Pose = Partial<Record<Prop, number>>

/**
 * Bakes a motion into the tracks of a layer. Properties that never move stay
 * plain values. `more` adds breaks for single properties.
 */
function animate(
	layer: Layer,
	breaks: number[],
	pose: (time: number) => Pose,
	more: Partial<Record<Prop, number[]>> = {},
): Layer {
	for (const prop of PROPS) {
		const fallback = layer.values[prop]
		const keyframes = bake(time => pose(time)[prop] ?? fallback, [...breaks, ...(more[prop] ?? [])], TOLERANCE[prop])
		if (isStill(keyframes)) layer.values[prop] = keyframes[0].v
		else layer.tracks[prop] = keyframes
	}
	return layer
}

/**
 * The times at which a rotation passes a quarter turn. Between them, each
 * coordinate of a point on a circle is exactly a sine easing.
 */
function quarters(phase: number, period: number, duration: number): number[] {
	const times = [0, duration]
	const end = phase + (360 * duration) / period
	for (let k = Math.ceil(phase / 90); k * 90 <= end; k++) times.push(((k * 90 - phase) * period) / 360)
	return times
}

/** The times around which `front` changes: a pair of breaks, one millisecond apart, per change. */
function flips(front: (time: number) => boolean, duration: number): number[] {
	const times: number[] = []
	for (let time = 0; time < duration; time++) if (front(time) !== front(time + 1)) times.push(time, time + 1)
	return times
}

/**
 * A layer that passes in front of and behind something: two layers, of
 * which one shows at a time. Returns [front, back].
 */
function passing(
	make: (suffix: string) => Layer,
	breaks: number[],
	duration: number,
	pose: (time: number) => Pose & {z: number},
): [Layer, Layer] {
	const front = (time: number) => pose(time).z > 0
	const all = [...breaks, ...flips(front, duration)]
	const show = (side: boolean) => (time: number) => {
		const {z: _z, ...rest} = pose(time)
		// A break sits on a whole millisecond: decide there, so a change is a clean step.
		return front(Math.round(time)) === side ? rest : {...rest, opacity: 0}
	}
	return [animate(make(' (front)'), all, show(true)), animate(make(' (back)'), all, show(false))]
}

/** A sphere of dots turning on a tilted axis, with a satellite. */
function globe(): Doc {
	const turn = 6000
	const radius = 118
	const count = 40
	const tilt = rad(22)
	const layers: Layer[] = []

	for (let i = 0; i < count; i++) {
		// Evenly spread points: a spiral from pole to pole.
		const height = 1 - (2 * i + 1) / count
		const ring = Math.sqrt(1 - height * height)
		const longitude = (i * 137.508) % 360
		const dot = shape('Dot ' + pad(i), 'circle', mix('#4dabf7', '#b197fc', (height + 1) / 2), 11)

		layers.push(
			animate(dot, quarters(longitude, turn, turn), time => {
				const angle = rad(longitude + (360 * time) / turn)
				const x = ring * Math.sin(angle)
				const spin = ring * Math.cos(angle)
				const y = height * Math.cos(tilt) - spin * Math.sin(tilt)
				const z = height * Math.sin(tilt) + spin * Math.cos(tilt)
				return {x: CX + radius * x, y: CY - radius * y, scale: depth(z, 0.4, 1.2), opacity: depth(z, 0.18, 1)}
			}),
		)
	}

	const satellite = shape('Satellite', 'circle', '#ffd43b', 12)
	const orbit = turn / 2
	layers.unshift(
		animate(satellite, quarters(30, orbit, turn), time => {
			const angle = rad(30 + (360 * time) / orbit)
			const x = 176 * Math.cos(angle)
			const y = 176 * Math.sin(angle) * 0.3
			const roll = rad(-20)
			return {
				x: CX + x * Math.cos(roll) - y * Math.sin(roll),
				y: CY + x * Math.sin(roll) + y * Math.cos(roll),
				scale: depth(Math.sin(angle), 0.6, 1.35),
				opacity: depth(Math.sin(angle), 0.45, 1),
			}
		}),
	)

	const halo = shape('Halo', 'circle', '#4dabf7', 262)
	halo.values = {...halo.values, x: CX, y: CY, opacity: 0.07}
	halo.tracks.scale = [
		key(0, 1, presetEase('Sinusoidal.InOut')),
		key(turn / 2, 1.08, presetEase('Sinusoidal.InOut')),
		key(turn, 1),
	]
	layers.push(halo)

	return {duration: turn, layers}
}

/** A double helix turning on its long axis. */
function helix(): Doc {
	const turn = 4000
	const radius = 64
	const count = 14
	const strands: Layer[][] = [[], []]
	const rungs: Layer[] = []

	for (let i = 0; i < count; i++) {
		const x = 68 + (i * 504) / (count - 1)
		const twist = i * 30
		const breaks = quarters(twist, turn, turn)

		for (const side of [0, 1]) {
			const dot = shape(`${side ? 'B' : 'A'} ${pad(i)}`, 'circle', side ? '#f783ac' : '#4dabf7', 17)
			dot.values.x = x
			strands[side].push(
				animate(dot, breaks, time => {
					const angle = rad(twist + side * 180 + (360 * time) / turn)
					const z = Math.sin(angle)
					return {y: CY + radius * Math.cos(angle), scale: depth(z, 0.6, 1.2), opacity: depth(z, 0.35, 1)}
				}),
			)
		}

		// The rung between the two is seen edge on twice a turn: it scales through zero.
		const rung = shape('Rung ' + pad(i), 'rect', '#5c6370', 3, radius * 2)
		rung.values = {...rung.values, x, y: CY, opacity: 0.7}
		rungs.push(animate(rung, breaks, time => ({scale: Math.cos(rad(twist + (360 * time) / turn))})))
	}

	return {duration: turn, layers: [...strands[0], ...strands[1], ...rungs]}
}

/** Three moons circling a planet, passing in front of it and behind it. */
function planet(): Doc {
	const duration = 8000
	const moons = [
		{name: 'Io', radius: 96, period: duration / 2, start: 40, roll: -16, size: 15, color: '#ffd43b'},
		{name: 'Europa', radius: 146, period: duration, start: 130, roll: 10, size: 22, color: '#74c0fc'},
		{name: 'Titan', radius: 196, period: duration / 3, start: 250, roll: -6, size: 12, color: '#b197fc'},
	]
	const above: Layer[] = []
	const below: Layer[] = []

	for (const moon of moons) {
		// A circle seen from a low angle is a flat ellipse; `roll` turns it on the screen.
		const place = (angle: number) => {
			const x = moon.radius * Math.cos(angle)
			const y = moon.radius * Math.sin(angle) * 0.32
			const roll = rad(moon.roll)
			return {
				x: CX + x * Math.cos(roll) - y * Math.sin(roll),
				y: CY + x * Math.sin(roll) + y * Math.cos(roll),
				z: Math.sin(angle),
			}
		}

		const [front, back] = passing(
			suffix => shape(moon.name + suffix, 'circle', moon.color, moon.size),
			quarters(moon.start, moon.period, duration),
			duration,
			time => {
				const at = place(rad(moon.start + (360 * time) / moon.period))
				return {...at, scale: depth(at.z, 0.7, 1.25)}
			},
		)
		above.push(front)
		below.push(back)

		// The orbit, as a dotted line. Its far half is behind the planet.
		for (let i = 0; i < 16; i++) {
			const at = place(rad(i * 22.5 + 11.25))
			const dot = shape(`${moon.name} orbit ${pad(i)}`, 'circle', '#8a909c', 4)
			dot.values = {
				...dot.values,
				x: Math.round(at.x),
				y: Math.round(at.y),
				opacity: +depth(at.z, 0.3, 0.7).toFixed(2),
			}
			;(at.z > 0 ? above : below).push(dot)
		}
	}

	const body = shape('Planet', 'circle', '#ffa94d', 84)
	body.values = {...body.values, x: CX, y: CY}
	const shine = shape('Planet shine', 'circle', '#ffffff', 28)
	shine.values = {...shine.values, x: CX - 17, y: CY - 19, opacity: 0.22}
	const glow = shape('Planet glow', 'circle', '#ffa94d', 136)
	glow.values = {...glow.values, x: CX, y: CY}
	const breathe = presetEase('Sinusoidal.InOut')
	glow.tracks.scale = [
		key(0, 1, breathe),
		key(2000, 1.14, breathe),
		key(4000, 1, breathe),
		key(6000, 1.14, breathe),
		key(duration, 1),
	]
	glow.tracks.opacity = [
		key(0, 0.14, breathe),
		key(2000, 0.26, breathe),
		key(4000, 0.14, breathe),
		key(6000, 0.26, breathe),
		key(duration, 0.14),
	]

	// Stars twinkle out of step. The positions are fixed, not random: a template is the same every time.
	const stars: Layer[] = []
	for (let i = 0; i < 14; i++) {
		const star = shape('Star ' + pad(i), 'circle', '#d7dae0', 2 + (i % 3))
		star.values = {...star.values, x: 24 + ((i * 211) % 592), y: 18 + ((i * 127) % 324)}
		const beat = duration / (2 + (i % 3))
		const offset = (i * 370) % beat
		const twinkle = (time: number) => 0.5 + 0.4 * Math.cos(rad((360 * (time + offset)) / beat))
		stars.push(animate(star, quarters((360 * offset) / beat, beat, duration), time => ({opacity: twinkle(time)})))
	}

	return {duration, layers: [...above, shine, body, glow, ...below, ...stars]}
}

/** Five cards on a ring. It turns one card at a time; cards at the back are behind those at the front. */
function carousel(): Doc {
	const count = 5
	const step = 1200
	const travel = 760
	const duration = count * step
	const smooth = easingByName.get('Cubic.InOut')!
	const colors = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc']

	/** How many cards the ring has turned by: it moves, then rests. */
	const turned = (time: number) => {
		const index = Math.min(count - 1, Math.floor(time / step))
		return index + smooth(Math.min(1, (time - index * step) / travel))
	}
	const breaks: number[] = [0, duration]
	// The ring speeds up, then slows down: each half of a move is its own stretch.
	for (let i = 0; i < count; i++) breaks.push(i * step, i * step + travel / 2, i * step + travel)

	const front: Layer[] = []
	const back: Layer[] = []

	for (let i = 0; i < count; i++) {
		const card = passing(
			suffix => shape(`Card ${pad(i)}${suffix}`, 'rect', colors[i], 104, 140),
			breaks,
			duration,
			time => {
				const angle = rad((i - turned(time)) * (360 / count))
				const z = Math.cos(angle)
				return {
					x: CX + 214 * Math.sin(angle),
					y: CY - 12 - 16 * z,
					scale: depth(z, 0.5, 1.08),
					// A card at the front is solid, or the ones behind it would show through.
					opacity: z > 0 ? 1 : depth(z, 0.35, 0.8),
					z,
				}
			},
		)
		front.push(card[0])
		back.push(card[1])
	}

	// A pager: the dot of the card at the front grows.
	const pager: Layer[] = []
	for (let i = 0; i < count; i++) {
		const dot = shape('Pager ' + pad(i), 'circle', colors[i], 8)
		dot.values = {...dot.values, x: CX + (i - (count - 1) / 2) * 20, y: 332}
		pager.push(
			animate(dot, breaks, time => {
				const away = Math.abs(((i - turned(time) + count * 1.5) % count) - count / 2)
				const active = Math.max(0, 1 - away)
				return {scale: 1 + 0.9 * active, opacity: 0.35 + 0.65 * active}
			}),
		)
	}

	// Cards at the front are above everything at the back.
	return {duration, layers: [...pager, ...front, ...back]}
}

/** Rings of lights rush past the viewer, twisting as they come. */
function warp(): Doc {
	const flight = 3600
	const rings = 5
	const perRing = 10
	const far = 9
	const near = 0.7
	const colors = ['#4dabf7', '#74c0fc', '#b197fc', '#f783ac', '#ffd43b', '#69db7c']
	const layers: Layer[] = []

	for (let ring = 0; ring < rings; ring++) {
		// Rings follow each other: each is `lead` ahead of the next.
		const lead = (ring * flight) / rings
		const wrap = (flight - lead) % flight
		/** 0 far away, 1 past the viewer. At the wrap it is still 1: the jump back follows it. */
		const progress = (time: number) => {
			const local = (time + lead) % flight
			return local === 0 ? 1 : local / flight
		}
		const later = (amount: number) =>
			wrap + amount * flight > flight ? wrap + amount * flight - flight : wrap + amount * flight
		// Motion in perspective speeds up towards the viewer: a stretch per halving of the distance.
		const breaks = [0, flight, wrap, wrap + 1]
		for (let z = far / 2; z > near; z /= 2) breaks.push(later((far - z) / (far - near)))
		const fades = [later(0.14), later(0.9)]

		for (let i = 0; i < perRing; i++) {
			const light = shape(`Light ${ring + 1}.${pad(i)}`, 'circle', colors[ring], 10)
			layers.push(
				animate(
					light,
					breaks,
					time => {
						const amount = progress(time)
						const z = far + (near - far) * amount
						const angle = rad((i * 360) / perRing + ring * 22 + 80 * amount)
						// Perspective: everything is divided by its distance.
						return {
							x: CX + (260 / z) * Math.cos(angle),
							y: CY + (260 / z) * Math.sin(angle),
							scale: 3 / z,
							opacity: Math.min(1, amount / 0.14, (1 - amount) / 0.1),
						}
					},
					{opacity: fades},
				),
			)
		}
	}

	const core = shape('Core', 'circle', '#74c0fc', 46)
	core.values = {...core.values, x: CX, y: CY}
	const pulse = presetEase('Sinusoidal.InOut')
	core.tracks.scale = [
		key(0, 0.8, pulse),
		key(flight / 4, 1.25, pulse),
		key(flight / 2, 0.8, pulse),
		key((flight * 3) / 4, 1.25, pulse),
		key(flight, 0.8),
	]
	core.tracks.opacity = [
		key(0, 0.18, pulse),
		key(flight / 4, 0.4, pulse),
		key(flight / 2, 0.18, pulse),
		key((flight * 3) / 4, 0.4, pulse),
		key(flight, 0.18),
	]
	layers.push(core)

	return {duration: flight, layers}
}

/**
 * A black hole, simulated in 3D with three.js. The scene is the layer's own
 * code, scene3d/blackhole.js, which is in the code panel with the timeline. The
 * timeline flies the camera: `rotation` is where it is on its orbit around the
 * hole, and `scale` how close.
 */
function blackHole(): Doc {
	const duration = 16000
	const smooth = presetEase('Sinusoidal.InOut')

	const hole = createLayer(0, {
		name: 'Black hole',
		shape: 'three',
		scene: BLACK_HOLE,
		color: '#000000',
		width: COMP.width,
		height: COMP.height,
	})
	hole.values = {...hole.values, x: CX, y: CY}
	// Once around, and back where it started: the scene loops.
	hole.tracks.rotation = [key(0, -70), key(duration, 290)]
	// Far out, then in close over the disk, and out again.
	hole.tracks.scale = [key(0, 1, smooth), key(6500, 1.5, smooth), key(9500, 1.5, smooth), key(duration, 1)]

	const caption = createLayer(1, {
		name: 'Caption',
		shape: 'text',
		text: 'BLACK HOLE · BINARY SYSTEM',
		color: '#d7dae0',
		height: 12,
	})
	caption.values = {...caption.values, x: 116, y: 338}
	caption.tracks.opacity = [
		key(0, 0, presetEase('Quadratic.Out')),
		key(1200, 0.7),
		key(14500, 0.7, presetEase('Quadratic.In')),
		key(duration, 0),
	]

	const note = createLayer(2, {
		name: 'Note',
		shape: 'text',
		text: 'three.js · traced light · Kepler orbits',
		color: '#8a909c',
		height: 10,
	})
	note.values = {...note.values, x: 516, y: 339}
	note.tracks.opacity = [
		key(800, 0, presetEase('Quadratic.Out')),
		key(2200, 0.6),
		key(14000, 0.6, presetEase('Quadratic.In')),
		key(15600, 0),
	]

	return {duration, layers: [caption, note, hole]}
}

/** Built once: baking a scene takes a moment. */
function once(make: () => Doc): () => Doc {
	let made: string | undefined
	return () => JSON.parse((made ??= JSON.stringify(make())))
}

export const templates: Template[] = [
	{name: 'Dot globe', description: 'A sphere of dots on a tilted axis', make: once(globe)},
	{name: 'Double helix', description: 'Two strands turning in depth', make: once(helix)},
	{name: 'Planet and moons', description: 'Orbits that pass behind and in front', make: once(planet)},
	{name: 'Card carousel', description: 'A ring of cards, one step at a time', make: once(carousel)},
	{name: 'Warp tunnel', description: 'Rings of light in perspective', make: once(warp)},
	{name: 'Sign-in flow', description: 'A button, a form, a code and a profile', make: once(signIn)},
	{name: 'Launch film', description: 'A prompt, streaming code and the page it makes', make: once(launchFilm)},
	{name: 'Dashboard', description: 'Numbers that count, bars, a line and a pointer', make: once(dashboard)},
	{
		name: 'Black hole',
		description: 'three.js: light traced around a hole, with planets',
		make: once(blackHole),
	},
]

/** The timeline a new editor opens with. */
export function demo(): Doc {
	const title = createLayer(0, {name: 'Title', shape: 'text', text: 'tween.js', color: '#ffd43b', height: 44})
	title.values = {...title.values, x: 320, y: 300}
	title.tracks.opacity = [key(200, 0, presetEase('Quadratic.Out')), key(1000, 1)]
	title.tracks.y = [key(200, 335, curve('Ease out')), key(1000, 300)]

	const ball = createLayer(1, {name: 'Ball', shape: 'circle', color: '#ff6b6b', width: 56, height: 56})
	ball.tracks.x = [key(0, 90), key(2400, 550)]
	ball.tracks.y = [key(0, 60, curve('Bounce')), key(1600, 230)]
	ball.tracks.scale = [key(2400, 1, presetEase('Back.In')), key(3000, 0)]

	const card = createLayer(2, {name: 'Card', shape: 'rect', color: '#4dabf7', width: 110, height: 70})
	card.values = {...card.values, y: 150}
	card.tracks.x = [key(600, 130, curve('Overshoot')), key(1800, 420)]
	card.tracks.rotation = [key(1800, 0, presetEase('Cubic.InOut')), key(3400, 180)]

	return {duration: 4000, layers: [title, ball, card]}
}
