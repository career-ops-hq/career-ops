import type { Metadata, Viewport } from "next";
import { inter, instrumentSerif, instrumentSerifItalic } from "@/lib/fonts";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "career-ops — official web experience",
  description: "The official, local-first web experience for career-ops.",
  // Home-screen / standalone (iOS): let our theme-color flow up to the status bar
  // + Dynamic Island; safe-area insets handle the layout.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "career-ops" },
};

export const viewport: Viewport = {
  // viewport-fit=cover → env(safe-area-inset-*) become non-zero so the header can
  // sit flush under the notch / Dynamic Island.
  viewportFit: "cover",
};

// Before paint: set the theme class AND tint the browser chrome (theme-color) to
// match. Also filter noisy third-party chrome-extension errors from polluting dev server logs.
const THEME_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem('career-ops:theme');
    var d = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (d) document.documentElement.classList.add('dark');
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    m.setAttribute('content', d ? '#0a0a0a' : '#f7f6f3');
  } catch(e) {
    document.documentElement.classList.add('dark');
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', function(event) {
      var r = event.reason;
      var str = (r && (r.stack || r.message || String(r))) || '';
      if (
        str.indexOf('chrome-extension://') !== -1 ||
        str.indexOf('moz-extension://') !== -1 ||
        str.indexOf('M_ID') !== -1 ||
        str.indexOf('bis_skin_checked') !== -1
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    window.addEventListener('error', function(event) {
      var str = (event.message || '') + ' ' + (event.filename || '');
      if (
        str.indexOf('chrome-extension://') !== -1 ||
        str.indexOf('moz-extension://') !== -1 ||
        str.indexOf('M_ID') !== -1 ||
        str.indexOf('bis_skin_checked') !== -1
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    var _ce = console.error;
    console.error = function() {
      var args = Array.prototype.slice.call(arguments);
      var msg = args.map(function(a) { return a instanceof Error ? (a.stack || a.message) : String(a); }).join(' ');
      if (
        msg.indexOf('bis_skin_checked') !== -1 ||
        msg.indexOf('chrome-extension://') !== -1 ||
        msg.indexOf('moz-extension://') !== -1 ||
        msg.indexOf('M_ID') !== -1
      ) {
        return;
      }
      return _ce.apply(console, args);
    };
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} ${instrumentSerifItalic.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
