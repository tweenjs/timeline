# How it works

The editor has one idea at its centre: an animation is **a document**, and the Timeline, the Stage and the Code are three views of it. You edit any view; the document changes; the others redraw. This page follows that idea down to the code, for the curious.

## One document, three views

```text
        you drag, type, click                        you type code
               |                                           |
               v                                           v
        +--------------+     generateCode(doc)     +----------------+
        |  Timeline /  | ------------------------> |   Code panel   |
        |  Properties  |                           |  (a textarea)  |
        |    (Doc)     | <------------------------ |                |
        +--------------+       parseCode(code)     +----------------+
          |         |
          |         |  setDoc(doc): one tween.js Timeline
          v         v
     +---------+  +----------------------------------+
     |  Stage  |  | Player: playhead + frame loop    |
     | (DOM)   |<-| writes transform + opacity only  |
     +---------+  +----------------------------------+
```

Everything left of the arrows is plain data. The code is _generated from_ the document, never the other way round as a source of truth: when you type code it is **read back** into a new document, and the code panel is rewritten from that.

## The document

A document (`Doc`) is a duration and a list of layers. It is small, plain JSON, and it is what gets saved to your browser's `localStorage` after every edit (`tweenjs-timeline-editor-v1`).

| Type       | Field                                       | Meaning                                                                                                                             |
| ---------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Doc`      | `duration`                                  | Length of the timeline in milliseconds.                                                                                             |
|            | `layers`                                    | The layers, **first one drawn on top**.                                                                                             |
| `Layer`    | `name`, `shape`, `color`, `width`, `height` | What it looks like. `shape` is `rect`, `circle`, `text` or `three`.                                                                 |
|            | `text`, `align`                             | Texts only: the string, and which side of it sits at `x` (`left`, `right`, or its middle without `align`).                          |
|            | `radius`                                    | Rectangles only: corner radius (6 without it).                                                                                      |
|            | `scene`                                     | `three` layers only: the code of the scene (imports and a function).                                                                |
|            | `values`                                    | The value of `x`, `y`, `scale`, `rotation`, `opacity` while that property has no keyframes.                                         |
|            | `tracks`                                    | Per property, its keyframes sorted by time. Two never share a time.                                                                 |
|            | `closed`                                    | Editor state only: the layer's property rows are folded. It is not part of the code.                                                |
| `Keyframe` | `t`, `v`                                    | Time in milliseconds, and the value there.                                                                                          |
|            | `ease`                                      | How the motion **leaving** this keyframe is shaped: `{type: 'preset', name: 'Quadratic.InOut'}` or `{type: 'curve', nodes: [...]}`. |

A curve is a list of nodes `{x, y, ix, iy, ox, oy}`: the point, and the offsets of its incoming and outgoing handles (a Bézier path from `(0, 0)` to `(1, 1)`, drawn by the [curve tool](ref-curve)).

## Timeline to code: `generateCode`

For every layer the compiler walks each property's keyframes in pairs. Each pair becomes **one tween** that starts at the first keyframe's time, lasts until the second's, and uses the first's easing. Properties that move over the same span with the same easing share one tween:

```js
.add(new Tween(ball).to({x: 550, y: 230}, 2400).easing(Easing.Quadratic.InOut), 0)
```

The layers themselves become plain objects whose `x`, `y`, `scale`, `rotation` and `opacity` are the _first keyframe's_ values, the starting values a tween needs. The import line lists only what the code uses: `Easing`, `Timeline` and `Tween` from `@tweenjs/tween.js`, plus `cubicBezier` and `curveEasing` when a curve is drawn. A curve of two points is written `cubicBezier(x1, y1, x2, y2)`, a longer one `curveEasing([[x, y, ix, iy, ox, oy], …])`.

## Code to timeline: `parseCode`

Reading is the clever part. The editor does not parse your JavaScript with a grammar. It **runs it**, in a function, with stand-ins for `Tween` and `Timeline` that _record_ instead of animating:

1. Imports are stripped (the names the code needs, `Easing`, `Tween`, `Timeline`, `cubicBezier`, `curveEasing`, are supplied directly) and `export`s are turned into plain variables.
2. The code runs. Whatever it does to build `layers` and `timeline` (loops, variables, helper functions) just works, because it is real JavaScript.
3. The stand-in `Timeline` is then started and updated once, to its very end. A real tween.js `Timeline` starts each child exactly once, at the child's offset, so every tween reports where it starts, even those inside nested timelines or after `delay()`.
4. Each recorded tween becomes keyframes: one at its start (with its easing) and one at its end, per property. A tween that begins where the previous one ended continues from it; otherwise it starts from wherever the property was, as in tween.js.

What the editor _cannot_ show (`repeat`, `yoyo`, `chain`, `interpolation`, non-numbers, overlapping tweens) is refused with a message instead of being guessed. See [Timeline and code](guide-code).

### In sync

Typing in the code panel does not rebuild anything on each key. The status reads _Editing…_; 350 ms after the last keystroke the code is read. If it works, the status says **In sync** (or lists _notes_ in amber, for things that were accepted but not kept, such as an `onUpdate` callback). If not, the status shows the error in red and the timeline keeps its last working state. The editor compares what the code _means_ with the document, not how it is written, so retyping the same animation is not an undo step. Pressing **Format code** rewrites the text in the editor's own style.

### Easings are traced

When the code gives an easing, it is recognised by identity: a built-in tween.js easing becomes a _preset_ by name; the function returned by `cubicBezier()` or `curveEasing()` carries its nodes and becomes a _curve_ again. Any other function (`k => k * k`) is **traced**: the editor samples it, places nodes where it has corners and where a curve would drift from it, until it stays within 0.01 of the original (at most 16 nodes). You get an editable curve and a note: _A custom easing function was traced into an editable curve._

## Playing

The **Player** (`player.ts`) turns the document into a tween.js `Timeline` of its own: one tween per pair of keyframes, each driving a private progress from 0 to 1 with that segment's easing. The value of a property is read from the segment under the playhead: `from + (to - from) * progress`. Because no tween writes to the layer itself, scrubbing is exact: jump to any time, in any order, and you get the same picture.

The frame loop uses the time stamp of `requestAnimationFrame`, so the animation runs at the display's rate (60, 120, 144 Hz) and never faster than real time: a frame advances the playhead by at most 250 ms, so a tab that was hidden resumes instead of jumping.

## Why it stays smooth

Playback does as little per frame as it can:

- **The playhead is not reactive state.** The Player advances it and calls listeners. No Solid computation re-runs while playing; the views write to the DOM themselves.
- **Only `transform` and `opacity`.** Each layer gets one `transform` and one `opacity` write per frame (skipped when unchanged), and so does the playhead. Those are composited by the browser: nothing is laid out or painted again. Moving parts have `will-change`, and panels are isolated with `contain`.
- **Text and fields are slower.** The time readout and the value fields update at most 30 times a second while playing.
- **Only visible code is coloured.** Syntax highlighting (Lezer's JavaScript grammar, loaded on demand) tokenizes the whole text once, but only the lines in view, and a screenful around them, are given colours: a template of 100 KB of code does not cost a frame.

## Undo, storage and sharing

- **Undo** is a stack of snapshots (the whole document as JSON, at most 200). A drag is a single step however long it takes; a template, an opened file or an import is one step too, so Undo brings back your own timeline.
- **Storage.** The document is saved to `localStorage` after every edit (while dragging, once at the end). So are the panel sizes and the theme.
- **Sharing.** A share link is the page's address plus `#` plus the code in base64. Nothing is uploaded: the fragment never reaches a server. Opening one shows the code and asks before running it, because running is how code is read. See [Sharing links](guide-share) and [Share links](ref-share).

## Three.js scenes

A layer with the shape `three` is drawn by a function in your code, with real `import`s of three.js at the top of the file. Reading the code never needs three.js: the function is only _defined_, and its source is kept. When the layer is drawn, a separate chunk (`scene3d/run`, loaded on demand) supplies three.js and runs the function on a canvas that exists only while the layer does. See [Three.js scenes](guide-three).

## The other libraries

The es6-tween and Kute.js importers and exporters (**Format › Migrations**) use the same pieces: the same recording to read, the same layer and tween printing to write. They differ in what they print and what they recognise. See [Moving to and from other libraries](guide-migrate).
