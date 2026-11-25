import {templates} from '../model/templates'
import {actions} from '../state'

type Action = {action: string; label: string; hint?: string; note?: string; disabled?: boolean}
type Item =
	| Action
	| {href: string; label: string; hint?: string}
	| {heading: string}
	| {submenu: string; items: Item[]}
	| 'separator'

const menus: Array<{title: string; items: Item[]}> = [
	{
		title: 'File',
		items: [
			{action: 'create', label: 'Create', hint: 'Empty timeline'},
			{action: 'open', label: 'Open…', hint: 'JS timeline · Ctrl+O'},
			{action: 'save', label: 'Save', hint: 'JS timeline · Ctrl+S'},
			'separator',
			{action: 'share', label: 'Share…', hint: 'Link'},
		],
	},
	{
		title: 'Edit',
		items: [
			{action: 'scale', label: 'Scale…', hint: 'Stretch time'},
			'separator',
			{heading: 'Layers'},
			{action: 'layer-new', label: 'New layer'},
			{action: 'layer-top', label: 'Bring to top', hint: 'Ctrl+Shift+]'},
			{action: 'layer-forward', label: 'Bring forward', hint: 'Ctrl+]'},
			{action: 'layer-backward', label: 'Send backward', hint: 'Ctrl+['},
			{action: 'layer-bottom', label: 'Send to bottom', hint: 'Ctrl+Shift+['},
		],
	},
	{
		title: 'Media',
		items: [
			{action: 'play', label: 'Play', hint: 'Space'},
			{action: 'pause', label: 'Pause', hint: 'Space'},
			{action: 'stop', label: 'Stop', hint: 'Pause at start'},
			{action: 'restart', label: 'Restart', hint: 'Play from start'},
		],
	},
	{
		title: 'Format',
		items: [
			{action: 'format', label: 'Format code'},
			{action: 'check', label: 'Check code'},
			'separator',
			{
				submenu: 'Migrations',
				items: [
					{
						submenu: 'Import',
						items: [
							{action: 'import-es6-tween', label: 'Import from es6-tween…'},
							{action: 'import-kute', label: 'Import from Kute.js…'},
						],
					},
					{
						submenu: 'Export',
						items: [
							{action: 'export-es6-tween', label: 'Export to es6-tween…'},
							{action: 'export-kute', label: 'Export to Kute.js…'},
						],
					},
				],
			},
		],
	},
	{
		title: 'Templates',
		items: [
			{
				submenu: 'Pre-ready',
				items: templates.map(template => ({
					action: 'template:' + template.name,
					label: template.name,
					note: template.description,
				})),
			},
			{action: 'import-pack', label: 'Import templates pack…', hint: 'Soon', disabled: true},
			{action: 'demo', label: 'Demo', hint: 'The starting timeline'},
		],
	},
	{
		title: 'Help',
		items: [
			{action: 'about', label: 'About'},
			{href: 'docs/index.html', label: 'Docs', hint: 'How to use'},
		],
	},
]

/**
 * Menus are native and styled by CSS (see styles.css): each is a `popover`
 * that its title opens and an item closes (`popovertarget`), with Escape and
 * a click outside closing it too. A submenu opens by `:hover` and
 * `:focus-within`. There is no state here and no event handling beyond
 * running the action.
 */
function menuItem(item: Item, root: string) {
	if (item === 'separator') return <hr />
	if ('heading' in item) return <h4>{item.heading}</h4>
	if ('submenu' in item) {
		return (
			<div class="submenu">
				<button role="menuitem" aria-haspopup="true" data-submenu={item.submenu}>
					{item.submenu} <small>▸</small>
				</button>
				<div class="menu-items" role="menu">
					{item.items.map(inner => menuItem(inner, root))}
				</div>
			</div>
		)
	}
	if ('href' in item) {
		// Only buttons can close a popover declaratively: a link closes it by hand.
		return (
			<a
				role="menuitem"
				href={item.href}
				target="_blank"
				rel="noopener"
				onClick={event => event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()}
			>
				{item.label} <small>{item.hint}</small>
			</a>
		)
	}
	return (
		<button
			role="menuitem"
			class={{detailed: !!item.note}}
			data-action={item.action}
			disabled={item.disabled}
			title={item.disabled ? 'Not available yet' : undefined}
			popovertarget={root}
			popovertargetaction="hide"
			onClick={() => void actions[item.action]()}
		>
			<span>
				{item.label}
				{item.note && <em>{item.note}</em>}
			</span>{' '}
			<small>{item.hint}</small>
		</button>
	)
}

/** The menus that are open: only the ones this bar opens, not a submenu. */
const open = (bar: HTMLElement) => bar.querySelectorAll<HTMLElement>(':scope > .menu > .menu-items:popover-open')

/**
 * Once a menu has been opened by a click, the pointer moves between them: over
 * another title that one opens in its place (a popover closes the others), and
 * out of the bar and the menus they all close. Nothing opens by hover alone.
 */
const hover = {
	onPointerOver(event: PointerEvent & {currentTarget: HTMLElement}) {
		const title = (event.target as HTMLElement).closest<HTMLElement>('.menu-title')
		if (!title || !open(event.currentTarget).length) return
		const menu = title.nextElementSibling as HTMLElement
		if (!menu.matches(':popover-open')) menu.showPopover()
	},
	onPointerLeave(event: PointerEvent & {currentTarget: HTMLElement}) {
		for (const menu of open(event.currentTarget)) menu.hidePopover()
	},
}

export function MenuBar() {
	return (
		<nav id="menu" aria-label="Main menu" {...hover}>
			{menus.map((menu, index) => (
				<div class="menu">
					<button class="menu-title" popovertarget={'menu-' + index}>
						{menu.title}
					</button>
					<div id={'menu-' + index} class="menu-items" role="menu" popover>
						{menu.items.map(item => menuItem(item, 'menu-' + index))}
					</div>
				</div>
			))}
		</nav>
	)
}
