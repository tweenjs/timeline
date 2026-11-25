import * as THREE from 'three'
import * as RoundedBoxGeometry from 'three/addons/geometries/RoundedBoxGeometry.js'
import * as EffectComposer from 'three/addons/postprocessing/EffectComposer.js'
import * as OutputPass from 'three/addons/postprocessing/OutputPass.js'
import * as Pass from 'three/addons/postprocessing/Pass.js'
import * as RenderPass from 'three/addons/postprocessing/RenderPass.js'
import * as ShaderPass from 'three/addons/postprocessing/ShaderPass.js'
import * as UnrealBloomPass from 'three/addons/postprocessing/UnrealBloomPass.js'
import type {SceneCode} from '../model/scenes'

/**
 * Runs the scene of a three.js layer: the code that is in the code panel.
 *
 * A scene's imports are resolved here rather than by the browser, because the
 * code is text in the editor, not a file. These are the modules it can import.
 * This file is its own chunk: three.js is only loaded once a document has a
 * three.js layer.
 */
const MODULES: Record<string, Record<string, unknown>> = {
	three: THREE,
	'three/addons/geometries/RoundedBoxGeometry.js': RoundedBoxGeometry,
	'three/addons/postprocessing/EffectComposer.js': EffectComposer,
	'three/addons/postprocessing/OutputPass.js': OutputPass,
	'three/addons/postprocessing/Pass.js': Pass,
	'three/addons/postprocessing/RenderPass.js': RenderPass,
	'three/addons/postprocessing/ShaderPass.js': ShaderPass,
	'three/addons/postprocessing/UnrealBloomPass.js': UnrealBloomPass,
}

/** What a scene is drawn from: the playhead, and the layer at that moment. */
export type SceneFrame = {
	time: number
	duration: number
	playing: boolean
	width: number
	height: number
	x: number
	y: number
	scale: number
	rotation: number
	opacity: number
}
export type SceneView = {draw(frame: SceneFrame): void; dispose?(): void}

/** The names an import statement brings in, with what they are. */
function bindings(statement: string): Array<[string, unknown]> {
	const match = statement.match(/^import\s+([\s\S]+?)\s+from\s*['"]([^'"]+)['"]$/)
	if (!match) throw new Error('This import cannot be read: ' + statement)
	const path = match[2].replace(/^three\/examples\/jsm\//, 'three/addons/')
	const module = MODULES[path]
	if (!module) {
		throw new Error(`'${match[2]}' cannot be imported in the editor. It has: ${Object.keys(MODULES).join(', ')}.`)
	}

	const found: Array<[string, unknown]> = []
	let clause = match[1]
	const named = clause.match(/\{([^}]*)\}/)
	if (named) {
		for (const part of named[1].split(',')) {
			const [name, alias = name] = part.trim().split(/\s+as\s+/)
			if (!name) continue
			if (!(name in module)) throw new Error(`'${match[2]}' has no export named ${name}.`)
			found.push([alias.trim(), module[name]])
		}
		clause = clause.replace(named[0], '')
	}
	const namespace = clause.match(/\*\s*as\s+([\w$]+)/)
	if (namespace) {
		found.push([namespace[1], module])
		clause = clause.replace(namespace[0], '')
	}
	const standard = clause.replace(/,/g, '').trim()
	if (standard) found.push([standard, module.default])
	return found
}

/** Builds the scene on a canvas. Throws what the scene's code throws. */
export function mountScene(canvas: HTMLCanvasElement, scene: SceneCode): SceneView {
	const scope = scene.imports.flatMap(bindings)
	const make = new Function(...scope.map(([name]) => name), `'use strict'\nreturn (${scene.source}\n)`)(
		...scope.map(([, value]) => value),
	)
	if (typeof make !== 'function') throw new Error('`scene` must be a function that gets the canvas.')
	const view = make(canvas)
	if (typeof view === 'function') return {draw: view}
	if (typeof view?.draw !== 'function') {
		throw new Error('The scene function must return {draw(frame) {...}}, or a function that draws a frame.')
	}
	return view
}
