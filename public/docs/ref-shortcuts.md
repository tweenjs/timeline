# Shortcuts

Every keyboard shortcut and pointer gesture of the editor. <kbd>Ctrl</kbd> is <kbd>Cmd</kbd> on a Mac.

<div class="demo" id="shortcut-filter">
<header><b>Find a shortcut</b> · type a key or a word</header>
<input id="shortcut-search" oninput="var q=this.value.toLowerCase().trim(),n=0;document.querySelectorAll('.markdown-section table tbody tr').forEach(function(r){var m=!q||r.textContent.toLowerCase().indexOf(q)>-1;r.style.display=m?'':'none';if(m)n++});document.getElementById('shortcut-count').textContent=q?n+' of the shortcuts and gestures match':''" type="search" placeholder="e.g. space, delete, scrub, undo" aria-label="Filter the shortcuts" style="width:100%;height:32px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--color-text);font:inherit">
<p id="shortcut-count" style="margin:8px 0 0;color:var(--muted);font-size:13px"></p>
</div>

## Keyboard

The keys work anywhere in the editor **except while you are typing in a field, a list or the Code panel**. Only <kbd>Ctrl</kbd>+<kbd>S</kbd> and <kbd>Ctrl</kbd>+<kbd>O</kbd> also work there. They do not work while a dialog is open.

| Keys                                                                          | Action                           | Notes                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| <kbd>Space</kbd>                                                              | Play, or pause when playing      | The same as Play and Pause in the Media menu. A focused button is not also pressed. |
| <kbd>Home</kbd>                                                               | Playhead to 0 s                  |                                                                                     |
| <kbd>End</kbd>                                                                | Playhead to the end              |                                                                                     |
| <kbd>←</kbd> / <kbd>→</kbd>                                                   | Playhead 10 ms back / forward    | Snaps to the 10 ms grid first.                                                      |
| <kbd>Shift</kbd>+<kbd>←</kbd> / <kbd>→</kbd>                                  | Playhead 100 ms back / forward   |                                                                                     |
| <kbd>Page Up</kbd>                                                            | Previous keyframe, else 0 s      | Of the selected layer, or of all layers if none is selected.                        |
| <kbd>Page Down</kbd>                                                          | Next keyframe, else the end      | Same.                                                                               |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd>                                      | Delete the selected keyframe     | Refused while playing. Nothing happens without a selected keyframe.                 |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>                                                  | Undo                             | Up to 200 steps.                                                                    |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> or <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo                             |                                                                                     |
| <kbd>Ctrl</kbd>+<kbd>]</kbd>                                                  | Bring the selected layer forward | One step towards the top.                                                           |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>]</kbd>                                 | Bring it to the top              |                                                                                     |
| <kbd>Ctrl</kbd>+<kbd>[</kbd>                                                  | Send the selected layer backward | One step towards the bottom.                                                        |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>[</kbd>                                 | Send it to the bottom            |                                                                                     |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                                                  | Save: download `timeline.js`     | Works while typing code, too. The browser's own save is prevented.                  |
| <kbd>Ctrl</kbd>+<kbd>O</kbd>                                                  | Open a `.js` file                | Works while typing code, too.                                                       |

Other <kbd>Ctrl</kbd> combinations are left to the browser.

### In the Code panel

| Keys                         | Action                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| <kbd>Tab</kbd>               | Inserts a tab character (it does not move the focus).                                   |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undoes your _typing_ (the browser's own undo of the text field), not the editor's Undo. |

Typing is compiled a moment after you stop; see [Code format](ref-code).

### On a divider

Focus a divider with <kbd>Tab</kbd>, then:

| Keys                                        | Action                                    |
| ------------------------------------------- | ----------------------------------------- |
| Left divider: <kbd>→</kbd> / <kbd>←</kbd>   | Properties wider / narrower, 16 px a step |
| Right divider: <kbd>←</kbd> / <kbd>→</kbd>  | Code wider / narrower                     |
| Bottom divider: <kbd>↑</kbd> / <kbd>↓</kbd> | Timeline taller / shorter                 |

### In the menus

| Keys                                             | Action                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Move between titles and items; a submenu opens while it has focus. |
| <kbd>Enter</kbd> / <kbd>Space</kbd>              | Open a menu or run an item.                                        |
| <kbd>Esc</kbd>                                   | Close the open menu (or a dialog).                                 |

## Pointer

| Gesture                  | Where                                    | Action                                                                             |
| ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Click                    | A layer on the stage                     | Select it.                                                                         |
| Click                    | The empty stage                          | Select nothing.                                                                    |
| Drag                     | A layer on the stage                     | Move it: writes `x` and `y` at the playhead. One undo step. Refused while playing. |
| Click                    | A layer row, a property row              | Select the layer, or the layer and property.                                       |
| Click                    | A keyframe diamond                       | Select the keyframe.                                                               |
| Drag                     | A keyframe diamond                       | Move it in time, on the 10 ms grid. Refused while playing.                         |
| Double-click             | An empty part of a property lane         | Add a keyframe there.                                                              |
| Click, or press and drag | The ruler                                | Move the playhead (scrub). Works while playing.                                    |
| Click                    | ◆ in a property row                      | Add or remove a keyframe at the playhead.                                          |
| Click                    | ▾ / ▸ in a layer row                     | Fold or unfold its property rows.                                                  |
| Click                    | ✕ in a layer row                         | Delete the layer.                                                                  |
| Drag                     | A node or handle in the curve graph      | Move it.                                                                           |
| <kbd>Alt</kbd>+drag      | A handle in the curve graph              | Bend one side only: a sharp corner.                                                |
| Double-click             | The curve graph                          | Add a point.                                                                       |
| Double-click             | A point in the curve graph               | Remove it (not the first or the last).                                             |
| Drag                     | A divider                                | Resize the panel beside it.                                                        |
| Double-click             | A divider                                | The panel's default size.                                                          |
| Hover                    | Another menu title, while a menu is open | Switch to that menu.                                                               |

See [Curve tool](ref-curve) for the graph in detail.
