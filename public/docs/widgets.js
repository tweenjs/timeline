/*
 * What Docsify does not do for these docs: the theme (shared with the editor),
 * Copy and "Open in editor" on code, and the interactive examples.
 *
 * Markup in the markdown pages:
 *   ```js … ```                 code; a whole timeline (it has `export const timeline`) also gets Open in editor
 *   <div data-easing="x1 y1 x2 y2" data-editable data-title="…"></div>   a cubic-bezier you can drag
 *   <div data-editor="timeline" data-width="1200" data-height="360" …></div>   the real editor, or a part of it (see editorDemo)
 *   <div data-timeline data-title="…"><script type="application/json">{…}</script></div>   a small timeline to play
 *                               (tracks: [[t, value, easing of the segment that starts here], …])
 */
;(function () {
	'use strict'

	// ----- The theme: the one chosen in the editor, or else the system's. -----
	var KEY = 'tweenjs-timeline-editor-theme'
	var system = matchMedia('(prefers-color-scheme: light)')
	function theme() {
		var chosen = null
		try {
			chosen = localStorage.getItem(KEY)
		} catch (error) {}
		return chosen === 'light' || chosen === 'dark' ? chosen : null
	}
	function show() {
		document.documentElement.dataset.theme = theme() || (system.matches ? 'light' : 'dark')
	}
	show()
	system.addEventListener('change', show)
	addEventListener('storage', show)

	// ----- The share link of a piece of code: the same as the editor's (model/share.ts). -----
	function encodeCode(code) {
		var bytes = new TextEncoder().encode(code)
		var binary = ''
		for (var i = 0; i < bytes.length; i += 0x8000)
			binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
	}
	var EDITOR = '../'

	function el(tag, attributes, children) {
		var node = document.createElement(tag)
		for (var name in attributes || {}) {
			if (name === 'text') node.textContent = attributes[name]
			else node.setAttribute(name, attributes[name])
		}
		;(children || []).forEach(function (child) {
			node.append(child)
		})
		return node
	}

	// ----- Easing: a cubic-bezier you can drag. -----
	function bezier(x1, y1, x2, y2) {
		// The same as CSS cubic-bezier(): solve x(t) = progress, return y(t).
		function sample(a, b, t) {
			return 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t
		}
		return function (x) {
			if (x <= 0) return 0
			if (x >= 1) return 1
			var low = 0
			var high = 1
			var t = x
			for (var i = 0; i < 24; i++) {
				var at = sample(x1, x2, t)
				if (Math.abs(at - x) < 1e-5) break
				if (at < x) low = t
				else high = t
				t = (low + high) / 2
			}
			return sample(y1, y2, t)
		}
	}
	var NS = 'http://www.w3.org/2000/svg'
	function svg(tag, attributes) {
		var node = document.createElementNS(NS, tag)
		for (var name in attributes || {}) node.setAttribute(name, attributes[name])
		return node
	}
	function easingDemo(root) {
		var values = root.dataset.easing.split(/\s+/).map(Number)
		var editable = root.hasAttribute('data-editable')
		var W = 200
		var P = 40 // space at the sides of the unit square
		var PY = W / 2 // and above and below it: a curve may overshoot, from -0.5 to 1.5
		var graph = svg('svg', {
			class: 'graph',
			viewBox: '0 0 ' + (W + P * 2) + ' ' + (W + PY * 2),
			role: 'img',
			'aria-label': 'The easing curve',
		})
		var frameBox = svg('rect', {
			x: P,
			y: PY,
			width: W,
			height: W,
			fill: 'none',
			stroke: 'currentColor',
			'stroke-opacity': '0.25',
		})
		var diagonal = svg('line', {
			x1: P,
			y1: PY + W,
			x2: P + W,
			y2: PY,
			stroke: 'currentColor',
			'stroke-opacity': '0.15',
			'stroke-dasharray': '3 4',
		})
		var armA = svg('line', {stroke: 'currentColor', 'stroke-opacity': '0.5'})
		var armB = svg('line', {stroke: 'currentColor', 'stroke-opacity': '0.5'})
		var curve = svg('path', {fill: 'none', stroke: 'var(--accent)', 'stroke-width': '3'})
		var handleA = svg('circle', {
			r: 7,
			fill: 'var(--panel)',
			stroke: 'var(--color-text)',
			'stroke-width': 2,
			style: editable ? 'cursor:grab' : '',
		})
		var handleB = svg('circle', {
			r: 7,
			fill: 'var(--panel)',
			stroke: 'var(--color-text)',
			'stroke-width': 2,
			style: editable ? 'cursor:grab' : '',
		})
		var dot = svg('circle', {r: 5, fill: 'var(--key)'})
		graph.append(frameBox, diagonal, armA, armB, curve, handleA, handleB, dot)
		var gx = function (x) {
			return P + x * W
		}
		var gy = function (y) {
			return PY + W - y * W
		}

		var track = el('div', {class: 'track'}, [el('i')])
		var ball = track.firstChild
		var out = el('pre', {class: 'code-out'}, [el('code')])
		var play = el('button', {type: 'button', class: 'primary', text: '▶ Play'})
		var left = el('div', {}, [graph])
		var right = el('div', {}, [track, el('div', {style: 'margin-top:12px'}, [play]), out])
		var sliders = el('div', {class: 'sliders'})
		var outputs = []
		if (editable) {
			;['x1', 'y1', 'x2', 'y2'].forEach(function (name, i) {
				var input = el('input', {
					type: 'range',
					min: i % 2 ? '-0.5' : '0',
					max: i % 2 ? '1.5' : '1',
					step: '0.01',
					'aria-label': name,
				})
				input.value = values[i]
				var output = el('output', {})
				outputs.push(output)
				input.addEventListener('input', function () {
					values[i] = +input.value
					draw()
				})
				sliders.append(el('label', {text: name}), input, output)
			})
			left.append(sliders)
		}
		root.classList.add('demo')
		root.append(
			el('header', {}, [
				el('b', {text: root.dataset.title || 'Easing'}),
				document.createTextNode(editable ? ' · drag the two handles' : ''),
			]),
			el('div', {class: 'easing-grid'}, [left, right]),
		)

		var ease = bezier.apply(null, values)
		function draw() {
			ease = bezier.apply(null, values)
			var d = 'M ' + gx(0) + ' ' + gy(0)
			d +=
				' C ' +
				gx(values[0]) +
				' ' +
				gy(values[1]) +
				', ' +
				gx(values[2]) +
				' ' +
				gy(values[3]) +
				', ' +
				gx(1) +
				' ' +
				gy(1)
			curve.setAttribute('d', d)
			armA.setAttribute('x1', gx(0))
			armA.setAttribute('y1', gy(0))
			armA.setAttribute('x2', gx(values[0]))
			armA.setAttribute('y2', gy(values[1]))
			armB.setAttribute('x1', gx(1))
			armB.setAttribute('y1', gy(1))
			armB.setAttribute('x2', gx(values[2]))
			armB.setAttribute('y2', gy(values[3]))
			handleA.setAttribute('cx', gx(values[0]))
			handleA.setAttribute('cy', gy(values[1]))
			handleB.setAttribute('cx', gx(values[2]))
			handleB.setAttribute('cy', gy(values[3]))
			var text = values
				.map(function (value) {
					return +value.toFixed(2)
				})
				.join(', ')
			out.firstChild.textContent = '.easing(cubicBezier(' + text + '))'
			outputs.forEach(function (output, i) {
				output.textContent = values[i].toFixed(2)
			})
			if (editable)
				sliders.querySelectorAll('input').forEach(function (input, i) {
					input.value = values[i]
				})
			place(progress)
		}
		var progress = 0
		function place(p) {
			progress = p
			var eased = ease(p)
			var room = track.clientWidth - 36
			ball.style.transform = 'translateX(' + eased * room + 'px)'
			dot.setAttribute('cx', gx(p))
			dot.setAttribute('cy', gy(eased))
		}
		var request = 0
		play.addEventListener('click', function () {
			cancelAnimationFrame(request)
			var start = performance.now()
			;(function step(now) {
				var p = Math.min(1, (now - start) / 1600)
				place(p)
				if (p < 1) request = requestAnimationFrame(step)
			})(start)
		})
		if (editable) {
			;[
				[handleA, 0],
				[handleB, 2],
			].forEach(function (pair) {
				var handle = pair[0]
				var at = pair[1]
				handle.addEventListener('pointerdown', function (event) {
					handle.setPointerCapture(event.pointerId)
					function move(moved) {
						var box = graph.getBoundingClientRect()
						var scale = (W + P * 2) / box.width
						var x = ((moved.clientX - box.left) * scale - P) / W
						var y = (PY + W - (moved.clientY - box.top) * scale) / W
						values[at] = Math.min(1, Math.max(0, x))
						values[at + 1] = Math.min(1.5, Math.max(-0.5, y))
						draw()
					}
					handle.addEventListener('pointermove', move)
					handle.addEventListener(
						'pointerup',
						function () {
							handle.removeEventListener('pointermove', move)
						},
						{once: true},
					)
				})
			})
		}
		draw()
	}

	// ----- A small timeline you can play and scrub. -----
	var EASINGS = (function () {
		var out = {
			linear: function (k) {
				return k
			},
		}
		var families = {
			quad: function (k) {
				return k * k
			},
			cubic: function (k) {
				return k * k * k
			},
			sine: function (k) {
				return 1 - Math.cos((k * Math.PI) / 2)
			},
			expo: function (k) {
				return k === 0 ? 0 : Math.pow(1024, k - 1)
			},
			back: function (k) {
				return k * k * (2.70158 * k - 1.70158)
			},
		}
		Object.keys(families).forEach(function (name) {
			var f = families[name]
			out[name + '-in'] = f
			out[name + '-out'] = function (k) {
				return 1 - f(1 - k)
			}
			out[name + '-in-out'] = function (k) {
				return k < 0.5 ? f(k * 2) / 2 : 1 - f((1 - k) * 2) / 2
			}
		})
		out['bounce-out'] = function (k) {
			if (k < 1 / 2.75) return 7.5625 * k * k
			if (k < 2 / 2.75) return 7.5625 * (k -= 1.5 / 2.75) * k + 0.75
			if (k < 2.5 / 2.75) return 7.5625 * (k -= 2.25 / 2.75) * k + 0.9375
			return 7.5625 * (k -= 2.625 / 2.75) * k + 0.984375
		}
		out['elastic-out'] = function (k) {
			return k === 0 || k === 1 ? k : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
		}
		return out
	})()
	function easingOf(spec) {
		if (Array.isArray(spec)) return bezier.apply(null, spec)
		return EASINGS[spec] || EASINGS.linear
	}
	var COMP = {width: 640, height: 360}
	function timelineDemo(root) {
		var config = JSON.parse(root.querySelector('script[type="application/json"]').textContent)
		var duration = config.duration
		var layers = config.layers.map(function (layer) {
			var tracks = {}
			Object.keys(layer.tracks || {}).forEach(function (prop) {
				tracks[prop] = layer.tracks[prop].map(function (key) {
					return {t: key[0], v: key[1], ease: easingOf(key[2])}
				})
			})
			return {layer: layer, tracks: tracks, node: null}
		})
		var stage = el('div', {class: 'stage'})
		var comp = el('div', {class: 'comp'})
		stage.append(comp)
		layers
			.slice()
			.reverse()
			.forEach(function (item) {
				var layer = item.layer
				var node = el('i')
				node.style.width = (layer.w || 40) + 'px'
				node.style.height = (layer.h || layer.w || 40) + 'px'
				node.style.background = layer.color || '#4dabf7'
				node.style.borderRadius = layer.shape === 'circle' ? '50%' : (layer.radius || 6) + 'px'
				node.style.marginLeft = -(layer.w || 40) / 2 + 'px'
				node.style.marginTop = -(layer.h || layer.w || 40) / 2 + 'px'
				if (layer.text) {
					node.textContent = layer.text
					node.style.color = layer.color || '#fff'
					node.style.background = 'none'
					node.style.font = '700 ' + (layer.size || 28) + 'px system-ui, sans-serif'
					node.style.whiteSpace = 'nowrap'
					node.style.lineHeight = '1'
				}
				item.node = node
				comp.append(node)
			})
		var play = el('button', {type: 'button', class: 'primary', text: '▶ Play'})
		var loop = el('input', {type: 'checkbox'})
		var range = el('input', {
			type: 'range',
			min: '0',
			max: String(duration),
			step: '10',
			value: '0',
			'aria-label': 'Playhead',
		})
		var output = el('output', {text: '0.00s / ' + (duration / 1000).toFixed(2) + 's'})
		var bar = el('div', {class: 'scrub'}, [
			play,
			range,
			output,
			el('label', {}, [loop, document.createTextNode(' Loop')]),
		])
		root.classList.add('demo')
		root.append(
			el('header', {}, [
				el('b', {text: root.dataset.title || 'Try it'}),
				document.createTextNode(' · press Play, or drag the playhead'),
			]),
			stage,
			bar,
		)
		if (config.code) {
			var open = el('a', {
				class: 'button',
				href: EDITOR + '#' + encodeCode(config.code),
				target: '_blank',
				rel: 'noopener',
				text: 'Open this in the editor',
			})
			open.style.cssText =
				'display:inline-flex;align-items:center;margin-top:12px;height:28px;padding:0 10px;border-radius:6px;background:var(--accent);color:#fff;font-size:13px;text-decoration:none'
			root.append(open)
		}

		function value(item, prop, time) {
			var track = item.tracks[prop]
			var base = item.layer[prop]
			if (base === undefined) base = prop === 'scale' || prop === 'opacity' ? 1 : 0
			if (!track || !track.length) return base
			if (time <= track[0].t) return track[0].v
			for (var i = 1; i < track.length; i++) {
				if (time <= track[i].t) {
					var a = track[i - 1]
					var b = track[i]
					// As in the editor, the easing belongs to the keyframe the segment leaves.
					return a.v + (b.v - a.v) * a.ease((time - a.t) / (b.t - a.t))
				}
			}
			return track[track.length - 1].v
		}
		function fit() {
			comp.style.transform = 'scale(' + stage.clientWidth / COMP.width + ')'
			stage.style.height = (stage.clientWidth * COMP.height) / COMP.width + 'px'
		}
		function draw(time) {
			layers.forEach(function (item) {
				var x = value(item, 'x', time)
				var y = value(item, 'y', time)
				var scale = value(item, 'scale', time)
				var rotation = value(item, 'rotation', time)
				item.node.style.transform =
					'translate(' + x + 'px,' + y + 'px) rotate(' + rotation + 'deg) scale(' + scale + ')'
				item.node.style.opacity = value(item, 'opacity', time)
			})
			range.value = time
			output.textContent = (time / 1000).toFixed(2) + 's / ' + (duration / 1000).toFixed(2) + 's'
		}
		var time = 0
		var playing = false
		var last = 0
		function tick(now) {
			if (!playing) return
			time += now - last
			last = now
			if (time >= duration) {
				if (loop.checked) time %= duration
				else {
					time = duration
					stop()
				}
			}
			draw(time)
			if (playing) requestAnimationFrame(tick)
		}
		function stop() {
			playing = false
			play.textContent = '▶ Play'
		}
		play.addEventListener('click', function () {
			if (playing) return stop()
			if (time >= duration) time = 0
			playing = true
			play.textContent = '❚❚ Pause'
			last = performance.now()
			requestAnimationFrame(tick)
		})
		range.addEventListener('input', function () {
			stop()
			time = +range.value
			draw(time)
		})
		if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage)
		fit()
		draw(config.start || 0)
		time = config.start || 0
		// Stop animating when it is not on the screen.
		if ('IntersectionObserver' in window)
			new IntersectionObserver(function (entries) {
				if (!entries[0].isIntersecting && playing) stop()
			}).observe(root)
	}

	// ----- Code: Copy, and open a whole timeline in the editor. -----
	function examples() {
		document.querySelectorAll('.markdown-section pre[data-lang]').forEach(function (pre) {
			if (pre.dataset.tools) return
			pre.dataset.tools = '1'
			var code = pre.textContent.replace(/\n$/, '') + '\n'
			var copy = el('button', {type: 'button', text: 'Copy'})
			copy.addEventListener('click', function () {
				navigator.clipboard.writeText(code).then(
					function () {
						copy.textContent = 'Copied'
						setTimeout(function () {
							copy.textContent = 'Copy'
						}, 1200)
					},
					function () {
						copy.textContent = 'Press Ctrl+C'
					},
				)
			})
			var tools = el('span', {class: 'pre-tools'}, [copy])
			if (/export const timeline\b/.test(code) && /export const layers\b/.test(code))
				tools.append(
					el('a', {href: EDITOR + '#' + encodeCode(code), target: '_blank', rel: 'noopener', text: 'Open in editor'}),
				)
			pre.append(tools)
		})
	}

	// ----- The theme choice, in the sidebar. -----
	function chooser() {
		if (document.getElementById('docs-theme')) return
		var sidebar = document.querySelector('.sidebar')
		if (!sidebar) return
		var select = el(
			'select',
			{id: 'docs-theme', 'aria-label': 'Theme', title: 'Shared with the editor. System follows your device.'},
			[
				el('option', {value: 'system', text: 'System'}),
				el('option', {value: 'light', text: 'Light'}),
				el('option', {value: 'dark', text: 'Dark'}),
			],
		)
		select.value = theme() || 'system'
		select.addEventListener('change', function () {
			try {
				if (select.value === 'system') localStorage.removeItem(KEY)
				else localStorage.setItem(KEY, select.value)
			} catch (error) {}
			show()
		})
		var editor = el('a', {class: 'open-editor', href: EDITOR, text: 'Open the editor'})
		sidebar.prepend(el('div', {class: 'docs-tools'}, [editor, select]))
	}

	// ----- The real editor, in the page. -----
	// <div data-editor="timeline" data-width="1200" data-height="360" data-title="…" …></div>
	// Attributes: data-editor (the part to show: window, stage, properties, timeline, transport, code, menu),
	// data-width/data-height (the size it is laid out at, in px: it is scaled down to fit the page),
	// data-template, data-select, data-prop, data-key, data-seek, data-play, data-menu, data-sub, data-do
	// (see src/embed.ts), and data-code (code of a timeline to open as a shared link, which asks first).
	var PARAMS = ['template', 'select', 'prop', 'key', 'seek', 'play', 'menu', 'sub', 'do']
	function editorDemo(root) {
		var view = root.dataset.editor
		var W = +root.dataset.width || 1200
		var H = +root.dataset.height || 600
		var query = ['embed=' + encodeURIComponent(view)]
		PARAMS.forEach(function (name) {
			if (root.hasAttribute('data-' + name))
				query.push(name + '=' + encodeURIComponent(root.getAttribute('data-' + name)))
		})
		var hash = root.dataset.code ? '#' + encodeCode(root.dataset.code) : ''
		var src = EDITOR + 'index.html?' + query.join('&') + hash

		var frame = el('div', {class: 'frame'}, [el('p', {class: 'loading', text: 'Loading the editor…'})])
		var reset = el('button', {type: 'button', text: 'Reset', title: 'Start this example again'})
		var full = el('a', {href: EDITOR + hash, target: '_blank', rel: 'noopener', text: 'Open the full editor'})
		root.classList.add('demo', 'embed')
		root.append(
			el('header', {}, [
				el('b', {text: root.dataset.title || 'The editor'}),
				document.createTextNode(' · this is the real editor: try it'),
				el('span', {class: 'spacer'}),
				reset,
				full,
			]),
			frame,
		)

		var iframe = null
		function fit() {
			var scale = Math.min(1, frame.clientWidth / W)
			frame.style.height = H * scale + 'px'
			if (iframe) iframe.style.transform = 'scale(' + scale + ')'
		}
		function load() {
			if (iframe) iframe.remove()
			iframe = el('iframe', {title: root.dataset.title || 'The timeline editor', src: src, width: W, height: H})
			iframe.style.width = W + 'px'
			iframe.style.height = H + 'px'
			frame.append(iframe)
			fit()
		}
		reset.addEventListener('click', load)
		if ('ResizeObserver' in window) new ResizeObserver(fit).observe(frame)
		fit()
		// Only an editor that is near the screen is started: each one is a whole editor.
		if ('IntersectionObserver' in window) {
			var seen = new IntersectionObserver(
				function (entries) {
					if (!entries[0].isIntersecting) return
					seen.disconnect()
					load()
				},
				{rootMargin: '300px'},
			)
			seen.observe(root)
		} else load()
	}

	function plugin(hook) {
		hook.doneEach(function () {
			chooser()
			examples()
			document.querySelectorAll('.markdown-section [data-easing]').forEach(function (root) {
				if (root.dataset.ready) return
				root.dataset.ready = '1'
				easingDemo(root)
			})
			document.querySelectorAll('.markdown-section [data-editor]').forEach(function (root) {
				if (root.dataset.ready) return
				root.dataset.ready = '1'
				editorDemo(root)
			})
			document.querySelectorAll('.markdown-section [data-timeline]').forEach(function (root) {
				if (root.dataset.ready) return
				root.dataset.ready = '1'
				timelineDemo(root)
			})
		})
	}
	window.$docsify = window.$docsify || {}
	window.$docsify.plugins = [plugin].concat(window.$docsify.plugins || [])
})()
