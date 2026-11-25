import {For, Show} from 'solid-js'
import {curvePresets, easingFunction, easingNames, fitCurveNodes} from '../model/curveTools'
import {CUBE} from '../model/scenes'
import {RADIUS, SHAPES, presetEase, type Layer, type Shape} from '../model/types'
import {
	SNAP,
	STEPS,
	change,
	clamp,
	doc,
	getDoc,
	moveKeyframe,
	plain,
	record,
	round,
	selectedKeyframe,
	setCurve,
	sync,
	ui,
} from '../state'
import {CurveEditor} from './CurveEditor'

const families: Record<string, string[]> = {}
for (const name of easingNames) (families[name.split('.')[0]] ??= []).push(name)

function editLayer(edit: (layer: Layer) => void) {
	const index = ui.layer
	change(draft => edit(draft.layers[index]))
}

const size = (value: string) => Math.max(1, +value || 1)

function LayerFields(props: {layer: Layer}) {
	return (
		<section>
			<h3>Layer</h3>
			<div class="fields">
				<label>Name</label>
				<input
					class="wide"
					data-layer-field="name"
					value={props.layer.name}
					onChange={event => editLayer(layer => (layer.name = event.currentTarget.value))}
				/>
				<label>Shape</label>
				{/* Bound on the select, not per option: when another layer is selected the browser clears
				    the old option itself, which an option's own binding would take for the user's doing. */}
				<select
					data-layer-field="shape"
					value={props.layer.shape}
					onChange={event =>
						editLayer(layer => {
							layer.shape = event.currentTarget.value as Shape
							// A three.js layer starts as a cube: its code is in the code panel.
							if (layer.shape === 'three') layer.scene ??= {imports: [...CUBE.imports], source: CUBE.source}
							else delete layer.scene
						})
					}
				>
					<For each={SHAPES}>{shape => <option value={shape}>{shape}</option>}</For>
				</select>
				<label>Color</label>
				<input
					type="color"
					data-layer-field="color"
					value={props.layer.color}
					onChange={event => editLayer(layer => (layer.color = event.currentTarget.value))}
				/>
				<Show
					when={props.layer.shape === 'text'}
					fallback={
						<>
							<label>Width</label>
							<input
								type="number"
								min="1"
								data-layer-field="width"
								value={props.layer.width}
								onChange={event => editLayer(layer => (layer.width = size(event.currentTarget.value)))}
							/>
							<label>Height</label>
							<input
								type="number"
								min="1"
								data-layer-field="height"
								value={props.layer.height}
								onChange={event => editLayer(layer => (layer.height = size(event.currentTarget.value)))}
							/>
							<Show when={props.layer.shape === 'rect'}>
								<label>Radius</label>
								<input
									type="number"
									min="0"
									data-layer-field="radius"
									value={props.layer.radius ?? RADIUS}
									onChange={event =>
										editLayer(layer => {
											const radius = Math.max(0, Number(event.currentTarget.value) || 0)
											if (radius === RADIUS) delete layer.radius
											else layer.radius = radius
										})
									}
								/>
							</Show>
						</>
					}
				>
					<label>Text</label>
					<input
						data-layer-field="text"
						value={props.layer.text}
						onChange={event => editLayer(layer => (layer.text = event.currentTarget.value))}
					/>
					<label>Size</label>
					<input
						type="number"
						min="1"
						data-layer-field="height"
						value={props.layer.height}
						onChange={event => editLayer(layer => (layer.height = size(event.currentTarget.value)))}
					/>
					<label>Align</label>
					<select
						data-layer-field="align"
						value={props.layer.align ?? 'center'}
						onChange={event =>
							editLayer(layer => {
								const align = event.currentTarget.value
								if (align === 'left' || align === 'right') layer.align = align
								else delete layer.align
							})
						}
					>
						<option value="left">Left</option>
						<option value="center">Center</option>
						<option value="right">Right</option>
					</select>
				</Show>
			</div>
			<Show when={props.layer.shape === 'three'}>
				<p class="hint">
					A 3D scene, drawn with three.js by this layer's own code: the function given as <b>scene</b> in the code
					panel. Edit it there. The scene gets the layer's <b>rotation</b> and <b>scale</b> with every frame, to use as
					it likes, and the playhead.
				</p>
			</Show>
		</section>
	)
}

/** Edits the selected keyframe. */
function editKeyframe(edit: (keyframe: Layer['tracks']['x'][number]) => void) {
	const {layer, prop, key} = ui
	if (prop) change(draft => edit(draft.layers[layer].tracks[prop][key]))
}

function setTime(input: HTMLInputElement) {
	const keyframe = selectedKeyframe()
	const {layer, prop, key} = ui
	if (!keyframe || !prop) return

	const time = clamp(Math.round(parseFloat(input.value)), 0, getDoc().duration)
	// Two keyframes of a property cannot share a time.
	const free = !Number.isNaN(time) && !getDoc().layers[layer].tracks[prop].some(other => other.t === time)
	if (free) record(() => moveKeyframe(layer, prop, key, time))
	// A time that is taken (or not a number) is refused: show the time it kept.
	else input.value = String(keyframe.t)
}

function setEasing(value: string) {
	const keyframe = selectedKeyframe()
	if (!keyframe) return
	if (value !== 'curve') return editKeyframe(edited => (edited.ease = presetEase(value)))
	// Switching to a custom curve keeps the shape: the current easing is traced.
	if (keyframe.ease.type === 'curve') return
	const nodes = fitCurveNodes(easingFunction(keyframe.ease))
	editKeyframe(edited => (edited.ease = {type: 'curve', nodes}))
}

function KeyframeFields() {
	/** The selected keyframe, from the document snapshot: the curve is drawn from all of it. */
	const keyframe = () => (ui.prop && plain().layers[ui.layer]?.tracks[ui.prop][ui.key]) || undefined
	const isLast = () => !!ui.prop && ui.key === (plain().layers[ui.layer]?.tracks[ui.prop].length ?? 0) - 1
	const custom = () => keyframe()?.ease.type === 'curve'
	const presetName = () => {
		const ease = keyframe()?.ease
		return ease?.type === 'preset' ? ease.name : ''
	}

	return (
		<Show
			when={keyframe()}
			fallback={
				<section>
					<h3>Keyframe</h3>
					<p class="hint">
						Click ◆ next to a property to add a keyframe at the playhead, then select a keyframe to shape the motion
						that follows it with the curve tool.
					</p>
				</section>
			}
		>
			{selected => (
				<section>
					<h3>
						Keyframe · {doc.layers[ui.layer]?.name} {ui.prop}
					</h3>
					<div class="fields">
						<label>Time</label>
						<input
							type="number"
							min="0"
							step={SNAP}
							data-key-field="t"
							value={selected().t}
							onChange={event => setTime(event.currentTarget)}
						/>
						<label>Value</label>
						<input
							type="number"
							step={ui.prop ? STEPS[ui.prop] : 1}
							data-key-field="v"
							value={round(selected().v)}
							onChange={event => {
								const value = parseFloat(event.currentTarget.value)
								if (Number.isNaN(value)) sync()
								else editKeyframe(edited => (edited.v = value))
							}}
						/>
						<label>Easing</label>
						<select
							class="wide"
							id="easing"
							disabled={isLast()}
							onChange={event => setEasing(event.currentTarget.value)}
						>
							<option value="curve" selected={custom()}>
								Custom curve
							</option>
							<For each={Object.entries(families)}>
								{([family, names]) => (
									<optgroup label={family}>
										<For each={names}>
											{name => (
												<option value={name} selected={presetName() === name}>
													{name}
												</option>
											)}
										</For>
									</optgroup>
								)}
							</For>
						</select>
					</div>
					<Show
						when={!isLast()}
						fallback={
							<p class="hint">
								This is the last keyframe of the property. Easing shapes the motion towards the next keyframe, so add
								one after it.
							</p>
						}
					>
						<CurveEditor keyframe={selected()} />
						<div class="chips">
							<For each={Object.keys(curvePresets)}>
								{name => (
									<button
										data-curve={name}
										onClick={() => editKeyframe(edited => setCurve(edited, curvePresets[name]()))}
									>
										{name}
									</button>
								)}
							</For>
						</div>
						<p class="hint">
							<Show
								when={custom()}
								fallback={
									<>
										Pick <b>Custom curve</b> (or a shape above) to draw this easing by hand.
									</>
								}
							>
								Drag points and handles. Double-click the graph to add a point, double-click a point to remove it. Hold
								Alt to bend one handle only.
							</Show>
						</p>
					</Show>
				</section>
			)}
		</Show>
	)
}

export function Inspector() {
	return (
		<aside id="inspector" class="panel">
			<header class="tabs">
				<span class="tab">Properties</span>
			</header>
			<Show
				when={doc.layers[ui.layer]}
				fallback={
					<p class="hint">
						{doc.layers.length ? 'Nothing is selected. Click a layer to select it.' : 'Add a layer to start animating.'}
					</p>
				}
			>
				{layer => (
					// A disabled fieldset disables every field in it: nothing is changed while it plays.
					<fieldset class="lock" disabled={ui.playing}>
						<LayerFields layer={layer()} />
						<KeyframeFields />
					</fieldset>
				)}
			</Show>
		</aside>
	)
}
