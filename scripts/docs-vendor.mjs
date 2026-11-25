// Docsify (https://docsify.js.org) is served from this project, not from a CDN:
// this copies the files the docs page needs from node_modules into public/docs/vendor.
import {copyFileSync, mkdirSync} from 'node:fs'

const from = new URL('../node_modules/docsify/dist/', import.meta.url)
const to = new URL('../public/docs/vendor/', import.meta.url)
mkdirSync(to, {recursive: true})
for (const file of ['docsify.min.js', 'themes/core.min.css', 'plugins/search.min.js']) {
	copyFileSync(new URL(file, from), new URL(file.split('/').pop(), to))
}
