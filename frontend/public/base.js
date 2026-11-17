/**
 * Every URL the page asks the server for, resolved against the page itself. The same files then work at
 * http://localhost:3300/ and behind a path prefix such as https://ai.mangosgo.com/aiavatar/, with no build step.
 * '/api/maps' and 'api/maps' both become <page folder>/api/maps; absolute http(s) URLs pass through.
 */
export const pageUrl = path => new URL(String(path).replace(/^\/(?!\/)/, ''), document.baseURI).href;
