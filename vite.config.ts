import {defineConfig} from 'vite'
import solid from '@solidjs/vite-plugin'

export default defineConfig({
	// Relative, so the build can be served from any folder (GitHub Pages).
	base: './',
	plugins: [solid()],
	server: {port: 5173},
	preview: {port: 4173},
})
