import {For} from 'solid-js'
import {THEMES, type Theme} from '../theme'
import {
	actions,
	doc,
	player,
	redo,
	setDuration,
	setLoop,
	setTheme,
	setZoom,
	toggleCode,
	togglePath,
	ui,
	undo,
} from '../state'

const seconds = (time: number) => (time / 1000).toFixed(2) + 's'

/** The time readout follows the playhead without being state: see player.ts. */
function timeReadout(element: HTMLElement) {
	let shown = ''
	player.onSlow(time => {
		const text = seconds(time) + ' / ' + seconds(player.doc.duration)
		if (text !== shown) element.textContent = shown = text
	})
}

/** Drawn, not typed: the media symbols are missing from many fonts. */
const ICONS = {
	prev: 'M2 2h2v8H2z M11 2v8L5 6z',
	play: 'M3 1.5v9l8-4.5z',
	pause: 'M2.5 2h2.5v8H2.5z M7 2h2.5v8H7z',
	stop: 'M2.5 2.5h7v7h-7z',
	next: 'M8 2h2v8H8z M1 2v8l6-4z',
	restart: 'M6 1.5a4.5 4.5 0 1 0 4.5 4.5H9A3 3 0 1 1 6 3v1.8L9 2.4 6 0z',
}

function Icon(props: {d: string}) {
	return (
		<svg class="icon-glyph" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
			<path d={props.d} fill="currentColor" />
		</svg>
	)
}

/** Playback controls, centred above the timeline. */
export function Transport() {
	return (
		<div id="transport" role="toolbar" aria-label="Playback">
			<span class="side start">
				<span class="tab">Timeline</span>
				<label>
					Duration{' '}
					<input
						id="duration"
						disabled={ui.playing}
						type="number"
						min="100"
						step="100"
						value={doc.duration}
						onChange={event => {
							// A duration cannot end before the last keyframe: show what was applied.
							event.currentTarget.value = String(setDuration(+event.currentTarget.value))
						}}
					/>{' '}
					ms
				</label>
			</span>
			<div class="buttons">
				<button id="prev" title="Previous keyframe, or the start (Page Up)" onClick={() => actions.prev()}>
					<Icon d={ICONS.prev} /> Prev
				</button>
				<button
					id="play"
					aria-pressed={ui.playing ? 'true' : 'false'}
					title="Play (Space)"
					onClick={() => actions.play()}
				>
					<Icon d={ICONS.play} /> Play
				</button>
				<button id="pause" disabled={!ui.playing} title="Pause (Space)" onClick={() => actions.pause()}>
					<Icon d={ICONS.pause} /> Pause
				</button>
				<button id="stop" title="Stop: pause at the start" onClick={() => actions.stop()}>
					<Icon d={ICONS.stop} /> Stop
				</button>
				<button id="next" title="Next keyframe, or the end (Page Down)" onClick={() => actions.next()}>
					<Icon d={ICONS.next} /> Forward
				</button>
				<button id="restart" title="Restart: play from the start" onClick={() => actions.restart()}>
					<Icon d={ICONS.restart} /> Restart
				</button>
			</div>
			<span class="side">
				<button
					id="loop"
					aria-pressed={ui.loop ? 'true' : 'false'}
					title="Loop playback"
					onClick={() => setLoop(!ui.loop)}
				>
					Loop
				</button>
				<span id="time" ref={timeReadout}>
					0.00s / 0.00s
				</span>
				<label>
					Zoom{' '}
					<input
						id="zoom"
						type="range"
						min="0.05"
						max="1"
						step="0.01"
						value={ui.zoom}
						onInput={event => setZoom(+event.currentTarget.value)}
					/>
				</label>
			</span>
		</div>
	)
}

export function Toolbar() {
	return (
		<header id="bar">
			<span class="side" />
			<div class="buttons">
				<button id="undo" title="Undo (Ctrl+Z)" disabled={!ui.canUndo} onClick={undo}>
					Undo
				</button>
				<button id="redo" title="Redo (Ctrl+Shift+Z)" disabled={!ui.canRedo} onClick={redo}>
					Redo
				</button>
				<button id="reset" title="Replace the timeline with the demo" onClick={() => actions.demo()}>
					Reset demo
				</button>
			</div>
			<span class="side">
				{/* Radix's Select trigger, on the native element: the list is the browser's own. */}
				<select
					id="theme"
					aria-label="Theme"
					title="System follows your device."
					value={ui.theme}
					onChange={event => setTheme(event.currentTarget.value as Theme)}
				>
					<For each={THEMES}>{theme => <option value={theme}>{theme[0].toUpperCase() + theme.slice(1)}</option>}</For>
				</select>
				<button
					id="toggle-path"
					aria-pressed={ui.showPath ? 'true' : 'false'}
					title="Show the path the selected layer travels: a dashed line, with a square at each keyframe"
					onClick={togglePath}
				>
					Path
				</button>
				<button
					id="toggle-code"
					aria-pressed={ui.showCode ? 'true' : 'false'}
					title="Show or hide the code panel"
					onClick={toggleCode}
				>
					Code
				</button>
			</span>
		</header>
	)
}
