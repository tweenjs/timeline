import {createSignal, onCleanup} from 'solid-js'
import {attachHighlight} from '../highlight/mirror'
import {codeTyped, getCode, registerCode, ui} from '../state'

/**
 * The timeline as code. The text lives in the textarea, not in state: the
 * editor writes it after an edit, and reads it back as it is typed.
 */
export function CodePanel() {
	const [copyLabel, setCopyLabel] = createSignal('Copy')
	let code!: HTMLTextAreaElement
	let detach = () => {}
	let stopped = false
	onCleanup(() => {
		stopped = true
		detach()
	})

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(getCode())
			setCopyLabel('Copied')
		} catch {
			code.select()
			setCopyLabel('Press Ctrl+C')
		}
		setTimeout(() => setCopyLabel('Copy'), 1500)
	}

	return (
		<aside id="code-panel" class="panel">
			<div id="code-head">
				<strong>Code</strong>
				<span id="code-status" class={ui.status.kind} title={ui.status.text}>
					{ui.status.text}
				</span>
				<button id="copy" onClick={copy}>
					{copyLabel()}
				</button>
			</div>
			<div id="code-box">
				<textarea
					id="code"
					spellcheck={false}
					wrap="off"
					aria-label="Timeline code"
					ref={element => {
						code = element
						registerCode(element)
						// Its box is there once the panel is built.
						queueMicrotask(() => {
							if (!stopped) detach = attachHighlight(element)
						})
					}}
					onInput={codeTyped}
					onKeyDown={event => {
						if (event.key !== 'Tab') return
						event.preventDefault()
						const field = event.currentTarget
						field.setRangeText('\t', field.selectionStart, field.selectionEnd, 'end')
						codeTyped()
					}}
				/>
			</div>
		</aside>
	)
}
