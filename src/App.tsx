import {CodePanel} from './components/CodePanel'
import {Dialog} from './components/Dialog'
import {Inspector} from './components/Inspector'
import {MenuBar} from './components/MenuBar'
import {Stage} from './components/Stage'
import {TimelinePanel} from './components/TimelinePanel'
import {Toolbar, Transport} from './components/Toolbar'
import {Divider} from './layout'
import {ui} from './state'

export function App() {
	return (
		<>
			<div id="app" data-playing={ui.playing ? '' : undefined}>
				<MenuBar />
				<Toolbar />
				<Inspector />
				<Stage />
				<CodePanel />
				<Transport />
				<TimelinePanel />
				<Divider side="left" />
				<Divider side="right" />
				<Divider side="bottom" />
			</div>
			<Dialog />
		</>
	)
}
