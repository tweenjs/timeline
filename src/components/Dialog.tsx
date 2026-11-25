import {Show} from 'solid-js'
import {dialog, registerDialog, ui} from '../state'

/** The one modal dialog, and the toast. What they show is decided in state.tsx. */
export function Dialog() {
	return (
		<>
			<dialog id="dialog" class={{wide: !!dialog()?.wide}} ref={registerDialog}>
				<Show when={dialog()} keyed>
					{spec => (
						<form method="dialog">
							<h2>{spec.title}</h2>
							{spec.body()}
							<div class="dialog-actions">
								<Show
									when={spec.confirm}
									fallback={
										<button value="ok" class="solid">
											Close
										</button>
									}
								>
									<button value="cancel" formnovalidate>
										Cancel
									</button>
									<button value="ok" class="solid">
										{spec.confirm}
									</button>
								</Show>
							</div>
						</form>
					)}
				</Show>
			</dialog>
			<div id="toast" role="status" class={{show: ui.toastShown}}>
				{ui.toast}
			</div>
		</>
	)
}
