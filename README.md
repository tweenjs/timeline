# tween.js timeline editor

A small keyframe editor for [tween.js](https://github.com/tweenjs/tween.js), in the spirit of After Effects or
Premiere: layers, keyframes, a curve tool for custom easings, and a compiler that keeps the timeline and its
tween.js code in sync in both directions. Built with [Solid](https://www.solidjs.com/) 2.

- **Timeline**: layers (rectangle, circle, text) with `x`, `y`, `scale`, `rotation` and `opacity` tracks.
- **Curve tool**: draw an easing by hand, or start from any built-in tween.js easing.
- **Timeline ⇄ code**: every edit rewrites the code; typing code updates the timeline.
- **Menu**: File (create, open, save, share link), Edit (scale time, restack layers), Media, Format (format and
  check code, migrate to and from es6-tween and Kute.js), Templates (nine finished scenes: five that look 3D, three of product motion, one in real 3D with three.js), Help.

How to use it is described in the docs, a [Docsify](https://docsify.js.org) site of markdown pages in [`public/docs/`](public/docs/README.md): getting started, guides, how it works, and a reference of every function. The editor links it from **Help › Docs**. Docsify is served from this project (`bun run sync-helper` copies it from `node_modules`), and the pictures are made by `bun run docs:shots`.

## Run

The editor needs the tween.js `Timeline`, which is not in a published release yet (25.0.0 on npm has none).
`package.json` therefore depends on the upstream commit that has it, `github:tweenjs/tween.js#<commit>`; its
`dist/` is committed, so nothing is built on install. Move to a release when one has the `Timeline`.

Live: <https://tweenjs.github.io/timeline/> (built and published from `main` by `.github/workflows/ci.yml`).

```sh
bun install
bun run dev        # http://localhost:5173
bun run build      # type-check and build to dist/
bun run test       # model tests, build, browser tests
```

`bun run test-e2e-dev` runs the browser tests against the dev server, where Solid reports reactivity mistakes
on the console; the tests fail on any console warning or error. The browser tests need Playwright's Chromium
(`bunx playwright install chromium`).

## How it is built

```
src/model/     the document and everything computed from it; no DOM, no Solid
  types.ts         Doc, Layer, Keyframe, Ease
  easingCurve.js   curve easings (cubicBezier, curveEasing), which the editor runs; generated code imports them from @tweenjs/tween.js
  curveTools.ts    tracing easings into curves, SVG path data, sampling tracks
  compiler.ts      generateCode(doc) and parseCode(code)
  migrate.ts       es6-tween and Kute.js, both directions
  bake.ts          any motion, as a function of time, into keyframes and easings
  templates.ts     the pre-ready scenes that look 3D, the list of all nine, and the demo
  motion.ts        the three product-motion scenes, keyframed by hand
  share.ts         share links: the code in base64, in the URL fragment
src/scene3d/   the three.js black hole layer, loaded on demand
src/player.ts  playback: a tween.js Timeline, the playhead and the frame loop
src/state.tsx  the Solid store, undo, and every action
src/components/
```

### Smooth playback

Playback runs at the refresh rate of the display, and a frame does as little as possible:

- The playhead is **not reactive state**. `player.ts` advances it from the `requestAnimationFrame` timestamp,
  updates the tween.js `Timeline`, and calls its listeners. No Solid computation runs during playback.
- Per frame, each layer gets one `transform` and one `opacity` write (skipped when unchanged), and the playhead
  one `transform`. These are composited: nothing is laid out or painted again. Moving parts have `will-change`,
  panels have `contain`.
- Text and form fields that follow the playhead (the time readout, the value fields) update at most 30 times a
  second while playing.
- The frame loop only runs while playing.
- Pointer drags are applied once per frame with the latest pointer position; the code panel and storage are
  written once, when the drag ends.
- Edits go through a Solid store, so a change redraws only what reads the changed value.

### Scrubbing

The player does not tween the layers themselves. It adds one tween per keyframe pair to the `Timeline`, each
driving a private 0 → 1 progress with the segment's easing, and reads a value from the segment under the
playhead. The reason: when several tweens animate the same property one after another, seeking a tween.js
`Timeline` backwards leaves the property at a later tween's value (0 → 100 then 100 → 300, `update(1500)` then
`update(500)` gives 100, not 50). Generated code plays forwards and is not affected.

### Timeline ⇄ code

`generateCode()` writes a module with one plain object per layer and a `Timeline` with one `Tween` per keyframe
pair. `parseCode()` does not parse JavaScript: it runs the code with recording stand-ins for `Tween` and
`Timeline`, and builds the document from what the code animates. So loops, variables, labels and nested
timelines all work, and code the editor cannot show (`repeat`, `yoyo`, `chain()`, overlapping tweens of one
property) is refused with a message. The migrations work the same way, with stand-ins for the other libraries.

**Code typed, opened or imported is executed in the page.** Only open code you trust. A shared link is the page's address
with the code in base64 as its fragment (`https://example.org/#aW1wb3J0…`, URL-safe alphabet, readable with
`atob()`, never sent to a server). Since that code would be run, opening a link shows the code and asks first.
Links from before this (`#t=…`, the document as deflated JSON) still open, as data validated field by field.

### Templates

Five of the pre-ready scenes look 3D while the document stays flat: a layer has a position, a scale, a rotation
and an opacity. Each scene is written as 3D motion in `templates.ts`, projected, and baked into ordinary
keyframes by `bake.ts`, which matches each stretch of motion against the built-in easings (a quarter turn of a
circle is exactly `Sinusoidal.In` or `.Out`), traces it with a curve when none fits, and splits it when neither
does. Something that passes behind something else is a pair of layers, above and below, that swap at the
crossing. Curve lookup tables are cached so an edit does not rebuild them.

Three more are product motion (`motion.ts`): Sign-in flow, Launch film and Dashboard, 15 to 17 seconds and 125 to
175 layers each. They are not baked: a small `Scene` builder adds rectangles, circles and texts from back to
front, and helpers (`to`, `show`, `pop`, `rise`, `press`, `pulse`) write keyframes in the order things happen,
and throw when a move is written before an earlier one ends. Typing is a cover of the background colour sliding
off a text; a bar grows from behind a strip of the background colour; a number counts by one text replacing
another. Two static layer fields exist for these scenes: `radius` (corners of a rectangle) and `align` (which
side of a text is at `x`).

The last, Black hole, is real 3D: a layer with the shape `three`, whose `scene` is a function in the code
panel (source: `src/scene3d/blackhole.js`), with real `import`s of [three.js](https://threejs.org/) and its
addons at the top of the code. A scene is `function (canvas) { return {draw(frame), dispose?()} }`, or a draw
function alone, and must use only what it imports and what it defines inside itself: `frame` has `time`,
`duration`, `playing`, `width`, `height`, `x`, `y`, `scale`, `rotation` and `opacity`. Any `three` layer without a
scene gets a small spinning cube (`src/scene3d/cube.js`). Importable modules are listed in `src/scene3d/run.ts`.
A shared link with a scene of its own is run only after it is accepted, and the old data links refuse them.
Each frame of the Black hole has four steps:

1. The scene of objects is rendered to a texture with depth: a companion star with a procedural surface, a
   ringed gas giant with a moon, a rocky planet, an instanced belt of rocks (all on Kepler ellipses), about
   2,500 soft cloud sprites (rim dust, far clouds, jets, a stream of gas from the star), a nebula and 7,000
   stars. Vertices behind the hole go through the gravitational lens equation, in custom shaders and
   (through `onBeforeCompile`) in three.js's standard material alike.
2. The hole and its disk are traced over it: a fragment shader follows a ray of light per pixel along the
   null geodesics of a Schwarzschild black hole and marches it through a volume of gas, with Kepler speeds,
   Doppler beaming and gravitational redshift. The depth of step 1 stops a ray at the first solid thing, so
   planets and rocks pass correctly in front of and behind the disk.
3. Clouds in front of the hole are drawn over the result.
4. Bloom, tone mapping and grain, from three.js post-processing.

All motion is a function of the playhead, in whole turns per loop, so scrubbing is exact and the loop is
seamless. The layer's `rotation` and `scale` move the camera, so the timeline, the code and undo work on it
like on any layer. three.js is loaded only when a document has such a layer. While playing, the scene lowers
its render resolution when frames arrive late and raises it again when they do not.

### Migrations

Neither es6-tween nor Kute.js has the curve tool, so custom curves are exported as
[owneasing](https://www.npmjs.com/package/owneasing) paths. This project does not bundle or depend on
owneasing: it is only named in exported code. Note that owneasing is GPL-3.0 if you add it to your project.

- **es6-tween**: one es6-tween `Timeline`; each keyframe pair is a plain `{from, to, duration, easing}` object
  passed to `add()` with its time. Three things in es6-tween 5.5.11 shape it: `new Timeline()` starts at
  `now()`, so `{startTime: 0}` is needed for times to count from zero; `add()` without a time continues from
  a length that counts each time twice; and a Timeline ends at that length, which can be before its last tween
  ends, so the export adds an empty entry as long as the animation when needed. The import reads `add()` with
  tweens, arrays and plain objects, labels, and `to()` with its stagger modes, and warns where es6-tween does
  not do what the code says. es6-tween is a dev dependency: `bun run test-model` plays every export, and every
  form the import reads, in es6-tween itself and compares each object over time.
- **Kute.js**: animates elements, and one tween writes its element's whole `transform`, so properties with
  their own timing are exported to nested elements; positions and angles are rounded to whole numbers. The
  export is checked against this project's Kute.js importer, not against Kute.js running in a browser.

## Licence

MIT, see [LICENSE](LICENSE).

## Styling

The interface is styled with CSS only, to look like [Radix Themes](https://www.radix-ui.com/themes): its Button
(soft, solid, ghost), Text Field, Select, Slider, Tabs, Card, Dropdown Menu and Dialog, written as rules on
native elements from Radix Themes's own stylesheets. Radix's components are React-only, so what is shared is
its tokens: [Radix Colors](https://www.radix-ui.com/colors)
(`@radix-ui/colors`: slate as `--gray-*`, indigo as `--accent-*`, plus red, green, amber) and the space, type,
radius and shadow scales of Radix Themes, in `src/radix.css`. `scripts/radix-scales.mjs` (run by `bun run
sync-helper`) joins each light and dark scale into `src/radix-scales.css` with `light-dark()`.

What would be script elsewhere is the platform here:

- **Light and dark**: `color-scheme: light dark` and `light-dark()`. The system theme needs no script at all;
  the switcher only sets `data-theme` (and saves it), which overrides it.
- **Menus**: `popover` with `popovertarget` (click, Escape and click-outside close), placed by CSS anchor
  positioning; submenus open by `:hover` and `:focus-within`. The menu bar has no state.
- **Dialog**: the native `<dialog>`, faded in with `@starting-style`.

Still script, because CSS cannot do it: dragging the panel dividers and remembering their sizes, the
playhead and keyframe dragging, and the timeline itself. Anchor positioning needs Chrome 125, Safari 26 or
Firefox 147 or newer. Opening a menu by hovering over its neighbour while another is open is gone: a click
opens each one.
