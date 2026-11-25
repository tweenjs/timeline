/**
 * The tokenizer: Lezer's JavaScript grammar (the parser CodeMirror 6 uses).
 * It is a lazy chunk (see mirror.ts), so none of it loads until the Code box
 * has code to show.
 */
import {parser} from '@lezer/javascript'
import {highlightTree, tagHighlighter, tags as t} from '@lezer/highlight'

/** Each kind of token is a CSS highlight named `code-<kind>`: see highlight.css. */
export const KINDS = ['kw', 'str', 'esc', 'num', 'atom', 'com', 'prop', 'def', 'fn', 'type', 'op', 'punct'] as const
export type Kind = (typeof KINDS)[number]

const highlighter = tagHighlighter([
	{tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], class: 'kw'},
	{tag: [t.string, t.docString], class: 'str'},
	{tag: [t.regexp, t.escape, t.special(t.string)], class: 'esc'},
	{tag: t.number, class: 'num'},
	{tag: [t.bool, t.null, t.atom, t.self], class: 'atom'},
	{tag: t.comment, class: 'com'},
	{tag: t.propertyName, class: 'prop'},
	{
		tag: [t.definition(t.variableName), t.definition(t.propertyName), t.definition(t.function(t.variableName))],
		class: 'def',
	},
	{tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'fn'},
	{tag: [t.typeName, t.className, t.namespace], class: 'type'},
	{tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator, t.updateOperator], class: 'op'},
	{tag: t.punctuation, class: 'punct'},
])

/** The tokens of `text` that have a colour: `[from, to, kind]`, in order. */
export function tokens(text: string): Array<[number, number, Kind]> {
	const found: Array<[number, number, Kind]> = []
	highlightTree(parser.parse(text), highlighter, (from, to, kind) => {
		found.push([from, to, kind as Kind])
	})
	return found
}
