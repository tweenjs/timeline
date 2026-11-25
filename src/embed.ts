/**
 * The editor inside another page (the docs): `index.html?embed=<view>`.
 *
 * It is the whole editor running for real, not a picture of it, so everything
 * works: play, drag, type code. Three things differ.
 *
 * - It remembers nothing and reads nothing it remembered (the timeline, the
 *   panel sizes): an example on a docs page must not replace the user's own
 *   work, which is in the same storage. The theme is only read.
 * - It shows one part of the editor, or all of it (`view`, see styles.css).
 * - Its start can be set by the address: which template, which layer and
 *   keyframe are selected, where the playhead is, which menu is open.
 *
 *   embed     window | stage | properties | timeline | transport | code | menu
 *   template  a template by name, as in the Templates menu (else the demo)
 *   select    the name of a layer to select; with `prop` (x, y, scale,
 *             rotation, opacity) and `key` (index) a keyframe
 *   seek      the playhead, in ms
 *   play      any value: start playing
 *   menu      the title of a menu to open (File, Edit…); `sub` a submenu of it
 *   do        actions to run, as named in the menus ("share,check")
 *
 * A link with a `#…` fragment opens as it does in the editor: the code is
 * shown and nothing runs before it is accepted.
 */
const query = new URLSearchParams(location.search)

export const embedView = query.get('embed')
export const embedded = embedView !== null
export const embedQuery = query

// Which part of the editor to show: a rule in styles.css for each.
if (embedded) document.documentElement.dataset.embed = embedView!
