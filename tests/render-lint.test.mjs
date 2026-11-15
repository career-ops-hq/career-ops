// tests/render-lint.test.mjs — renderLint reports what generate-pdf.mjs drops
// silently (#5941): JavaScript is off and every request that is not file: or
// data: is aborted, so a template carrying either renders without it and says
// nothing. One positive and one negative case per rule; each negative is the
// rule's must-not-flag clause from the issue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderLint, atsLint } from '../cv-templates.mjs';

const ROOT = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'render-lint-'));
let n = 0;
function lint(html) {
  const p = join(dir, `t${n++}.html`);
  writeFileSync(p, html);
  return renderLint(p);
}
const ids = (r) => r.findings.map((f) => f.id);

const CASES = [
  {
    id: 'script-element',
    hit: ['<body><script>fetch("x")</script></body>', '<SCRIPT src="a.js"></SCRIPT>',
      // A srcdoc is a document of its own, printed with JavaScript off, so its script is as dead as one outside; svg/math <style> hold markup.
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '<iframe srcdoc="&lt;iframe srcdoc=&quot;&amp;lt;script&amp;gt;x&amp;lt;/script&amp;gt;&quot;&gt;&lt;/iframe&gt;"></iframe>',
      '<svg><style><script>x()</script></style></svg>'],
    miss: ['<p>Wrote a script for the pipeline</p>', '<noscript>Enable JS</noscript>', '<!-- <script>x</script> -->', '<img alt="<script>" src="a.png">', '<textarea><script>x</script></textarea>', '<template><script>x</script></template>', '<svg><text><![CDATA[<script>x</script>]]></text></svg>', '<iframe srcdoc="<p>script</p>"></iframe>', '<iframe srcdoc="<textarea><script>x</script></textarea>"></iframe>'],
  },
  {
    id: 'embedded-content',
    hit: ['<iframe src="a.html"></iframe>', '<object data="a.pdf"></object>', '<embed src="a.svg">', '<iframe srcdoc="<iframe src=a.html></iframe>"></iframe>', '<svg><embed src="a.svg"></svg>'],
    miss: ['<img src="a.png">', '<svg><rect/></svg>', '<img alt="<iframe>" src="a.png">', '<iframe srcdoc="<p>Hello</p>"></iframe>', '<IFRAME SRCDOC=\'<p>Hello</p>\'></IFRAME>',
      // svg:iframe and svg:object are unknown svg elements: nothing loads (probed).
      '<svg><iframe src="a.html"></iframe></svg>', '<svg><object data="a.pdf"></object></svg>', '<math><iframe src="a.html"></iframe></math>'],
  },
  {
    id: 'event-handler-attribute',
    hit: ['<body onload="x()">', '<img src="a.png" onerror=x()>', '<a href="#" ONCLICK="x()">go</a>', '<svg/onload=x()>', '<img src="a.png"onerror=x()>', '<img src=\'a.png\'onerror=x()>', '<iframe srcdoc="<img src=a.png onerror=x()>"></iframe>', '<svg><style><img src="a.png" onerror="x()"></style></svg>'],
    miss: ['<p title="once=twice">x</p>', '<div data-onclick="x">x</div>', '<p>onload= in text</p>', '<a href=/onload=x>x</a>', '<a href=a/onclick=b>x</a>', '<img src="a.png" alt=x/onerror=y>', '<template><img src="a.png" onerror="x()"></template>', '<textarea><img onerror=x()></textarea>'],
  },
  {
    id: 'script-url',
    hit: ['<iframe srcdoc="<a href=\'javascript:x()\'>y</a>"></iframe>', '<a href="&#106;avascript:alert(1)">x</a>', '<a href="javascript&#58;alert(1)">x</a>', '<a href="javascript:alert(1)">x</a>', '<a href="javascript&colon;alert(1)">x</a>', '<img src=" JavaScript:x()">', '<a href="data:text/html,<b>x</b>">x</a>', '<a href="java&#9;script:alert(1)">x</a>', '<a href="java&Tab;script:alert(1)">x</a>', '<a href="java&NewLine;script:alert(1)">x</a>', '<a href="java\nscript:alert(1)">x</a>', '<a href="java\tscript:alert(1)">x</a>', '<a href="&#1;javascript:alert(1)">x</a>', '<a href="&#31; javascript:alert(1)">x</a>', '<a href="java&#9;script:alert(1)">x</a>', '<a href="JAVASCRIPT:alert(1)">x</a>', '<a href="JaVaScRiPt:alert(1)">x</a>', '<a href="javascript:alert(1)&#1;">x</a>', '<a href="&#1;DATA:text/html,<b>x</b>">x</a>', '<img src="&#1;&#2;java\nscript:x">'],
    // Probed: Chromium writes a /URI action into the PDF for each of the hit forms (JavaScript off), and for a leading DEL it
    // resolves a file path instead, so only C0 controls, space, tab, LF and CR are ignored, as the URL parser does.
    miss: ['<a href="&#127;javascript:alert(1)">x</a>', '<a href="java script:alert(1)">x</a>', '<a href="&#0;javascript:alert(1)">x</a>', '<p>javascript:alert(1)</p>', '<img src="data:image/png;base64,AAAA">', '<style>@font-face{src:url("data:font/woff2;base64,AAAA")}</style>', '<a href="{{LINKEDIN_URL}}">x</a>'],
  },
  {
    id: 'meta-refresh',
    hit: ['<iframe srcdoc="<meta http-equiv=refresh content=0>"></iframe>', '<meta http-equiv="refresh" content="0;url=a.html">', '<meta http-equiv="refresh" content=" 3 ; url=a.html">', '<meta http-equiv="refresh" content="5">'],
    // Chromium follows a refresh that parses to a time (the remote target is requested, then aborted)
    // and ignores one with no content, an empty one, or one whose content does not start with a number.
    miss: ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width">', '<meta http-equiv="refresh">', '<meta http-equiv="refresh" content="">', '<meta http-equiv="refresh" content="x">', '<meta http-equiv="refresh" content="url=a.html">', '<iframe srcdoc="<meta http-equiv=refresh content=x>"></iframe>', '<template><meta http-equiv="refresh" content="0;url=a.html"></template>'],
  },
  {
    id: 'remote-subresource',
    hit: [
      '<img src="https://example.com/a.png">',
      '<link rel="stylesheet" href="//fonts.example.com/a.css">',
      '<style>@import url("https://fonts.example.com/a.css");</style>',
      '<style>@import "https://fonts.example.com/a.css";</style>',
      '<style>body{background:url(http://example.com/a.png)}</style>',
      '<div style="background:url(\'https://example.com/a.png\')"></div>',
      '<img alt="src=photo.png" src="https://example.com/a.png">',
      '<img src="https&#58;//example.com/a.png">',
      '<img src="&#104;ttps://example.com/a.png">',
      '<img src="https&#58//example.com/a.png">',
      '<img src="ftp://example.com/a.png">',
      '<img src="https&colon;//example.com/a.png">',
      '<img src="https&colon;&sol;&sol;example.com/a.png">',
      '<style><!-- @import url(https://fonts.example.com/a.css); --></style>',
      '<style><!--\nbody{background:url(https://example.com/a.png)}\n--></style>',
      '<base href="https://cdn.example/"><img src="logo.png">',
      '<base href="https://cdn.example/"><link rel="stylesheet" href="css/a.css">',
      '<base href="https://cdn.example/"><img srcset="a.png 1x, b.png 2x">',
      '<base href="https://cdn.example/"><style>body{background:url(img/a.png)}</style>',
      '<base href="https://cdn.example/"><style>@import "a.css";</style>',
      '<style type="text/css">body{background:url(https://example.com/a.png)}</style>',
      '<style>body{background:url(ftp://example.com/a.png)}</style>',
      '<img src="https&#x3a//example.com/a.png">',
      '<style>body{background:url(https://example.com/a.png);content:"<style>"}</style>',
      '<div style="background:url(&quot;https://example.com/a.png&quot;)"></div>',
      '<STYLE>body{background:URL(https://example.com/a.png)}</STYLE>',
      '<img srcset="photo.png 1x, https://example.com/photo.png 2x">',
      // Quoted @import needs no whitespace after the at-keyword.
      '<style>@import"https://fonts.example.com/a.css";</style>',
      "<style>@import'https://fonts.example.com/a.css';</style>",
      '<base href="https://cdn.example/"><style>@import"a.css";</style>',
      // A data URL's comma is not a candidate separator, so a remote candidate after it still counts.
      '<img srcset="data:image/png;base64,AAAA 1x, https://example.com/a.png 2x">',
      '<base href="https://cdn.example/"><img srcset="data:image/png;base64,AAAA 1x, b.png 2x">',
      // The URL parser drops tab, LF and CR anywhere in a URL.
      '<img src="ht&#9;tps://example.com/a.png">',
      '<img src="ht&Tab;tps://example.com/a.png">',
      '<img src="ht&NewLine;tps://example.com/a.png">',
      '<img src="ht\ntps://example.com/a.png">',
      '<img src="ht\ttps://example.com/a.png">',
      '<img src="https://example.com/\r\na.png">',
      '<link rel="stylesheet" href="ht&#10;tps://example.com/a.css">',
      '<base href="ht&#9;tps://cdn.example/"><img src="logo.png">',
      // A fragment-only resource URL resolves against a remote <base href>.
      '<base href="https://cdn.example/icon.svg"><img src="#logo">',
      '<base href="https://cdn.example/"><img srcset="#a 1x">',
      '<base href="https://cdn.example/"><link rel="stylesheet" href="#x">',
      // A special scheme needs no `//`: the URL parser resolves each of these to a remote host,
      // and Chromium routes (and the renderer aborts) every one, probed with javaScriptEnabled:false.
      '<img src="https:example.com/logo.png">',
      '<img src="HTTPS:example.com/a.png">',
      '<img src="http:example.com/a.png">',
      '<img src="https:/example.com/a.png">',
      '<img src="https:///example.com/a.png">',
      '<img src="https:\\\\example.com\\a.png">',
      '<img src="https:/\\example.com/a.png">',
      '<img src="ftp:example.com/a.png">',
      '<img src="ws://example.com/a.png">',
      '<img src="wss:example.com/a.png">',
      '<img src=" https:example.com/a.png">',
      '<img srcset="a.png 1x, https:example.com/a.png 2x">',
      '<link rel="stylesheet" href="https:example.com/a.css">',
      '<style>body{background:url(https:example.com/a.png)}</style>',
      '<style>@import "https:example.com/a.css";</style>',
      '<base href="file:///tmp/"><img src="https:example.com/a.png">',
      // Scheme-relative in either slash direction, as `//host` already was.
      '<img src="\\\\example.com\\a.png">',
      '<img src="/\\example.com/a.png">',
      '<img src="\\/example.com/a.png">',
      // A base without `//` still names a remote origin.
      '<base href="https:cdn.example/"><img src="logo.png">',
      // The markup of an iframe srcdoc is fetched like the page's own (probed with javaScriptEnabled:false).
      '<iframe srcdoc="<img src=\'https://example.com/a.png\'>"></iframe>',
      '<iframe srcdoc="&lt;img src=&quot;https://example.com/a.png&quot;&gt;"></iframe>',
      '<iframe srcdoc="<link rel=stylesheet href=\'https://example.com/a.css\'>"></iframe>',
      '<iframe srcdoc="<style>@import \'https://example.com/a.css\'</style>"></iframe>',
      '<iframe srcdoc="<style>body{background:url(https://example.com/a.png)}</style><p>x"></iframe>',
      '<iframe srcdoc="<iframe srcdoc=\'&lt;img src=&quot;https://example.com/a.png&quot;&gt;\'></iframe>"></iframe>',
      // The srcdoc document inherits the parent's base URL, and its own <base> overrides it.
      '<base href="https://cdn.example/"><iframe srcdoc="<img src=\'logo.png\'>"></iframe>',
      '<iframe srcdoc="<base href=\'https://own.example/\'><img src=\'logo.png\'>"></iframe>',
      // Comment markers inside a quoted attribute or a CSS string are text, so the live request after them still counts.
      '<img alt="<!--" src="https://example.com/a.png">-->',
      '<!--><img src="https://example.com/a.png">',
      '<!---><img src="https://example.com/a.png">',
      '<style>.x{--a:"/*";background-image:url(https://example.com/a.png);--b:"*/"}</style>',
      '<style>.x{--a:\'/*\';background:url(https://example.com/a.png)}/* "real" */</style>',
      '<style>.x{background:url(https://example.com/a/*b*/.png)}</style>',
      // image-set() takes bare string candidates, which are requests too.
      '<style>.x{background-image:image-set("https://example.com/a.png" 1x)}</style>',
      '<style>.x{background-image:-webkit-image-set(\'https:example.com/a.png\' 1x)}</style>',
      '<base href="https://cdn.example/"><style>.x{background-image:image-set("a.png" 1x)}</style>',
      // A quote opens a value only right after `=`: these tags have an unquoted alt, and the src after it is live (probed).
      "<img alt=Jane's src=https://example.com/a.png>",
      '<img alt=say"hi src=https://example.com/a.png>',
      '<img alt=a<b src=https://example.com/a.png>',
      '<img src="https://example.com/a.png"alt=x>',
      '<img src=https://example.com/a.png/>',
      '<img alt =x src= https://example.com/a.png>',
      // Attribute and element forms the HTML parser accepts.
      '<img/src=https://example.com/a.png>',
      '<svg><defs><filter id="f"><feImage href="https://example.com/a.png"/></filter></defs></svg>',
      '<svg><defs><filter id="f"><feImage xlink:href="https://example.com/a.png"/></filter></defs></svg>',
      '<svg><style><![CDATA[.s{background:url(https://example.com/a.png)}]]></style></svg>',
      '<svg><style>.s{background:url(https://example.com/a.png)}</style></svg>',
      // svg has no raw text, so a character reference in its <style> is decoded before CSS reads it (probed).
      '<svg><style>@import "https&#58;//example.com/a.css";</style></svg>',
      '<svg><style>@import "https&colon;//example.com/a.css";</style></svg>',
      // Text decodes a legacy name with no semicolon even before a letter, unlike an attribute value.
      '<svg><style>@import &quothttps://example.com/a.css&quot;</style></svg>',
      // JavaScript is off, so <noscript> content is parsed as markup and requested.
      '<noscript><img src="https://example.com/a.png"></noscript>',
      '<template></template><img src="https://example.com/a.png">',
      '<img src="&#1;https://example.com/a.png">',
      '<video><source src="https://example.com/a.mp4"></video>',
      '<audio><source src="https://example.com/a.mp3"></audio>',
      '<picture><video><source src="https://example.com/a.mp4"></video></picture>',
      '<picture><source srcset="https://example.com/a.png"><img alt=""></picture>',
      '<input type="image" src="https://example.com/a.png">',
      '<input type=IMAGE src="https://example.com/a.png">',
      '<link rel="alternate stylesheet" href="https://example.com/a.css">',
      '<link rel="preload" as="image" href="https://example.com/a.png">',
      '<link rel="prefetch" href="https://example.com/a.html">',
      // Any scheme with an authority is aborted by the route, not just the special ones (probed).
      '<img src="gopher://example.com/a.png">',
      '<img src="foo://example.com/a.png">',
      '<img src="chrome-extension://example.com/a.png">',
      '<img src="intent://example.com/a">',
      '<style>.a{background:url(foo://example.com/a.png)}</style>',
      // With no remote base the document is a file: URL, so `//host` is file://host/..., which does not load (probed).
      '<img src="file://example.com/a.png">',
      '<img src="\\\\example.com\\a.png">',
      // Foreign content: svg title/desc/foreignObject are HTML integration points, a breakout tag leaves svg,
      // and a script in svg is markup, not raw text (probed).
      '<svg><title><img src="https://example.com/a.png"></title></svg>',
      '<svg><desc><img src="https://example.com/a.png"></desc></svg>',
      '<svg><textarea><img src="https://example.com/a.png"></textarea></svg>',
      '<svg><foreignObject><img src="https://example.com/a.png"></foreignObject></svg>',
      '<svg><iframe><img src="https://example.com/a.png"></iframe></svg>',
      '<svg><xmp><img src="https://example.com/a.png"></xmp></svg>',
      '<svg><noscript><img src="https://example.com/a.png"></noscript></svg>',
      '<svg><script>var s="<img src=\'https://example.com/a.png\'>";</script></svg>',
      '<svg><foreignObject><div></div></foreignObject><textarea><img src="https://example.com/a.png"></textarea></svg>',
      '<svg><g/><img src="https://example.com/a.png"></svg>',
      '<svg/><img src="https://example.com/a.png">',
      '<p><svg><p><img src="https://example.com/a.png"></svg>',
      '<math><annotation-xml encoding="x"><textarea><img src="https://example.com/a.png"></textarea></annotation-xml></math>',
      // Tokenizer corner cases (probed): the end tag wins over comment and string syntax inside raw text.
      '<template><script>var a="</template>";</script></template><img src="https://example.com/a.png">',
      '<textarea><!-- </textarea><img src="https://example.com/a.png"> -->',
      '<script><!-- var a = "</script><img src=\'https://example.com/a.png\'>";</script>',
      '<style>/* </style><img src="https://example.com/a.png"> */</style>',
      '<template><svg><title></template><img src="https://example.com/a.png"></title></svg></template>',
      // CSS preprocessing turns CR, FF and CRLF into LF: a string ends at a CR and a backslash-CRLF continues it (probed).
      '<style>.x{content:"x\r;background:url(https://example.com/a.png)}</style>',
      '<style>.x{content:"x\f;background:url(https://example.com/a.png)}</style>',
      '<style>.x{background:url("htt\\\r\nps://example.com/a.png")}</style>',
      '<style>.x{background:url("htt\\\rps://example.com/a.png")}</style>',
      // A trailing slash closes only svg, math and foreign children; <picture/> still opens a picture (probed).
      '<picture/><source srcset="https://example.com/a.png"><img src="data:image/png;base64,AA"></picture>',
      // HTML whitespace is TAB, LF, FF, CR and space: NBSP belongs to the tag name, so this is not a <template> (probed).
      '<template\u00A0><img src="https://example.com/a.png">',
      '<script></script ><img src="https://example.com/a.png">',
      '<style type="TEXT/CSS">.x{background:url(https://example.com/a.png)}</style>',
      // CSS escapes are decoded before the URL is classified.
      '<style>@import "\\68 ttps://example.com/a.css";</style>',
      '<style>@import url("\\68 ttps://example.com/a.css");</style>',
      '<style>@import url(\\68 ttps://example.com/a.css);</style>',
      '<style>@\\69 mport "https://example.com/a.css";</style>',
      '<style>.a{background:url("\\68 ttps://example.com/a.png")}</style>',
      '<style>.a{background:url(\\68 ttps://example.com/a.png)}</style>',
      '<style>.a{background:url("https\\3a //example.com/a.png")}</style>',
      '<style>.a{background:url("https:\\/\\/example.com/a.png")}</style>',
      '<style>.a{background:url("\\000068ttps://example.com/a.png")}</style>',
      '<style>.a{background:url("h\\ttps://example.com/a.png")}</style>',
      '<style>.a{background:\\75 rl("https://example.com/a.png")}</style>',
      '<style>.a{background:u\\72l(https://example.com/a.png)}</style>',
      '<style>.a{background:url("htt\\\nps://example.com/a.png")}</style>',
      '<style>.a{background:url("https://example.com/a\\2e png")}</style>',
      '<div style="background:url(&quot;\\68 ttps://example.com/a.png&quot;)"></div>',
      '<base href="https://cdn.example/"><style>.a{background:url("\\69 mg/a.png")}</style>',
      // Character references that spell a URL: &bsol; is `\`, which the URL parser reads as `/`, so these are all
      // `file://host/...` on the printed file: page (probed).
      '<img src="&bsol;&bsol;example.com/a.png">',
      '<img src="/&bsol;example.com/a.png">',
      '<img src="&sol;&bsol;example.com/a.png">',
      '<img src="&#92;&#92;example.com/a.png">',
      '<iframe srcdoc="&lt;img src=&quot;&amp;bsol;&amp;bsol;example.com/a.png&quot;&gt;"></iframe>',
      '<div style="background:url&lpar;https://example.com/a.png&rpar;"></div>',
      '<img src="&Tab;&bsol;&bsol;example.com/a.png">',
      // svg and math have no raw text, RCDATA or script data: a <style> or <script> there holds markup, self-closing or not,
      // so an <img> in it leaves foreign content and is requested (probed).
      '<svg><style><img src="https://example.com/a.png"></style></svg>',
      '<math><style><img src="https://example.com/a.png"></style></math>',
      '<svg><style/><img src="https://example.com/a.png"></svg>',
      '<math><style/><img src="https://example.com/a.png"></math>',
      '<svg><script/><img src="https://example.com/a.png"></svg>',
      '<math><script/><img src="https://example.com/a.png"></math>',
      '<svg><style><![CDATA[x]]><img src="https://example.com/a.png"></style></svg>',
      '<svg><style>.s{background:url(https://example.com/a.png)}<g></g></style></svg>',
      // In HTML an <image> is an <img>, srcset included; and an element name means what it means in its own namespace,
      // so an HTML <video> in an svg <desc> is requested (probed).
      '<image srcset="https://example.com/a.png 1x">',
      '<svg><desc><image srcset="https://example.com/a.png 1x"></desc></svg>',
      '<svg><desc><video src="https://example.com/a.mp4"></video></desc></svg>',
      '<svg><image href="https://example.com/a.png" width="5" height="5"></svg>',
    ],
    miss: [
      '<a href="https://example.com/me">me</a>',
      '<img src="{{PHOTO}}">',
      '<img src="photo.png">',
      '<link rel="stylesheet" href="fonts/a.css">',
      '<style>@font-face{src:url("./fonts/a.woff2")}</style>',
      '<style>/* url(https://example.com/a.png) */ body{}</style>',
      '<img alt="src=https://example.com/a.png" src="photo.png">',
      '<img srcset="photo.png 1x, photo-2x.png 2x">',
      '<title>url(https://example.com/a.png)</title>',
      '<style type="text/plain">body{background:url(https://example.com/a.png)}</style>',
      '<img src="#frag"><img src="">',
      '<!-- <style>@import url(https://fonts.example.com/a.css);</style> -->',
      '<p>x</p><!-- <img src="https://example.com/a.png"> --><style>body{color:#000}</style>',
      '<base href="https://cdn.example/"><img src="data:image/png;base64,AAAA"><img src="{{PHOTO}}"><a href="rel.html">x</a>',
      '<base href="https://cdn.example/"><style>body{background:url(data:image/png;base64,AAAA)}</style>',
      '<base href="file:///tmp/"><img src="logo.png">',
      '<base target="_blank"><img src="logo.png">',
      '<img alt="<style>body{background:url(https://example.com/a.png)}</style>" src="a.png">',
      '<p>Docs: url(https://example.com/a.png) and @import "https://example.com/a.css"</p>',
      // A data: srcset candidate stays local under a remote base, whatever its comma does.
      '<base href="https://cdn.example/"><img srcset="data:image/png;base64,AAAA 1x">',
      '<base href="https://cdn.example/"><img srcset="data:image/png;base64,AAAA">',
      '<base href="https://cdn.example/"><source srcset="data:image/svg+xml,%3Csvg%3E 1x, data:image/png;base64,BBBB 2x">',
      // Tab/LF/CR separate srcset candidates and descriptors; they are not stripped before the split.
      '<img srcset="a.png\n1x,\nb.png\t2x">',
      // rel is read raw: stripping would turn this into a stylesheet link.
      '<link rel="style\nsheet" href="https://example.com/a.css">',
      // Same-document references stay local under a remote base.
      '<base href="https://cdn.example/"><svg><use href="#a"/></svg>',
      '<base href="https://cdn.example/"><style>.a{fill:url(#g)}</style>',
      // Not fetched by the renderer (JavaScript is off), so nothing is dropped: probed with
      // Playwright's javaScriptEnabled:false context, where modulepreload and icon never reach route().
      '<link rel="modulepreload" href="https://cdn.example/m.js">',
      // Text in raw-text, RCDATA, CDATA and inert template content is not markup, so nothing is requested.
      '<textarea><img src="https://example.com/a.png"></textarea>',
      '<title><img src="https://example.com/a.png"></title>',
      '<script>var s = \'<img src="https://example.com/a.png">\';</script>',
      '<svg><text><![CDATA[<image href="https://example.com/a.png"/>]]></text></svg>',
      '<xmp><img src="https://example.com/a.png"></xmp>',
      '<iframe><img src="https://example.com/a.png"></iframe>',
      '<template><img src="https://example.com/a.png"></template>',
      '<template><base href="https://cdn.example/"></template><img src="photo.png">',
      '<style>.x::before{content:"url(https://example.com/a.png)"}</style>',
      '<style>.x{font-family:"url(https://example.com/a.png)"}</style>',
      '<style>@namespace url("https://example.com/ns");</style>',
      '<style>@namespace svg url(https://example.com/ns);</style>',
      // The renderer fetches an input src only for type=image, and a source src only inside video or audio.
      '<input type="hidden" src="https://example.com/a.png">',
      '<input src="https://example.com/a.png">',
      '<input type="text" src="https://example.com/a.png">',
      '<source src="https://example.com/a.png">',
      '<picture><source src="https://example.com/a.png"><img alt=""></picture>',
      '<source srcset="https://example.com/a.png">',
      '<video><source srcset="https://example.com/a.png"></video>',
      '<track src="https://example.com/a.vtt">',
      '<video><track src="https://example.com/a.vtt" kind="subtitles" default></video>',
      // A tag the input ends inside is dropped by the parser, so nothing is requested (probed).
      '<img src="https://example.com/a.png"',
      '<img src=https://example.com/a.png',
      // The second quote closes alt, so the URL is an attribute name, not a src.
      '<img alt="a src="https://example.com/a.png">',
      // Never requested with JavaScript off: icons, a preload with no `as`, a rel that only contains a fetching word.
      '<link rel="icon" href="https://example.com/favicon.ico">',
      '<link rel="shortcut icon" href="https://example.com/favicon.ico">',
      '<link rel="apple-touch-icon" href="https://example.com/a.png">',
      '<link rel="preload" href="https://example.com/a.png">',
      '<link rel="x-stylesheet" href="https://example.com/a.css">',
      // No authority, no request: Chromium never issues these (probed), so they are not flagged.
      '<img src="urn:example">',
      '<img src="cid:logo@example">',
      '<img src="blob:https://example.com/x">',
      '<img src="about:blank">',
      '<img src="chrome://example.com/a.png">',
      '<img src="file://localhost/tmp/a.png">',
      '<img src="file:///tmp/a.png">',
      // Raw text, RCDATA and template content inside foreign content and its HTML integration points (probed).
      '<svg><foreignObject><textarea><img src="https://example.com/a.png"></textarea></foreignObject></svg>',
      '<svg><foreignObject><title><img src="https://example.com/a.png"></title></foreignObject></svg>',
      '<svg><desc><textarea><img src="https://example.com/a.png"></textarea></desc></svg>',
      '<svg><title><textarea><img src="https://example.com/a.png"></textarea></title></svg>',
      '<math><mtext><textarea><img src="https://example.com/a.png"></textarea></mtext></math>',
      '<math><mi><title><img src="https://example.com/a.png"></title></mi></math>',
      '<math><annotation-xml encoding="text/html"><textarea><img src="https://example.com/a.png"></textarea></annotation-xml></math>',
      '<math><annotation-xml encoding="application/xhtml+xml"><textarea><img src="https://example.com/a.png"></textarea></annotation-xml></math>',
      '<svg><p></p><textarea><img src="https://example.com/a.png"></textarea></svg>',
      '<svg></svg><textarea><img src="https://example.com/a.png"></textarea>',
      '<svg><script><![CDATA[var s="<img src=\'https://example.com/a.png\'>";]]></script></svg>',
      '<template><textarea></template><img src="https://example.com/a.png"></textarea></template>',
      '<template><script>var a="</template>";</script><img src="https://example.com/a.png"></template>',
      '<template><template></template><img src="https://example.com/a.png"></template>',
      '<template><template><img src="https://example.com/a.png"></template></template>',
      '<template><style>.a{background:url(https://example.com/a.png)}</style></template>',
      // <template/> opens a template, </script\u00A0> does not end a script, an unmatched </math> leaves svg alone (probed).
      '<template/><img src="https://example.com/a.png">',
      '<script></script\u00A0><img src="https://example.com/a.png">',
      '<svg><g></math><text><![CDATA[<x><image href="https://example.com/a.png"/>]]></text></svg>',
      // Attribute values compare exactly: no trimming and no NBSP (probed).
      '<style type=" text/css">.x{background:url(https://example.com/a.png)}</style>',
      '<meta http-equiv=" refresh" content="0;url=https://example.com/a.png">',
      '<meta http-equiv="refresh" content="\u00A00;url=https://example.com/a.png">',
      '<input type=" image" src="https://example.com/a.png">',
      '<link rel="stylesheet\u00A0" href="https://example.com/a.css">',
      '<link rel="\u00A0stylesheet" href="https://example.com/a.css">',
      // A host the URL parser rejects is not requested.
      '<img src="https://exa%00mple.test/a.png">',
      '<img src="https://exa&#0;mple.test/a.png">',
      // Local files and data stay quiet under both kinds of base, with or without `//`.
      '<img src="file:logo.png">',
      '<base href="https://cdn.example/"><img src="file:///tmp/a.png">',
      '<base href="https://cdn.example/"><img src="data:image/png;base64,AAAA">',
      '<base href="https:cdn.example/"><img src="{{PHOTO}}">',
      // A srcdoc with nothing remote in it stays quiet.
      '<iframe srcdoc="<p>Hello</p>"></iframe>',
      '<iframe srcdoc="<img src=\'data:image/png;base64,AAAA\'><img src=\'a.png\'>"></iframe>',
      '<iframe srcdoc="<!-- <img src=\'https://example.com/a.png\'> -->"></iframe>',
      '<iframe srcdoc="<p>https://example.com/a.png</p>"></iframe>',
      // The src is ignored when srcdoc is present, so only the srcdoc markup counts.
      '<iframe srcdoc="<p>x</p>" src="a.html"></iframe>',
      // CSS escapes that decode to a local path stay local; a non-url() string is not a request.
      '<style>.a{background:url("\\66 ile.png")}</style>',
      '<style>.a{background:url("\\70 hoto.png")}</style>',
      '<style>.a{content:"\\68 ttps://example.com/a.png"}</style>',
      '<style>.a{background:url("\\68  ttps://example.com/a.png")}</style>',
      // svg:video, svg:link, svg:iframe, svg:object and math:td are unknown elements there, and an svg <image> takes href, not
      // src or srcset (probed).
      '<svg><image src="https://example.com/a.png" width="5" height="5"></svg>',
      '<svg><image srcset="https://example.com/a.png 1x" width="5" height="5"></svg>',
      '<math><image src="https://example.com/a.png"></math>',
      '<math><image srcset="https://example.com/a.png 1x"></math>',
      '<svg><video src="https://example.com/a.mp4"></video></svg>',
      '<svg><link rel="stylesheet" href="https://example.com/a.css"></svg>',
      '<svg><iframe src="https://example.com/a.html"></iframe></svg>',
      '<svg><object data="https://example.com/a.pdf"></object></svg>',
      '<svg><foreignObject><feImage href="https://example.com/a.png"/></foreignObject></svg>',
      '<math><td background="https://example.com/a.png"></td></math>',
      // A name outside the table, or a legacy name before a letter, stays as written: a local path (probed).
      '<img src="&notit;//example.com/a.png">',
      '<img src="https&colonx;//example.com/a.png">',
      '<img src="&lpar;example.com/a.png">',
    ],
  },
];

for (const { id, hit, miss } of CASES) {
  test(`${id}: flags the construct`, () => {
    for (const html of hit) assert.ok(ids(lint(html)).includes(id), `expected ${id} for: ${html}`);
  });
  test(`${id}: stays quiet on what it must not flag`, () => {
    for (const html of miss) assert.ok(!ids(lint(html)).includes(id), `unexpected ${id} for: ${html}`);
  });
}

// Which URL-bearing attributes Chromium really requests, probed in ONE run with JavaScript off and a route() that
// logs every request and aborts all but file: and data:. `true` means the URL reached route(). The markup is the
// probe's own; `@@` stands for a host. remote-subresource must flag exactly the `true` rows. Rows worth noting:
// legacy background on body/table/thead/tbody/tfoot/tr/td/th is requested (div is not); iframe/embed/object/frame
// src and data are requested (a frame only inside a frameset, an iframe src not when srcdoc is present); a link
// preloads through href or imagesrcset; svg image/feImage hrefs and the url() of fill, stroke, marker-*, clip-path,
// mask and cursor are requested, an external <use>/<pattern>/<linearGradient>/<textPath>/<mpath> href and a
// filter url() are not; cite, ping, action, formaction, longdesc, lowsrc, usemap, codebase, archive, classid,
// manifest, profile, track and a script src are not; a refresh navigates to its url.
const FETCHERS = [
  ['a href', '<a href="https://@@/a.png">x</a>', false],
  ['a ping', '<a href="a.html" ping="https://@@/a.png">x</a>', false],
  ['area href', '<map name="m"><area shape="rect" coords="0,0,5,5" href="https://@@/a.png"></map>', false],
  ['area ping', '<map name="m2"><area shape="rect" coords="0,0,5,5" href="a.html" ping="https://@@/a.png"></map>', false],
  ['blockquote cite', '<blockquote cite="https://@@/a.png">x</blockquote>', false],
  ['q cite', '<q cite="https://@@/a.png">x</q>', false],
  ['del cite', '<del cite="https://@@/a.png">x</del>', false],
  ['ins cite', '<ins cite="https://@@/a.png">x</ins>', false],
  ['form action', '<form action="https://@@/a.png"><input type="text"></form>', false],
  ['button formaction', '<form><button formaction="https://@@/a.png">b</button></form>', false],
  ['input formaction', '<form><input type="submit" formaction="https://@@/a.png"></form>', false],
  ['img src', '<img src="https://@@/a.png">', true],
  ['img srcset', '<img srcset="https://@@/a.png 1x">', true],
  ['img longdesc', '<img src="a.png" longdesc="https://@@/a.png">', false],
  ['img lowsrc', '<img src="a.png" lowsrc="https://@@/a.png">', false],
  ['img usemap', '<img src="a.png" usemap="https://@@/a.png">', false],
  ['img dynsrc', '<img src="a.png" dynsrc="https://@@/a.png">', false],
  ['iframe src', '<iframe src="https://@@/a.png"></iframe>', true],
  ['iframe srcdoc+src', '<iframe srcdoc="<p>x</p>" src="https://@@/a.png"></iframe>', false],
  ['embed src', '<embed src="https://@@/a.png">', true],
  ['embed pluginspage', '<embed src="a.png" pluginspage="https://@@/a.png">', false],
  ['object data', '<object data="https://@@/a.png"></object>', true],
  ['object data typed', '<object data="https://@@/a.png" type="image/png"></object>', true],
  ['object codebase', '<object data="a.png" codebase="https://@@/a.png"></object>', false],
  ['object archive', '<object data="a.png" archive="https://@@/a.png"></object>', false],
  ['object classid', '<object classid="https://@@/a.png"></object>', false],
  ['applet archive', '<applet archive="https://@@/a.png" code="X"></applet>', false],
  ['applet codebase', '<applet codebase="https://@@/a.png" code="X"></applet>', false],
  ['param value', '<object data="a.png"><param name="movie" value="https://@@/a.png"></object>', false],
  ['video src', '<video src="https://@@/a.png"></video>', true],
  ['video poster', '<video poster="https://@@/a.png"></video>', true],
  ['audio src', '<audio src="https://@@/a.png"></audio>', true],
  ['video>source src', '<video><source src="https://@@/a.png"></video>', true],
  ['audio>source src', '<audio><source src="https://@@/a.png"></audio>', true],
  ['video>source srcset', '<video><source srcset="https://@@/a.png"></video>', false],
  ['picture>source srcset', '<picture><source srcset="https://@@/a.png"><img alt=""></picture>', true],
  ['picture>source src', '<picture><source src="https://@@/a.png"><img alt=""></picture>', false],
  ['source src bare', '<source src="https://@@/a.png">', false],
  ['track src', '<video><track src="https://@@/a.png" kind="subtitles" default></video>', false],
  ['input[image] src', '<input type="image" src="https://@@/a.png">', true],
  ['input[text] src', '<input type="text" src="https://@@/a.png">', false],
  ['input[image] formaction', '<form><input type="image" src="a.png" formaction="https://@@/a.png"></form>', false],
  ['script src', '<script src="https://@@/a.png"></script>', false],
  ['script type=module src', '<script type="module" src="https://@@/a.png"></script>', false],
  ['link stylesheet', '<link rel="stylesheet" href="https://@@/a.png">', true],
  ['link preload as=image', '<link rel="preload" as="image" href="https://@@/a.png">', true],
  ['link preload as=font', '<link rel="preload" as="font" crossorigin href="https://@@/a.png">', true],
  ['link preload (no as)', '<link rel="preload" href="https://@@/a.png">', false],
  ['link preload imagesrcset', '<link rel="preload" as="image" imagesrcset="https://@@/a.png 1x">', true],
  ['link prefetch', '<link rel="prefetch" href="https://@@/a.png">', true],
  ['link modulepreload', '<link rel="modulepreload" href="https://@@/a.png">', false],
  ['link icon', '<link rel="icon" href="https://@@/a.png">', false],
  ['link manifest', '<link rel="manifest" href="https://@@/a.png">', false],
  ['link prerender', '<link rel="prerender" href="https://@@/a.png">', false],
  ['link dns-prefetch', '<link rel="dns-prefetch" href="https://@@/a.png">', false],
  ['link preconnect', '<link rel="preconnect" href="https://@@/a.png">', false],
  ['link canonical', '<link rel="canonical" href="https://@@/a.png">', false],
  ['link alternate', '<link rel="alternate" href="https://@@/a.png">', false],
  ['link alternate stylesheet', '<link rel="alternate stylesheet" href="https://@@/a.png">', true],
  ['table background', '<table background="https://@@/a.png"><tr><td>x</td></tr></table>', true],
  ['td background', '<table><tr><td background="https://@@/a.png">x</td></tr></table>', true],
  ['th background', '<table><tr><th background="https://@@/a.png">x</th></tr></table>', true],
  ['tr background', '<table><tr background="https://@@/a.png"><td>x</td></tr></table>', true],
  ['thead background', '<table><thead background="https://@@/a.png"><tr><td>x</td></tr></thead></table>', true],
  ['tbody background', '<table><tbody background="https://@@/a.png"><tr><td>x</td></tr></tbody></table>', true],
  ['tfoot background', '<table><tfoot background="https://@@/a.png"><tr><td>x</td></tr></tfoot></table>', true],
  ['div background', '<div background="https://@@/a.png">x</div>', false],
  ['meta refresh url', '<meta http-equiv="refresh" content="0;url=https://@@/a.png">', true],
  ['meta http-equiv=link', '<meta http-equiv="link" content="https://@@/a.png">', false],
  ['meta content', '<meta name="x" content="https://@@/a.png">', false],
  ['svg image href', '<svg width=10 height=10><image href="https://@@/a.png" width=10 height=10/></svg>', true],
  ['svg image xlink:href', '<svg width=10 height=10><image xlink:href="https://@@/a.png" width=10 height=10/></svg>', true],
  ['svg feImage href', '<svg width=10 height=10><filter id="f1"><feImage href="https://@@/a.png"/></filter><rect width=10 height=10 filter="url(#f1)"/></svg>', true],
  ['svg feImage xlink:href', '<svg width=10 height=10><filter id="f2"><feImage xlink:href="https://@@/a.png"/></filter><rect width=10 height=10 filter="url(#f2)"/></svg>', true],
  ['svg use href', '<svg width=10 height=10><use href="https://@@/a.png#a"/></svg>', false],
  ['svg use xlink:href', '<svg width=10 height=10><use xlink:href="https://@@/a.png#a"/></svg>', false],
  ['svg script href', '<svg><script href="https://@@/a.png"></script></svg>', false],
  ['svg a href', '<svg width=10 height=10><a href="https://@@/a.png"><rect width=10 height=10/></a></svg>', false],
  ['svg pattern href', '<svg width=10 height=10><pattern id="p1" href="https://@@/a.png#a"/><rect width=10 height=10 fill="url(#p1)"/></svg>', false],
  ['svg linearGradient href', '<svg width=10 height=10><linearGradient id="g1" href="https://@@/a.png#a"/><rect width=10 height=10 fill="url(#g1)"/></svg>', false],
  ['svg textPath href', '<svg width=100 height=100><path id="tp" d="M0 50 H100"/><text><textPath href="https://@@/a.png#a">x</textPath></text></svg>', false],
  ['svg mpath href', '<svg width=10 height=10><rect width=10 height=10><animateMotion><mpath href="https://@@/a.png#a"/></animateMotion></rect></svg>', false],
  ['svg style attr url', '<svg width=10 height=10><rect width=10 height=10 style="fill:url(https://@@/a.png#a)"/></svg>', true],
  ['svg filter attr url', '<svg width=10 height=10><rect width=10 height=10 filter="url(https://@@/a.png#f)"/></svg>', false],
  ['svg marker-start', '<svg width=10 height=10><path d="M0 0 L5 5" marker-start="url(https://@@/a.png#m)"/></svg>', true],
  ['math href', '<math href="https://@@/a.png"><mi>x</mi></math>', false],
  ['math mglyph src', '<math><mglyph src="https://@@/a.png"/></math>', false],
  ['body style bg url', '<div style="background:url(https://@@/a.png)">x</div>', true],
  ['style @import', '<style>@import "https://@@/a.png";</style>', true],
  ['style @font-face', '<style>@font-face{font-family:f;src:url(https://@@/a.png)} p{font-family:f}</style><p>x</p>', true],
  ['video>track(captions)', '<video controls><track src="https://@@/a.png" kind="captions" default></video>', false],
  ['image (html) src', '<image src="https://@@/a.png">', true],
  ['bgsound src', '<bgsound src="https://@@/a.png">', false],
  ['image (html) srcset', '<image srcset="https://@@/a.png 1x">', true],
  ['isindex src', '<isindex src="https://@@/a.png">', false],
  ['svg image src', '<svg width=10 height=10><image src="https://@@/a.png" width=10 height=10></svg>', false],
  ['svg image srcset', '<svg width=10 height=10><image srcset="https://@@/a.png 1x" width=10 height=10></svg>', false],
  ['math image src', '<math><image src="https://@@/a.png"></math>', false],
  ['svg video src', '<svg><video src="https://@@/a.png"></video></svg>', false],
  ['svg audio src', '<svg><audio src="https://@@/a.png"></audio></svg>', false],
  ['svg link stylesheet', '<svg><link rel="stylesheet" href="https://@@/a.png"></svg>', false],
  ['svg iframe src', '<svg><iframe src="https://@@/a.png"></iframe></svg>', false],
  ['svg object data', '<svg><object data="https://@@/a.png"></object></svg>', false],
  ['svg embed src (embed leaves svg)', '<svg><embed src="https://@@/a.png"></svg>', true],
  ['svg img src (img leaves svg)', '<svg><img src="https://@@/a.png"></svg>', true],
  ['svg td background', '<svg><td background="https://@@/a.png"></td></svg>', false],
  ['math td background', '<math><td background="https://@@/a.png"></td></math>', false],
  ['svg desc video src', '<svg><desc><video src="https://@@/a.png"></video></desc></svg>', true],
  ['svg desc image srcset', '<svg><desc><image srcset="https://@@/a.png 1x"></desc></svg>', true],
  ['svg foreignObject feImage', '<svg><foreignObject><feImage href="https://@@/a.png"/></foreignObject></svg>', false],
  ['svg style > img', '<svg><style><img src="https://@@/a.png"></style></svg>', true],
  ['svg style encoded @import', '<svg><style>@import "https&#58;//@@/a.css";</style></svg>', true],
  ['svg style legacy &quot before a letter', '<svg><style>@import &quothttps://@@/a.css&quot;</style></svg>', true],
  ['svg style CDATA keeps references', '<svg><style><![CDATA[@import "https&#58;//@@/a.css";]]></style></svg>', false],
  ['html style keeps references', '<style>@import "https&#58;//@@/a.css";</style>', false],
  ['math style > img', '<math><style><img src="https://@@/a.png"></style></math>', true],
  ['svg style/ then img', '<svg><style/><img src="https://@@/a.png"></svg>', true],
  ['math style/ then img', '<math><style/><img src="https://@@/a.png"></math>', true],
  ['svg script/ then img', '<svg><script/><img src="https://@@/a.png"></svg>', true],
  ['frame (in body)', '<frame src="https://@@/a.png">', false],
  ['isindex action', '<isindex action="https://@@/a.png">', false],
  ['menuitem icon', '<menu type="context"><menuitem icon="https://@@/a.png" label="x"></menuitem></menu>', false],
  ['img ping', '<img src="a.png" ping="https://@@/a.png">', false],
  ['svg fill attr', '<svg width=10 height=10><rect width=10 height=10 fill="url(https://@@/a.png#a)"/></svg>', true],
  ['svg stroke attr', '<svg width=10 height=10><rect width=10 height=10 stroke="url(https://@@/a.png#a)"/></svg>', true],
  ['svg marker-mid attr', '<svg width=10 height=10><path d="M0 0 L5 5 L9 9" marker-mid="url(https://@@/a.png#m)"/></svg>', true],
  ['svg marker-end attr', '<svg width=10 height=10><path d="M0 0 L5 5" marker-end="url(https://@@/a.png#m)"/></svg>', true],
  ['svg clip-path attr', '<svg width=10 height=10><rect width=10 height=10 clip-path="url(https://@@/a.png#c)"/></svg>', true],
  ['svg mask attr', '<svg width=10 height=10><rect width=10 height=10 mask="url(https://@@/a.png#c)"/></svg>', true],
  ['svg cursor attr', '<svg width=10 height=10><rect width=10 height=10 cursor="url(https://@@/a.png), auto"/></svg>', true],
  ['svg style filter', '<svg width=10 height=10><rect width=10 height=10 style="filter:url(https://@@/a.png#f)"/></svg>', false],
  ['html style filter', '<div style="filter:url(https://@@/a.png#f)">x</div>', false],
  ['html style cursor', '<div style="cursor:url(https://@@/a.png), auto">x</div>', true],
  ['html list-style-image', '<ul style="list-style-image:url(https://@@/a.png)"><li>x</li></ul>', true],
  ['html border-image', '<div style="border:5px solid;border-image:url(https://@@/a.png) 5">x</div>', true],
  ['html mask-image', '<div style="mask-image:url(https://@@/a.png);width:9px;height:9px">x</div>', true],
  ['html content url', '<style>.cu::before{content:url(https://@@/a.png)}</style><div class="cu">x</div>', true],
  ['details/summary', '<details><summary>x</summary></details>', false],
  ['body background', '<!doctype html><html><head></head><body background="https://@@/a.png">x</body></html>', true],
  ['html manifest', '<!doctype html><html manifest="https://@@/a.png"><head></head><body>x</body></html>', false],
  ['frameset>frame src', '<!doctype html><html><head></head><frameset><frame src="https://@@/a.png"></frameset></html>', true],
  ['frameset>frame longdesc', '<!doctype html><html><head></head><frameset><frame src="a.html" longdesc="https://@@/a.png"></frameset></html>', false],
  ['head profile', '<!doctype html><html><head profile="https://@@/a.png"></head><body>x</body></html>', false],
  ['base href + img', '<!doctype html><html><head><base href="https://@@/a.png"></head><body><img src="rel.png"></body></html>', true],
];

test('remote-subresource flags exactly what Chromium requests (probed table)', () => {
  const wrong = [];
  for (const [name, markup, requested] of FETCHERS) {
    const html = markup.replaceAll('@@', 'example.com');
    if (ids(lint(html)).includes('remote-subresource') !== requested) wrong.push(`${name} (${requested ? 'requested' : 'not requested'}): ${html}`);
  }
  assert.deepEqual(wrong, []);
});

// A regex for a trailing run backtracks from every start inside a run that is not at the end, so each of these took
// seconds at this size before the trims became index scans (a, then 100000 of the run, then b).
test('trimming and scanning are linear: long runs inside a URL, a srcset, a style and a script', () => {
  const n = 100000;
  const started = Date.now();
  for (const html of [
    `<img src="a${' '.repeat(n)}b">`,
    `<img src="a${'&#1;'.repeat(n / 4)}b">`,
    `<img srcset="a${','.repeat(n)}b">`,
    `<div style="background:url(a${' '.repeat(n)}b)">x</div>`,
    `<style>.a{background:url(a${' '.repeat(n)}b)}</style>`,
    `<script>${'-'.repeat(n)}</script><img src="a.png">`,
    `<script>${'<!--'.repeat(n / 4)}</script>`,
    `<meta http-equiv="refresh" content="1${' '.repeat(n)}x">`,
  ]) lint(html);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

test('atsLint reads a long attribute run in <html> once, not from every position in it', () => {
  const started = Date.now();
  for (const run of ['a', 'section-title']) {
    const p = join(dir, `ats${n++}.html`);
    writeFileSync(p, `<html ${run.repeat(100000)}>`);
    atsLint(p, 'cv');
  }
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

test('srcdoc nested past the cap is surfaced by a depth-limit finding, never silently passed', () => {
  const nest = (inner, levels) => {
    let html = inner;
    for (let i = 0; i < levels; i++) html = `<iframe srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"></iframe>`;
    return html;
  };
  const remote = '<img src="https://example.com/a.png">';
  const local = '<img src="a.png">';
  assert.ok(ids(lint(nest(remote, 3))).includes('remote-subresource'), 'inside the cap the remote request is named');
  assert.deepEqual(ids(lint(nest(local, 8))), [], 'local-only nesting inside the cap is valid');
  const past = lint(nest(remote, 40));
  assert.equal(past.error, null);
  assert.ok(ids(past).includes('srcdoc-depth-limit'), 'a remote request past the cap still fails through the depth-limit finding');
  assert.ok(!ids(past).includes('remote-subresource'), 'the capped iframe is not labelled a remote subresource');
  assert.ok(ids(lint(nest(local, 40))).includes('srcdoc-depth-limit'), 'content past the cap cannot be proven local, so it is reported too');
});

test('the meta-refresh text says what a refresh does (probed: a local target replaces the printed document, a remote one is aborted)', () => {
  const [f] = lint('<meta http-equiv="refresh" content="0;url=a.html">').findings;
  assert.equal(f.id, 'meta-refresh');
  assert.match(f.rule, /navigates the page/);
  assert.match(f.rule, /replaces the document/);
  assert.match(f.rule, /aborted/);
  assert.doesNotMatch(f.rule, /not followed/);
});

test('the depth-limit text says the srcdoc could not be checked, not that it fetches something', () => {
  let html = '<img src="a.png">';
  for (let i = 0; i < 20; i++) html = `<iframe srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"></iframe>`;
  const f = lint(html).findings.find((x) => x.id === 'srcdoc-depth-limit');
  assert.ok(f);
  assert.match(f.rule, /could not be checked/);
  assert.match(f.rule, /deeper than 16 levels/);
  assert.doesNotMatch(f.rule, /request|fetch/);
});

test('every finding is a warning with a rule text and a detail', () => {
  const r = lint('<script>x</script>');
  assert.equal(r.ok, false);
  assert.equal(r.error, null);
  for (const f of r.findings) {
    assert.equal(f.severity, 'warning');
    assert.ok(f.rule && f.detail);
  }
});

test('a clean template reports ok', () => {
  const r = lint('<html><head><meta charset="utf-8"><style>body{color:#000}</style></head><body><h1>{{NAME}}</h1></body></html>');
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
});

test('an unreadable path is reported, never thrown', () => {
  const r = renderLint(join(dir, 'missing.html'));
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

// The child gets a throwaway data root, so a template the developer keeps in
// their own data/templates cannot change what `standard` resolves to.
function lintCli(userCv) {
  const root = mkdtempSync(join(tmpdir(), 'render-lint-root-'));
  try {
    if (userCv !== undefined) {
      mkdirSync(join(root, 'data', 'templates'), { recursive: true });
      writeFileSync(join(root, 'data', 'templates', 'cv-template.standard.html'), userCv);
    }
    const out = execFileSync(process.execPath, ['cv-templates.mjs', 'lint', 'cv', 'standard', '--render'], {
      cwd: ROOT, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
    });
    return JSON.parse(out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('lint --render runs the render check and exits 0 on findings', () => {
  const parsed = lintCli();
  assert.ok(Array.isArray(parsed.findings));
  assert.equal(parsed.ok, true);
  const dirty = lintCli('<html><body><img src="https://example.com/a.png"><h1>{{NAME}}</h1>{{SECTION_EXPERIENCE}}{{EXPERIENCE}}{{SECTION_EDUCATION}}{{EDUCATION}}</body></html>');
  assert.equal(dirty.ok, false);
  assert.ok(dirty.findings.some((f) => f.id === 'remote-subresource'));
});

// Tracked files only: listTemplates() also walks templates/<pack>/ and any
// template the developer added, so a local install could fail this test.
function trackedTemplates() {
  try {
    return execFileSync('git', ['ls-files', '-z', 'templates'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\0').filter((f) => f.endsWith('.html')).map((f) => join(ROOT, f));
  } catch {
    return null;
  }
}

test('the shipped templates are clean', (t) => {
  const shipped = trackedTemplates();
  if (!shipped) return t.skip('git is unavailable, so the tracked template set cannot be read');
  assert.ok(shipped.length >= 8, `expected the shipped template set, found ${shipped.length}`);
  for (const path of shipped) {
    const r = renderLint(path);
    assert.deepEqual(r.findings, [], `${path}: ${JSON.stringify(r.findings)}`);
    assert.equal(r.error, null);
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

// An iframe in svg or math is a foreign element: it loads no srcdoc, so nothing in
// the srcdoc is requested or run (probed with JavaScript-off Chromium). A <meta>
// breaks out of foreign content, so a refresh outside an iframe still counts.
test('a srcdoc is read only on an HTML iframe', () => {
  const inner = '&lt;img src=&quot;https://example.com/a.png&quot;&gt;&lt;script&gt;x()&lt;/script&gt;&lt;meta http-equiv=refresh content=0&gt;';
  const want = ['meta-refresh', 'remote-subresource', 'script-element'];
  assert.deepEqual(ids(lint(`<iframe srcdoc="${inner}"></iframe>`)).filter((id) => want.includes(id)).sort(), want);
  for (const wrap of ['svg', 'math']) {
    const html = `<${wrap}><iframe srcdoc="${inner}"></iframe></${wrap}>`;
    assert.deepEqual(ids(lint(html)).filter((id) => want.includes(id)), [], html);
  }
  assert.deepEqual(ids(lint('<svg><meta http-equiv="refresh" content="0;url=a.html"></svg>')), ['meta-refresh']);
});

// An svg <style> is a stylesheet; a math <style> is not, and Chromium requests nothing
// for its CSS. An svg <style> left open at the end of the input, or cut off by an
// unfinished tag, is still applied (probed with JavaScript-off Chromium).
test('svg style CSS is read to the end of the input; math style CSS is not a stylesheet', () => {
  const css = '.s{background:url(https://example.com/a.png)}';
  for (const html of [`<svg><style>${css}`, `<svg><style>${css}<b`, `<svg><style>${css}</style></svg>`]) {
    assert.deepEqual(ids(lint(html)), ['remote-subresource'], html);
  }
  for (const html of [`<math><style>${css}`, `<math><style>${css}</style></math>`]) {
    assert.deepEqual(ids(lint(html)), [], html);
  }
});

// SVG reads href and ignores xlink:href when both are present, on <image> and
// <feImage> alike. A <base> inside svg or math still sets the base Chromium resolves
// a later <img> against, so it is not excluded. Probed with JavaScript-off Chromium.
test('an svg image fetches href over xlink:href, and a foreign <base> still counts', () => {
  const X = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
  const remote = 'https://example.com/a.png';
  const cases = [
    [`<svg ${X}><image href="local.png" xlink:href="${remote}"/></svg>`, []],
    [`<svg ${X}><image xlink:href="${remote}"/></svg>`, ['remote-subresource']],
    [`<svg ${X}><image href="${remote}" xlink:href="local.png"/></svg>`, ['remote-subresource']],
    [`<svg ${X}><filter id=f><feImage href="local.png" xlink:href="${remote}"/></filter></svg>`, []],
    [`<svg ${X}><filter id=f><feImage xlink:href="${remote}"/></filter></svg>`, ['remote-subresource']],
    ['<svg><base href="https://example.com/"></base></svg><img src="logo.png">', ['remote-subresource']],
    ['<math><base href="https://example.com/"></base></math><img src="logo.png">', ['remote-subresource']],
  ];
  for (const [html, want] of cases) assert.deepEqual(ids(lint(html)), want, html);
});
