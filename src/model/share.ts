import {normalizeDoc} from './compiler'
import type {Doc} from './types'

/**
 * A shared link is the page's address and, as its fragment, the code of the
 * timeline in base64: `https://example.org/#aW1wb3J0IHtFYXNpbmcs…`. Anyone can
 * read it back with `atob()`, and nothing is uploaded: a fragment is not sent
 * to the server.
 *
 * The alphabet is the URL-safe one (`-` and `_`, no padding), so that a link
 * survives being pasted into a chat. Standard base64 is read as well.
 *
 * Code is run to become a timeline, so the editor asks before it opens a link.
 *
 * Links made before this (`#t=…`: the document as deflated JSON) still open.
 */

/** The code of a link, as base64 of its UTF-8 bytes. */
export function encodeCode(code: string): string {
	const bytes = new TextEncoder().encode(code)
	let binary = ''
	// In pieces: a long argument list overflows the stack.
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The code in a link's fragment. Throws when it is not base64 of text. */
export function decodeCode(text: string): string {
	if (text.length > LIMIT * 1.4) throw new Error('The shared code is too large.')
	// Some apps escape the fragment, or break it over lines.
	try {
		text = decodeURIComponent(text)
	} catch {}
	text = text.replace(/\s+/g, '')
	if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) throw new Error('The link does not hold base64.')
	let binary: string
	try {
		binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''))
	} catch {
		throw new Error('The link does not hold base64.')
	}
	const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
	try {
		return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
	} catch {
		throw new Error('The link does not hold text.')
	}
}

export function shareUrl(code: string): string {
	return location.origin + location.pathname + location.search + '#' + encodeCode(code)
}

const LIMIT = 2_000_000 // bytes of JSON

async function pipe(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
	const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	for (;;) {
		const {done, value} = await reader.read()
		if (done) break
		size += value.length
		if (size > LIMIT) throw new Error('The shared timeline is too large.')
		chunks.push(value)
	}
	return new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer())
}

export async function encodeDoc(doc: Doc): Promise<string> {
	const json = new TextEncoder().encode(JSON.stringify(doc))
	const compress = 'CompressionStream' in globalThis
	const bytes = compress ? await pipe(json, new CompressionStream('deflate-raw')) : json
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return (compress ? 'z' : 'j') + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function decodeDoc(text: string): Promise<Doc> {
	if (text.length > LIMIT) throw new Error('The shared timeline is too large.')
	const binary = atob(text.slice(1).replace(/-/g, '+').replace(/_/g, '/'))
	let bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
	if (text[0] === 'z') bytes = (await pipe(bytes, new DecompressionStream('deflate-raw'))) as Uint8Array<ArrayBuffer>
	// A link is not from this editor: it may not bring code along as data.
	return normalizeDoc(JSON.parse(new TextDecoder().decode(bytes)), false)
}
