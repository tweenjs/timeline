import blackHoleModule from '../scene3d/blackhole.js?raw'
import cubeModule from '../scene3d/cube.js?raw'

/**
 * A three.js layer's scene, as code: the import statements it needs and the
 * source of one function, `(canvas) => ({draw(frame), dispose()})`. It is
 * code so that it is in the code panel like everything else, can be edited
 * there, and is saved, shared and undone with the timeline. `scene3d/run.ts`
 * turns it into a running scene.
 *
 * The function must hold everything it uses: only it and the imports are kept.
 */
export type SceneCode = {imports: string[]; source: string}

const IMPORT = /^[ \t]*(import\s[^;'"\n]*?\sfrom\s*['"]three(?:\/[^'"\n]*)?['"])[ \t]*;?[ \t]*$/gm

/** The statements of `code` that import three.js or one of its addons, as written. */
export function threeImports(code: string): string[] {
	return [...new Set([...code.matchAll(IMPORT)].map(match => match[1].trim()))]
}

export function isThreeImport(statement: unknown): statement is string {
	return typeof statement === 'string' && statement.length < 400 && threeImports(statement)[0] === statement
}

/** The scene of a module that imports three.js and exports one function. */
function sceneOf(module: string): SceneCode {
	return {imports: threeImports(module), source: module.slice(module.indexOf('export function ') + 7).trimEnd()}
}

/** The Black hole template's scene: scene3d/blackhole.js. */
export const BLACK_HOLE: SceneCode = sceneOf(blackHoleModule)
/** The scene a layer gets when its shape is set to `three`: scene3d/cube.js. */
export const CUBE: SceneCode = sceneOf(cubeModule)

export const sameScene = (a: SceneCode, b: SceneCode) =>
	a.source === b.source && a.imports.join('\n') === b.imports.join('\n')
