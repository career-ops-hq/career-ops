// Options every <ReactMarkdown> in the dashboard spreads in, so a markdown image
// is never turned into an <img>.
//
// A report, a job description and an assistant reply are all text a model wrote
// from an untrusted posting. `![x](https://host/p.png?cv=...)` in that text
// makes the browser request the URL as soon as the page renders, with whatever
// the model put in the query string, and nobody has to click anything. The
// dashboard has no reason to show a remote image inside prose, so the element is
// dropped instead of filtered by host. Links are left alone: they only go out on
// a click.
//
// tests/lib/markdown-images.test.mjs fails if a <ReactMarkdown> in src/ does not
// spread this, so a renderer added later cannot quietly bring the images back.
export const noMarkdownImages = { disallowedElements: ["img"] };
