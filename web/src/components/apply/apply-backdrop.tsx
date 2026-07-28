// Full-viewport "magic processing" wallpaper for the apply page: the real form's
// first screenshot, blurred + enlarged to fill the main area, under a dot grid
// that drifting glow-halos light up (mix-blend screen). Fixed so the questions
// scroll over it. CSS is co-located in a <style> tag (NOT globals.css) so it
// can't be defeated by Tailwind v4's stale-CSS HMR. Pure CSS, GPU transforms,
// respects prefers-reduced-motion.
const CSS = `
.co-bd{position:fixed;top:0;right:0;bottom:0;left:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--bg)}
@media(min-width:768px){.co-bd{left:15rem}}
.co-bd__img{position:absolute;inset:-15%;width:130%;height:130%;object-fit:cover;object-position:center top;filter:blur(48px) saturate(1.25);transition:opacity .9s ease}
.co-bd__tint{position:absolute;inset:0;background:
  radial-gradient(120% 90% at 50% -10%, transparent, color-mix(in srgb, var(--bg) 82%, transparent) 80%),
  linear-gradient(180deg, color-mix(in srgb, var(--bg) 28%, transparent), color-mix(in srgb, var(--bg) 68%, transparent))}
.co-bd__dots{position:absolute;inset:0;
  background-image:radial-gradient(circle, color-mix(in srgb, var(--fg) 36%, transparent) 1px, transparent 1.7px);
  background-size:24px 24px;
  -webkit-mask-image:radial-gradient(140% 110% at 50% 38%, #000 50%, transparent 100%);
  mask-image:radial-gradient(140% 110% at 50% 38%, #000 50%, transparent 100%)}
.co-bd__halo{position:absolute;width:65%;height:80%;border-radius:50%;filter:blur(70px);mix-blend-mode:screen;will-change:transform}
.co-bd__halo.a{left:-6%;top:-14%;background:radial-gradient(circle at center, hsl(26 82% 55% / .48), hsl(26 82% 55% / .12) 45%, transparent 70%);animation:co-halo-a 15s ease-in-out infinite}
.co-bd__halo.b{right:-10%;bottom:-16%;background:radial-gradient(circle at center, hsl(220 90% 72% / .42), hsl(220 90% 72% / .10) 45%, transparent 70%);animation:co-halo-b 21s ease-in-out infinite}
.co-bd__halo.c{left:26%;top:14%;width:50%;height:60%;background:radial-gradient(circle at center, hsl(0 0% 100% / .28), transparent 66%);animation:co-halo-c 18s ease-in-out infinite}
.co-bd__vignette{position:absolute;inset:0;box-shadow:inset 0 0 150px 44px color-mix(in srgb, var(--bg) 74%, transparent)}
.co-bd.is-intense .co-bd__img{opacity:.34}
.co-bd.is-intense .co-bd__dots{opacity:.75}
.co-bd.is-soft .co-bd__img{opacity:.16}
.co-bd.is-soft .co-bd__dots{opacity:.42}
.co-bd.is-soft .co-bd__halo{opacity:.6}
/* LIGHT MODE: screen-blend halos vanish on a light bg → multiply colour-washes,
   softer dots, lower image opacity. (.dark uses the screen-blend rules above.) */
html:not(.dark) .co-bd__halo{mix-blend-mode:multiply}
html:not(.dark) .co-bd__halo.a{background:radial-gradient(circle at center, hsl(26 88% 62% / .50), hsl(26 88% 62% / .12) 45%, transparent 70%)}
html:not(.dark) .co-bd__halo.b{background:radial-gradient(circle at center, hsl(222 84% 70% / .42), hsl(222 84% 70% / .10) 45%, transparent 70%)}
html:not(.dark) .co-bd__halo.c{background:radial-gradient(circle at center, hsl(30 82% 72% / .32), transparent 66%)}
html:not(.dark) .co-bd__dots{background-image:radial-gradient(circle, color-mix(in srgb, var(--fg) 22%, transparent) 1px, transparent 1.7px)}
html:not(.dark) .co-bd.is-intense .co-bd__img{opacity:.20}
html:not(.dark) .co-bd.is-soft .co-bd__img{opacity:.10}
@keyframes co-halo-a{0%{transform:translate3d(-12%,-8%,0) scale(1)}50%{transform:translate3d(22%,16%,0) scale(1.32)}100%{transform:translate3d(-12%,-8%,0) scale(1)}}
@keyframes co-halo-b{0%{transform:translate3d(26%,30%,0) scale(1.12)}50%{transform:translate3d(-10%,-12%,0) scale(.82)}100%{transform:translate3d(26%,30%,0) scale(1.12)}}
@keyframes co-halo-c{0%{transform:translate3d(38%,-22%,0) scale(.9)}50%{transform:translate3d(8%,28%,0) scale(1.18)}100%{transform:translate3d(38%,-22%,0) scale(.9)}}
@keyframes co-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.co-rise{animation:co-rise .5s ease both}
@media (prefers-reduced-motion: reduce){.co-bd__halo{animation:none}.co-rise{animation:none}}
`;

export function ApplyBackdrop({ image, intense }: { image?: string; intense: boolean }) {
  return (
    <div aria-hidden className={`co-bd ${intense ? "is-intense" : "is-soft"}`}>
      <style>{CSS}</style>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="co-bd__img" />
      )}
      <div className="co-bd__tint" />
      <div className="co-bd__dots" />
      <div className="co-bd__halo a" />
      <div className="co-bd__halo b" />
      <div className="co-bd__halo c" />
      <div className="co-bd__vignette" />
    </div>
  );
}
