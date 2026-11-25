// Model tests: the compiler, the migrations and the templates, without a browser.
// Run with `npm run test-model`. Vite loads the TypeScript modules.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createRequire} from 'node:module'
import {createServer} from 'vite'

const server = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'})
const load = path => server.ssrLoadModule(path)

const {generateCode, parseCode, normalizeDoc} = await load('/src/model/compiler.ts')
const {exporters, importers} = await load('/src/model/migrate.ts')
const {templates, demo} = await load('/src/model/templates.ts')
const {fitCurveNodes, nodesToPath, pathToNodes, easingByName, curvePresets, sampleTrack, trackEasings} =
	await load('/src/model/curveTools.ts')
const {curveEasing, cubicBezier} = await load('/src/model/easingCurve.js')
const {encodeDoc, decodeDoc, encodeCode, decodeCode} = await load('/src/model/share.ts')

test.after(() => server.close())

const all = {Demo: demo, ...Object.fromEntries(templates.map(template => [template.name, template.make]))}

test('cubicBezier matches CSS ease', () => {
	assert.equal(cubicBezier(0.25, 0.1, 0.25, 1)(0.5).toFixed(4), '0.8024')
})

test('built-in easings trace into curves within tolerance', () => {
	for (const [name, easing] of easingByName) {
		const fitted = curveEasing(fitCurveNodes(easing))
		let error = 0
		for (let i = 0; i <= 200; i++) error = Math.max(error, Math.abs(fitted(i / 200) - easing(i / 200)))
		// Circular has vertical tangents, where a small x error is a large y error.
		assert.ok(error < (name.startsWith('Circular') ? 0.06 : 0.012), `${name}: ${error}`)
	}
})

test('curves survive the trip through SVG path data', () => {
	for (const [name, make] of Object.entries(curvePresets)) {
		const nodes = make()
		const back = pathToNodes(nodesToPath(nodes))
		const a = curveEasing(nodes)
		const b = curveEasing(back)
		for (let i = 0; i <= 50; i++) assert.ok(Math.abs(a(i / 50) - b(i / 50)) < 0.002, name)
	}
	assert.equal(nodesToPath(curvePresets.Ease()), 'M0,100 C25,90 25,0 100,0')
	assert.throws(() => pathToNodes('M0,100 A5,5 0 0 1 100,0'), /not supported/)
})

for (const [name, make] of Object.entries(all)) {
	test(`${name}: timeline -> code -> timeline is lossless`, () => {
		const doc = make()
		const code = generateCode(doc)
		const {doc: back, warnings} = parseCode(code)
		assert.deepEqual(warnings, [])
		assert.equal(generateCode(back), code)
		assert.equal(back.duration, doc.duration)
		// Curves are written with three decimals, and read back with the float noise of that.
		const tracks = from =>
			JSON.stringify(
				from.layers.map(layer => layer.tracks),
				(_, v) => (typeof v === 'number' ? +v.toFixed(3) : v),
			)
		assert.equal(tracks(back), tracks(normalizeDoc(doc)))
	})

	for (const dialect of ['es6-tween', 'kute']) {
		test(`${name}: migrates to ${dialect} and back`, () => {
			const doc = make()
			const {doc: back} = importers[dialect](exporters[dialect](doc))

			if (dialect === 'kute') {
				// Kute.js code only holds what moves: still layers and still properties are
				// in the markup it animates. It reads positions and angles as whole numbers,
				// and a tween that changes nothing is not written. So compare what is seen
				// of what moves, not the keyframes.
				const moving = doc.layers.filter(layer => Object.values(layer.tracks).some(track => track.length))
				assert.equal(back.layers.length, moving.length)
				const value = (layer, prop, time) =>
					sampleTrack(layer.tracks[prop], trackEasings(layer.tracks[prop]), time, layer.values[prop])

				back.layers.forEach((layer, i) => {
					for (const prop of Object.keys(layer.tracks)) {
						if (!moving[i].tracks[prop].length) continue
						const slack = prop === 'scale' || prop === 'opacity' ? 0.03 : 1.2
						for (let step = 0; step <= 40; step++) {
							// Off the whole milliseconds, where a layer may swap with its twin.
							const time = (doc.duration * step) / 40 + 0.5
							const difference = Math.abs(value(layer, prop, time) - value(moving[i], prop, time))
							assert.ok(difference <= slack, `${moving[i].name} ${prop} at ${time}ms: off by ${difference}`)
						}
					}
				})
				return
			}

			assert.equal(back.layers.length, doc.layers.length)

			const round = (prop, v) => +v.toFixed(3)
			back.layers.forEach((layer, i) => {
				for (const [prop, track] of Object.entries(doc.layers[i].tracks)) {
					assert.deepEqual(
						layer.tracks[prop].map(k => [k.t, round(prop, k.v)]),
						track.map(k => [k.t, round(prop, k.v)]),
						`${doc.layers[i].name} ${prop}`,
					)
					// Easings come back as the same shape (curves go through path data).
					track.slice(0, -1).forEach((keyframe, k) => {
						const a = keyframe.ease
						const b = layer.tracks[prop][k].ease
						assert.equal(b.type, a.type)
						if (a.type === 'preset') assert.equal(b.name, a.name)
					})
				}
			})
		})
	}
}

test('tween.js code may be written freely', () => {
	const {doc, warnings} = parseCode(`
		const box = {x: 0}
		const dot = {x: 5, name: 'Dot'}
		export const layers = [box, dot]
		const inner = new Timeline()
			.add(new Tween(dot).to({x: 50}, 200).delay(100))
			.add(new Tween(dot).to({y: 9}, 300).easing(k => k * k * k))
		const timeline = new Timeline()
		for (let i = 0; i < 3; i++) timeline.add(new Tween(box).to({x: (i + 1) * 100}, 500).easing(Easing.Back.Out).onUpdate(() => {}))
		timeline.addLabel('late', 2000).add(inner, 'late')
		export default timeline
	`)
	assert.equal(warnings.length, 2)
	assert.deepEqual(
		doc.layers[0].tracks.x.map(k => [k.t, k.v]),
		[
			[0, 0],
			[500, 100],
			[1000, 200],
			[1500, 300],
		],
	)
	assert.deepEqual(
		doc.layers[1].tracks.x.map(k => [k.t, k.v]),
		[
			[2100, 5],
			[2300, 50],
		],
	)
	assert.equal(doc.layers[1].tracks.y[0].ease.type, 'curve')
	assert.equal(doc.duration, 2600)
})

test('code the editor cannot show is refused', () => {
	const refuse = (code, message) => assert.throws(() => parseCode(code), message)
	refuse('const layers = []; const timeline = new Timeline().add(new Tween({}).to({x: 1}))', /not in `layers`/)
	refuse(
		'const o = {}; const layers = [o]; const timeline = new Timeline().add(new Tween(o).to({x: 1}), {repeat: 2})',
		/not supported/,
	)
	refuse(
		'const o = {}; const layers = [o]; const timeline = new Timeline().add(new Tween(o).to({x: 1}), 0).add(new Tween(o).to({x: 1}), 500)',
		/may not overlap/,
	)
	refuse('const layers = [', SyntaxError)
})

test('es6-tween code: started tweens, delays, timelines and OwnEasing', () => {
	const {doc} = importers['es6-tween'](`
		import {Tween, Easing, Timeline, autoPlay} from 'es6-tween'
		import OwnEasing from 'owneasing'
		autoPlay(true)
		const box = {x: 0, y: 10}
		new Tween(box).to({x: 100}, 1000).easing(Easing.Quadratic.InOut).on('update', () => {}).start()
		new Tween(box).to({x: 300}, 500).easing(OwnEasing('M0,100 C25,90 25,0 100,0')).delay(1000).start()
		const dot = {y: 0}
		new Timeline({startTime: 0}).add(new Tween(dot).to({y: 50}, 400), 200).add(new Tween(dot).to({y: 0}, 400), 600).start()
	`)
	assert.equal(doc.layers.length, 2)
	assert.deepEqual(
		doc.layers[0].tracks.x.map(k => [k.t, k.v, k.ease.type === 'preset' ? k.ease.name : 'curve']),
		[
			[0, 0, 'Quadratic.InOut'],
			[1000, 100, 'curve'],
			[1500, 300, 'Linear.None'],
		],
	)
	assert.equal(doc.layers[0].values.y, 10)
	assert.deepEqual(
		doc.layers[1].tracks.y.map(k => [k.t, k.v]),
		[
			[200, 0],
			[600, 50],
			[1000, 0],
		],
	)
})

// es6-tween itself, to check the export against and to learn what its Timeline does.
const es6 = createRequire(import.meta.url)('es6-tween')

/** Plays es6-tween code in es6-tween, with a clock of its own, and reads the objects it animates. */
function playInEs6Tween(code, times, read) {
	const body = code.replace(/^\s*import .*$/gm, '').replace(/^(\s*)export /gm, '$1')
	const OwnEasing = path => curveEasing(pathToNodes(path))
	const {layers, timeline} = new Function(
		'Tween',
		'Timeline',
		'Easing',
		'autoPlay',
		'OwnEasing',
		body + '\nreturn {layers, timeline}',
	)(es6.Tween, es6.Timeline, es6.Easing, () => {}, OwnEasing)
	const zero = 5_000_000
	timeline.start(zero)
	const readings = times.map(time => {
		timeline.update(zero + time)
		return read(layers)
	})
	timeline.stop()
	return readings
}

for (const [name, make] of Object.entries(all)) {
	test(`${name}: the es6-tween export plays the same in es6-tween`, () => {
		const doc = normalizeDoc(make())
		const code = exporters['es6-tween'](doc)
		assert.match(code, /new Timeline\(\{startTime: 0\}\)/)
		const props = ['x', 'y', 'scale', 'rotation', 'opacity']
		// Off the whole milliseconds, where a layer may swap with its twin.
		const times = Array.from({length: 41}, (_, step) => Math.min(doc.duration, (doc.duration * step) / 40 + 0.5))
		const played = playInEs6Tween(code, times, layers => layers.map(layer => props.map(prop => layer[prop])))

		times.forEach((time, at) => {
			doc.layers.forEach((layer, i) => {
				props.forEach((prop, p) => {
					const expected = sampleTrack(layer.tracks[prop], trackEasings(layer.tracks[prop]), time, layer.values[prop])
					const slack = prop === 'scale' || prop === 'opacity' ? 0.01 : 0.5
					const difference = Math.abs(played[at][i][p] - expected)
					assert.ok(difference <= slack, `${layer.name} ${prop} at ${time}ms: off by ${difference}`)
				})
			})
		})
	})
}

// Every way of filling an es6-tween Timeline that works on plain objects. Each is imported, and
// played in es6-tween itself: the two must agree on where every object is, all the way through.
const forms = {
	'add(tween, time)': `new Timeline({startTime: 0})
		.add(new Tween(a).to({x: 100}, 400), 0)
		.add(new Tween(b).to({x: 100}, 400).easing(Easing.Cubic.Out), 400)`,
	'add({from, to, duration}, time): no Tween instance': `new Timeline({startTime: 0})
		.add({from: a, to: {x: 100}, duration: 500}, 0)
		.add({from: b, to: {x: 100}, duration: 500, easing: Easing.Quadratic.In}, 500)`,
	'add({...}) in any key order, with a delay': `new Timeline({startTime: 0})
		.add({duration: 300, delay: 250, to: {x: 100}, from: a}, 0)
		.add({from: b, to: {x: 100}, duration: 600}, 0)`,
	'add({...}) on one object continues from where it is': `new Timeline({startTime: 0})
		.add({from: a, to: {x: 100}, duration: 500}, 0)
		.add({from: a, to: {x: 300}, duration: 500}, 500)
		.add({from: a, to: {y: 90}, duration: 500}, 250)`,
	'add([tween, tween], time)': `new Timeline({startTime: 0})
		.add([new Tween(a).to({x: 100}, 500), new Tween(b).to({x: 100}, 500)], 250)
		.add({from: c, to: {x: 100}, duration: 800}, 0)`,
	'add(tween) without a time, and a label': `new Timeline({startTime: 0})
		.add(new Tween(a).to({x: 100}, 400), 300)
		.add(new Tween(b).to({x: 100}, 200))
		.addLabel('late', 1500)
		.add(new Tween(c).to({x: 100}, 100), 'late')`,
	'to([objects], values, {duration, stagger})': `new Timeline({startTime: 0})
		.to([a, b, c], {x: 100}, {duration: 500, stagger: 250})`,
	'to() at a time, by label': `new Timeline({startTime: 0})
		.to([a, b, c], {x: 100}, {duration: 500, stagger: 250, label: 500})`,
	'to() with mode reverse': `new Timeline({startTime: 0})
		.to([a, b, c], {x: 100}, {duration: 500, stagger: 250, mode: 'reverse'})`,
	'to() with mode sequence': `new Timeline({startTime: 0})
		.to([a, b, c], {x: 100}, {duration: 500, mode: 'sequence'})`,
	'to() with mode async': `new Timeline({startTime: 0})
		.to([a, b, c], {x: 100}, {duration: 500, stagger: 250, mode: 'async'})`,
	'to() with mode oneByOne': `new Timeline({startTime: 0})
		.to([a, b, c], {x: 100}, {duration: 500, mode: 'oneByOne'})`,
	'to() with values from a function': `new Timeline({startTime: 0})
		.to([a, b, c], (i, count) => ({x: (i + 1) * 100, y: count}), {duration: 500})`,
	'to() without parameters': `new Timeline({startTime: 0}).to([a, b], {x: 100})`,
	'an easing for every tween, from the Timeline parameters': `new Timeline({startTime: 0, easing: Easing.Quadratic.In})
		.add({from: a, to: {x: 100}, duration: 500}, 0)`,
	'Timeline.easing() sets the tweens added so far': `new Timeline({startTime: 0})
		.add({from: a, to: {x: 100}, duration: 500}, 0)
		.easing(Easing.Quadratic.In)
		.add({from: b, to: {x: 100}, duration: 500}, 0)`,
}

for (const [name, timeline] of Object.entries(forms)) {
	test(`es6-tween Timeline, ${name}: the import agrees with es6-tween`, () => {
		const code = `
			const a = {x: 0, y: 10}
			const b = {x: 0, y: 10}
			const c = {x: 0, y: 10}
			export const layers = [a, b, c]
			export const timeline = ${timeline}
		`
		const {doc, warnings} = importers['es6-tween'](code)
		assert.deepEqual(warnings, [])
		assert.equal(doc.layers.length, 3)
		assert.ok(
			doc.layers.some(layer => layer.tracks.x.length),
			'something moves',
		)

		const times = Array.from({length: 131}, (_, step) => step * 20 + 0.5)
		const played = playInEs6Tween(code, times, layers => layers.map(layer => [layer.x, layer.y]))
		times.forEach((time, at) => {
			doc.layers.forEach((layer, i) => {
				;['x', 'y'].forEach((prop, p) => {
					const expected = sampleTrack(layer.tracks[prop], trackEasings(layer.tracks[prop]), time, layer.values[prop])
					const difference = Math.abs(played[at][i][p] - expected)
					assert.ok(
						difference < 0.01,
						`layer ${i} ${prop} at ${time}ms: es6-tween ${played[at][i][p]}, import ${expected}`,
					)
				})
			})
		})
	})
}

test('es6-tween Timeline: what does not work in es6-tween is reported, not guessed', () => {
	const head = 'const a = {x: 0}\nconst b = {x: 0}\nexport const layers = [a, b]\nexport const timeline = '
	const read = timeline => importers['es6-tween'](head + timeline)
	const play = (timeline, times) => playInEs6Tween(head + timeline, times, layers => layers.map(layer => layer.x))

	// Without {startTime: 0} the tweens wait for the age of the page: here, forever.
	let code = 'new Timeline().add({from: a, to: {x: 100}, duration: 100}, 0)'
	assert.match(read(code).warnings.join(), /startTime: 0/)
	assert.deepEqual(play(code, [50, 150, 1000]), [
		[0, 0],
		[0, 0],
		[0, 0],
	])

	// A Timeline ends at its longest tween or twice its last position: this one stops at 600 of 700ms.
	code = 'new Timeline({startTime: 0}).add({from: a, to: {x: 100}, duration: 400}, 300)'
	assert.match(read(code).warnings.join(), /ends this Timeline at 600ms, before its last tween ends at 700ms/)
	assert.deepEqual(play(code, [500, 600, 700, 800]), [
		[50, 0],
		[75, 0],
		[75, 0],
		[75, 0],
	])
	// An entry as long as the animation, which animates nothing, keeps it open.
	code += '.add({from: {}, to: {}, duration: 700}, 0)'
	assert.deepEqual(read(code).warnings, [])
	assert.equal(read(code).doc.layers.length, 2)
	assert.deepEqual(play(code, [500, 600, 700, 800]), [
		[50, 0],
		[75, 0],
		[100, 0],
		[100, 0],
	])

	// to() with one plain object adds nothing.
	code = 'new Timeline({startTime: 0}).to(a, {x: 100}, {duration: 100}).add({from: b, to: {x: 100}, duration: 100}, 0)'
	assert.match(read(code).warnings.join(), /adds nothing/)
	assert.equal(play(code, [50, 150])[1][0], 0)

	// to() starts the timeline, which makes what is added next late.
	code = 'new Timeline({startTime: 0}).to([a], {x: 100}, {duration: 100}).to([b], {x: 100}, {duration: 100, label: 0})'
	assert.match(read(code).warnings.join(), /plays what is added after it late/)

	// from() and fromTo() only animate elements: plain objects stay where they are.
	code = 'new Timeline({startTime: 0}).fromTo([a, b], {x: 50}, {x: 100}, {duration: 100})'
	assert.throws(() => read(code), /only animates elements/)
	assert.deepEqual(play(code, [50, 150]), [
		[0, 0],
		[0, 0],
	])
	assert.throws(() => read("new Timeline({startTime: 0}).to([a, b], {x: 1}, {mode: 'shuffle'})"), /random/)
})

test('the es6-tween export keeps its Timeline open to the last keyframe', () => {
	const doc = normalizeDoc({
		duration: 1000,
		layers: [
			{
				name: 'Box',
				tracks: {
					x: [
						{t: 300, v: 0},
						{t: 700, v: 100},
					],
				},
			},
		],
	})
	const code = exporters['es6-tween'](doc)
	assert.match(code, /\.add\(\{from: box, to: \{x: 100\}, duration: 400\}, 300\)/)
	assert.match(code, /\.add\(\{from: \{\}, to: \{\}, duration: 700\}, 0\)/)
	assert.doesNotMatch(code, /Tween\b(?!\.)|Easing/)
	const played = playInEs6Tween(code, [299, 500, 650, 701, 900], layers => layers[0].x)
	assert.deepEqual(played.map(Math.round), [0, 50, 88, 100, 100])

	const {doc: back, warnings} = importers['es6-tween'](code)
	assert.deepEqual(warnings, [])
	assert.deepEqual(
		back.layers.map(layer => layer.tracks.x.map(k => [k.t, k.v])),
		[
			[
				[300, 0],
				[700, 100],
			],
		],
	)
})

test('Kute.js code: selectors, fromTo, chains and easing names', () => {
	const {doc, warnings} = importers.kute(`
		import KUTE from 'kute.js'
		const box = document.querySelector('#box')
		const move = KUTE.fromTo(box, {translateX: 0, opacity: 1}, {translateX: 150, opacity: 0.5}, {duration: 1000, easing: 'easingCubicOut'})
		const spin = KUTE.to('#box', {rotate: 180, width: 10}, {delay: 100})
		move.chain(spin)
		move.start()
		KUTE.to('.dot', {translate: [20, 40]}, {duration: 300, easing: 'linear'}).start()
	`)
	assert.equal(warnings.length, 1)
	assert.deepEqual(
		doc.layers.map(layer => layer.name),
		['box', 'dot'],
	)
	assert.deepEqual(
		doc.layers[0].tracks.x.map(k => [k.t, k.v, k.ease.name]),
		[
			[0, 0, 'Cubic.Out'],
			[1000, 150, 'Linear.None'],
		],
	)
	// The chained tween starts when the first ends, after its own delay. Kute.js defaults to 700ms.
	assert.deepEqual(
		doc.layers[0].tracks.rotation.map(k => [k.t, k.v]),
		[
			[1100, 0],
			[1800, 180],
		],
	)
	assert.deepEqual(
		doc.layers[1].tracks.y.map(k => [k.t, k.v]),
		[
			[0, 0],
			[300, 40],
		],
	)
	assert.throws(() => importers.kute("KUTE.to('#a', {scale: 2}, {repeat: 2}).start()"), /not supported/)
})

test('the Kute.js export nests elements for properties with their own timing', () => {
	const code = exporters.kute(demo())
	// Ball: x and y move on different timings, scale on a third.
	assert.match(code, /<div id="ball"[^>]*><div id="ball-y"[^>]*><div id="ball-scale"><\/div><\/div><\/div>/)
	assert.match(
		code,
		/KUTE\.fromTo\('#ball-y', \{rotate: 0, translateY: 60\}, \{rotate: 0, translateY: 230\}, \{duration: 1600, easing: OwnEasing\('M0,100 C/,
	)
	assert.match(code, /easing: 'easingCubicInOut'/)
})

test('untrusted documents are rebuilt field by field', () => {
	const doc = normalizeDoc({
		duration: 'long',
		extra: 1,
		layers: [
			{
				name: 5,
				color: 'url(https://example.com/x)',
				shape: 'star',
				width: -4,
				tracks: {
					x: [
						{t: 500, v: 1, ease: {type: 'preset', name: 'Nope'}},
						{t: 500, v: 2},
						{t: 'a', v: 3},
						{t: 100, v: 4, ease: {type: 'curve', nodes: [{x: 0}, {x: 1}]}},
					],
				},
			},
			null,
		],
	})
	assert.equal(doc.duration, 1000)
	assert.equal(doc.layers.length, 2)
	assert.equal(doc.layers[0].name, 'Layer 1')
	assert.equal(doc.layers[0].shape, 'rect')
	assert.match(doc.layers[0].color, /^#/)
	assert.equal(doc.layers[0].width, 80)
	assert.deepEqual(
		doc.layers[0].tracks.x.map(k => [k.t, k.v, k.ease.name]),
		[
			[100, 4, 'Linear.None'],
			[500, 1, 'Linear.None'],
		],
	)
	assert.throws(() => normalizeDoc({layers: 'no'}), /not a timeline/)
})

test('a shared link decodes to the same timeline', async () => {
	for (const make of Object.values(all)) {
		const doc = normalizeDoc(make())
		assert.deepEqual(await decodeDoc(await encodeDoc(doc)), doc)
	}
	await assert.rejects(decodeDoc('zNotATimeline'))
})

test('a rectangle keeps its corner radius, and a text its alignment', () => {
	const doc = normalizeDoc({
		duration: 1000,
		layers: [
			{name: 'Pill', shape: 'rect', radius: 20},
			{name: 'Plain', shape: 'rect', radius: 6},
			{name: 'Label', shape: 'text', align: 'left', radius: 9},
			{name: 'Dot', shape: 'circle', radius: 3, align: 'right'},
			{name: 'Odd', shape: 'text', align: 'justify'},
		],
	})
	// Only what differs from the usual is kept, and only on the shape it belongs to.
	assert.deepEqual(
		doc.layers.map(layer => [layer.radius, layer.align]),
		[
			[20, undefined],
			[undefined, undefined],
			[undefined, 'left'],
			[undefined, undefined],
			[undefined, undefined],
		],
	)
	const code = generateCode(doc)
	assert.match(code, /name: 'Pill', .*radius: 20/)
	assert.match(code, /name: 'Label', .*align: 'left'/)
	assert.equal(code.match(/radius:|align:/g).length, 2)
	const {doc: back} = parseCode(code)
	assert.deepEqual(
		back.layers.map(layer => [layer.radius, layer.align]),
		doc.layers.map(layer => [layer.radius, layer.align]),
	)
})

test('the product motion scenes are long, detailed, and stay inside their duration', () => {
	for (const name of ['Sign-in flow', 'Launch film', 'Dashboard']) {
		const doc = all[name]()
		assert.ok(doc.duration >= 15000 && doc.duration <= 17500, name + ' duration')
		assert.ok(doc.layers.length >= 120 && doc.layers.length <= 400, name + ' layers')
		let keyframes = 0
		for (const layer of doc.layers) {
			for (const track of Object.values(layer.tracks)) {
				keyframes += track.length
				track.forEach((keyframe, i) => {
					assert.ok(keyframe.t >= 0 && keyframe.t <= doc.duration, `${name}, ${layer.name}: ${keyframe.t}ms`)
					if (i) assert.ok(keyframe.t > track[i - 1].t, `${name}, ${layer.name}: keyframes in order`)
				})
			}
		}
		assert.ok(keyframes >= 700, name + ' keyframes')
		// It loops: all that is not the ground has gone by the end.
		const visible = doc.layers.filter(layer => {
			const track = layer.tracks.opacity
			return (track.length ? track[track.length - 1].v : layer.values.opacity) > 0
		})
		assert.ok(visible.length <= 60, `${name}: ${visible.length} layers still visible at the end`)
	}
})

test('a shared link is the code in base64', () => {
	for (const make of Object.values(all)) {
		const code = generateCode(make())
		const encoded = encodeCode(code)
		assert.match(encoded, /^[A-Za-z0-9_-]+$/)
		// It is plain base64: anything decodes it.
		assert.equal(Buffer.from(encoded, 'base64url').toString('utf8'), code)
		assert.equal(decodeCode(encoded), code)
		// Standard base64 with padding, escaped or broken over lines, reads the same.
		const standard = Buffer.from(code, 'utf8').toString('base64')
		assert.equal(decodeCode(standard), code)
		assert.equal(decodeCode(encodeURIComponent(standard)), code)
		assert.equal(decodeCode(standard.replace(/(.{76})/g, '$1\n')), code)
	}
	assert.equal(decodeCode(encodeCode('// naïve ✓ 動き 🎬')), '// naïve ✓ 動き 🎬')
	assert.throws(() => decodeCode('not*base64'), /does not hold base64/)
	assert.throws(() => decodeCode('A'), /does not hold base64/)
	assert.throws(() => decodeCode(Buffer.from([0xff, 0xfe]).toString('base64')), /does not hold text/)
})

test('a three.js layer is real code: its scene function and its imports', () => {
	const doc = all['Black hole']()
	const hole = doc.layers.find(layer => layer.shape === 'three')
	const code = generateCode(doc)

	// The code panel holds the scene itself, written with three.js.
	assert.match(code, /^import \* as THREE from 'three'$/m)
	assert.match(code, /^import \{EffectComposer\} from 'three\/addons\/postprocessing\/EffectComposer\.js'$/m)
	assert.match(code, /^function blackHoleScene\(canvas\) \{$/m)
	for (const part of [
		'new THREE.WebGLRenderer(',
		'new THREE.Scene()',
		'new THREE.Mesh(',
		'new THREE.ShaderMaterial(',
	]) {
		assert.ok(code.includes(part), part)
	}
	assert.match(code, /^\tscene: blackHoleScene,$/m)
	assert.ok(hole.scene.source.length > 30_000)

	// Read back, the layer has the same function, to the letter, and the same imports.
	const {doc: back} = parseCode(code)
	assert.deepEqual(back.layers.find(layer => layer.shape === 'three').scene, hole.scene)

	// An edit to the function is an edit to the layer.
	const edited = parseCode(code.replace('const starCount = 7000', 'const starCount = 9000')).doc
	assert.ok(edited.layers.find(layer => layer.shape === 'three').scene.source.includes('starCount = 9000'))

	// Two layers with one scene share the function; a scene without a name is given one.
	const two = normalizeDoc({
		duration: 1000,
		layers: [
			{name: 'A', shape: 'three', scene: hole.scene},
			{name: 'B', shape: 'three', scene: hole.scene},
			{
				name: 'Scene 1',
				shape: 'three',
				scene: {imports: ["import * as THREE from 'three'"], source: 'canvas => () => {}'},
			},
		],
	})
	const twoCode = generateCode(two)
	assert.equal(twoCode.match(/^function blackHoleScene\(/gm).length, 1)
	assert.equal(twoCode.match(/^\tscene: blackHoleScene,$/gm).length, 2)
	assert.match(twoCode, /^const scene2 = canvas => \(\) => \{\}$/m)
	assert.equal(generateCode(parseCode(twoCode).doc), twoCode)

	// What the code must be.
	const cube =
		"const a = {name: 'A', shape: 'three', SCENE}\nexport const layers = [a]\nexport const duration = 1000\nexport const timeline = new Timeline()"
	assert.throws(() => parseCode(cube.replace('SCENE', 'x: 1')), /needs `scene`/)
	assert.throws(() => parseCode(cube.replace('SCENE', 'scene(canvas) {}')), /not as a method/)
	assert.throws(
		() =>
			parseCode(
				"import * as THREE from 'three'\nconst box = new THREE.BoxGeometry()\n" +
					cube.replace('SCENE', 'scene: () => {}'),
			),
		/THREE is used outside of a scene function/,
	)
})

test("scenes are code: only this editor's own documents may carry them as data", async () => {
	// The shape the black hole had before scenes were code still opens, as the scene it was.
	const old = normalizeDoc({duration: 1000, layers: [{name: 'Hole', shape: 'blackhole'}]})
	assert.equal(old.layers[0].shape, 'three')
	assert.ok(old.layers[0].scene.source.startsWith('function blackHoleScene('))
	// A three.js layer without a scene, or with one that is not a scene, is a cube.
	for (const scene of [undefined, {source: 1}, {imports: ["import fs from 'node:fs'"], source: 'x => x'}]) {
		assert.ok(
			normalizeDoc({layers: [{shape: 'three', scene}]}).layers[0].scene.source.startsWith('function cubeScene('),
		)
	}
	// A link from before links were code is data from anyone: it may hold the built-in scenes only.
	const own = normalizeDoc({
		layers: [
			{shape: 'three', scene: {imports: ["import * as THREE from 'three'"], source: 'canvas => fetch("/steal")'}},
		],
	})
	assert.ok(own.layers[0].scene.source.includes('steal'))
	await assert.rejects(decodeDoc(await encodeDoc(own)), /Scenes are code/)
	assert.equal((await decodeDoc(await encodeDoc(all['Black hole']()))).layers.length, 3)
})

test('generated code imports every helper from the package, never from a file', () => {
	for (const template of templates) {
		const code = generateCode(template.make())
		const imports = code.match(/^import .* from .*$/gm) ?? []
		const own = imports.filter(line => line.includes('@tweenjs/tween.js'))
		assert.equal(own.length, 1, template.name)
		assert.ok(!/from '\.{1,2}\//.test(code), template.name + ': no relative imports')
	}
	const bezier = generateCode(
		parseCode(
			"import {Timeline, Tween, cubicBezier} from '@tweenjs/tween.js'\nexport const layers = [{name: 'A'}]\nexport const timeline = new Timeline().add(new Tween(layers[0]).to({x: 5}, 400).easing(cubicBezier(0.3, 1.45, 0.6, 1)), 0)",
		).doc,
	)
	assert.match(bezier, /^import \{Easing, cubicBezier, Timeline, Tween\} from '@tweenjs\/tween\.js'$/m)
})
