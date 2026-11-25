/**
 * Light and dark themes. Nothing is chosen until the user chooses: then the
 * page follows the operating system, and CSS does it all (`color-scheme` and
 * the `light-dark()` colours of the Radix scales, see radix.css).
 *
 * A choice is the `data-theme` attribute of the page, which overrides the
 * system's. `system` has no attribute. A few lines in `index.html` set the
 * attribute before the first paint, so the page never flashes the wrong theme.
 */
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: Theme[] = ['system', 'light', 'dark']
export const THEME_KEY = 'tweenjs-timeline-editor-theme'

export function storedTheme(): Theme {
	try {
		const stored = localStorage.getItem(THEME_KEY) as Theme | null
		return stored && THEMES.includes(stored) ? stored : 'system'
	} catch {
		return 'system'
	}
}

/** Shows a theme, without remembering it. */
export function applyTheme(theme: Theme) {
	if (theme === 'system') delete document.documentElement.dataset.theme
	else document.documentElement.dataset.theme = theme
}

/** Shows a theme and remembers it, for the editor and its docs page. */
export function saveTheme(theme: Theme) {
	applyTheme(theme)
	try {
		if (theme === 'system') localStorage.removeItem(THEME_KEY)
		else localStorage.setItem(THEME_KEY, theme)
	} catch {
		// Private browsing: the theme lasts for this visit.
	}
}

applyTheme(storedTheme())
