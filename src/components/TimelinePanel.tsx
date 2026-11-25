import {For, Show, createMemo} from 'solid-js'
import {BASIC_SHAPES, PROPS, type Layer, type Prop} from '../model/types'
import {
	STEPS,
	addKeyframe,
	addLayer,
	clamp,
	doc,
	drag,
	editValue,
	foldLayer,
	locked,
	moveKeyframe,
	player,
	removeLayer,
	round,
	select,
	snap,
	sync,
	toggleKeyframe,
	ui,
} from '../state'

let panel: HTMLElement | undefined
let ruler: HTMLElement | undefined
let playhead: HTMLElement | undefined
let rulerHead: HTMLElement | undefined

/** Value fields and keyframe toggles of the visible property rows: they follow the playhead. */
type LiveRow = {input: HTMLInputElement; toggle: HTMLElement; layer: number; prop: Prop; on: boolean}
const liveRows = new Set<LiveRow>()

/** Panel metrics, measured when they change rather than on every frame. */
let panelWidth = 0
let labelWidth = 250
let lastX = NaN

player.onFrame(time => {
	const x = Math.round(time * ui.zoom)
	if (x !== lastX && playhead && rulerHead) {
		lastX = x
		playhead.style.transform = rulerHead.style.transform = `translate3d(${x}px, 0, 0)`
	}

	// Keep the playhead in view.
	if (player.playing && panel && (x < panel.scrollLeft || x > panel.scrollLeft + panelWidth - labelWidth - 20)) {
		panel.scrollLeft = x - 40
	}
})

player.onSlow(() => {
	for (const row of liveRows) {
		if (!row.input.isConnected) {
			liveRows.delete(row)
			continue
		}
		const layer = player.doc.layers[row.layer]
		if (!layer) continue

		if (row.input !== document.activeElement) {
			const text = String(+player.valueOf(row.layer, row.prop).toFixed(2))
			if (row.input.value !== text) row.input.value = text
		}
		const on = player.keyframeAt(layer.tracks[row.prop]) !== -1
		if (on !== row.on) row.toggle.classList.toggle('on', (row.on = on))
	}
})

function laneTime(event: MouseEvent) {
	return clamp(snap((event.clientX - ruler!.getBoundingClientRect().left) / ui.zoom), 0, player.doc.duration)
}

function scrub(event: PointerEvent) {
	player.seek(laneTime(event))
	drag(event, moved => player.seek(laneTime(moved)))
}

function grabKeyframe(event: PointerEvent, layer: number, prop: Prop, index: number) {
	select(layer, prop, index)
	const startX = event.clientX
	const startTime = player.doc.layers[layer].tracks[prop][index].t
	if (locked()) return

	drag(event, moved => {
		const time = clamp(snap(startTime + (moved.clientX - startX) / ui.zoom), 0, player.doc.duration)
		// The keyframe may have changed places with a neighbour: the selection follows it.
		moveKeyframe(layer, prop, ui.key, time)
	})
}

function PropRow(props: {layer: Layer; index: number; prop: Prop}) {
	const active = () => ui.layer === props.index && ui.prop === props.prop
	const track = () => props.layer.tracks[props.prop]
	const live = {on: false} as LiveRow

	return (
		<div
			class={['row', 'prop', {selected: active()}]}
			data-layer={props.index}
			data-prop={props.prop}
			onClick={event => {
				// A click on a row selects its layer and property.
				if (!(event.target as Element).closest('input, button, .keyframe')) select(props.index, props.prop)
			}}
		>
			<div class="label">
				<span>{props.prop}</span>
				<input
					type="number"
					step={STEPS[props.prop]}
					aria-label={`${props.layer.name} ${props.prop}`}
					ref={element => {
						live.input = element
						live.layer = props.index
						live.prop = props.prop
						liveRows.add(live)
					}}
					disabled={ui.playing}
					onChange={event => {
						const value = parseFloat(event.currentTarget.value)
						if (Number.isNaN(value)) sync()
						else editValue(props.index, props.prop, value)
					}}
				/>
				<button
					class={['key-toggle', {has: track().length > 0}]}
					disabled={ui.playing}
					title="Add or remove a keyframe at the playhead"
					ref={element => (live.toggle = element)}
					onClick={() => toggleKeyframe(props.index, props.prop)}
				>
					◆
				</button>
			</div>
			<div
				class="lane"
				title="Double-click to add a keyframe"
				onDblClick={event => {
					if (event.target === event.currentTarget) addKeyframe(props.index, props.prop, laneTime(event))
				}}
			>
				<For each={track()} keyed={false}>
					{(keyframe, index) => (
						<Show when={track()[index + 1]}>
							{next => (
								<i
									class={['segment', {selected: active() && ui.key === index}]}
									style={{left: keyframe().t * ui.zoom + 'px', width: (next().t - keyframe().t) * ui.zoom + 'px'}}
								/>
							)}
						</Show>
					)}
				</For>
				<For each={track()} keyed={false}>
					{(keyframe, index) => (
						<i
							class={['keyframe', {selected: active() && ui.key === index}]}
							data-key={index}
							title={keyframe().t + 'ms'}
							style={{left: keyframe().t * ui.zoom + 'px'}}
							onPointerDown={event => grabKeyframe(event, props.index, props.prop, index)}
						/>
					)}
				</For>
			</div>
		</div>
	)
}

function LayerRows(props: {layer: Layer; index: number}) {
	const marks = createMemo(() => [
		...new Set(PROPS.flatMap(prop => props.layer.tracks[prop].map(keyframe => keyframe.t))),
	])

	return (
		<>
			<div
				class={['row', 'layer', {selected: ui.layer === props.index}]}
				data-layer={props.index}
				onClick={event => {
					if (!(event.target as Element).closest('button')) select(props.index)
				}}
			>
				<div class="label">
					<button class="icon" data-fold title="Show or hide properties" onClick={() => foldLayer(props.index)}>
						{props.layer.closed ? '▸' : '▾'}
					</button>
					<i class="swatch" style={{background: props.layer.color}} />
					<span class="name">{props.layer.name}</span>
					<button class="icon" data-remove title="Delete layer" onClick={() => removeLayer(props.index)}>
						✕
					</button>
				</div>
				<div class="lane">
					<div class="bar" style={{width: doc.duration * ui.zoom + 'px', background: props.layer.color}} />
					<For each={marks()}>{time => <i class="mark" style={{left: time * ui.zoom + 'px'}} />}</For>
				</div>
			</div>
			<Show when={!props.layer.closed}>
				<For each={PROPS}>{prop => <PropRow layer={props.layer} index={props.index} prop={prop} />}</For>
			</Show>
		</>
	)
}

export function TimelinePanel() {
	const step = createMemo(
		() => [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000].find(ms => ms * ui.zoom >= 60) ?? 60000,
	)
	const ticks = createMemo(() => {
		const times: number[] = []
		for (let time = 0; time <= doc.duration; time += step()) times.push(time)
		return times
	})

	return (
		<section
			id="timeline"
			class="panel"
			ref={element => {
				panel = element
				new ResizeObserver(() => {
					panelWidth = element.clientWidth
					labelWidth = element.querySelector<HTMLElement>('.label')?.offsetWidth ?? labelWidth
				}).observe(element)
			}}
		>
			<div
				id="rows"
				style={{
					width: `calc(var(--label) + var(--pad) + ${doc.duration * ui.zoom + 60}px)`,
					'--grid': step() * ui.zoom + 'px',
				}}
			>
				<div class="row ruler">
					<div class="label">
						<For each={BASIC_SHAPES}>
							{shape => (
								<button data-add={shape} title={`Add a ${shape} layer`} onClick={() => addLayer(shape)}>
									+ {shape}
								</button>
							)}
						</For>
					</div>
					<div class="lane" id="ruler" ref={element => (ruler = element)} onPointerDown={scrub}>
						<For each={ticks()}>
							{time => (
								<div class="tick" style={{left: time * ui.zoom + 'px'}}>
									{round(time / 1000)}s
								</div>
							)}
						</For>
						<i id="ruler-head" ref={element => (rulerHead = element)} />
					</div>
				</div>
				<For each={doc.layers} keyed={false}>
					{(layer, index) => <LayerRows layer={layer()} index={index} />}
				</For>
				<div id="playhead" ref={element => (playhead = element)} />
			</div>
		</section>
	)
}
