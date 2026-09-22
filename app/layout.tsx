import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./settings.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Web",
  description: "Pi Web interface for the pi coding agent",
  applicationName: "Pi Web",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  // Discourse's exact standalone-PWA combination (verified against
  // discourse/discourse app/views/layouts/_head.html.erb): viewport-fit=cover
  // in the viewport meta and NO apple-mobile-web-app-status-bar-style meta at
  // all. With cover + no bar-style meta, iOS 26 renders the status bar opaque,
  // tinted from the page's top edge, and OUTSIDE the viewport (it squeezes the
  // layout down instead of floating over it), so no vibrancy glass ever blurs
  // web content. Every contain-mode variant (no meta, black, spacers) kept the
  // blur because the glass bleeds into the viewport top only when the viewport
  // excludes the status bar. LINUX DO (a Discourse instance) is the reference.
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Pi Web",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover is required for the Discourse status-bar route: the
  // viewport must include the status-bar strip so iOS 26 squeezes the layout
  // below the opaque status bar instead of blending glass over our top edge.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
