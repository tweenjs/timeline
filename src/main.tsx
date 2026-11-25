import {render} from '@solidjs/web'
import {App} from './App'
import {onKeyDown, openSharedLink, start} from './state'
import './styles.css'
import './highlight.css'

render(() => <App />, document.getElementById('root')!)

addEventListener('keydown', onKeyDown)
addEventListener('hashchange', () => void openSharedLink())

start()
