import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./office.css";
import "./building.css";
import "./daytrade.css";
import "./dividendos.css";

export const metadata: Metadata = {
  title: "ATLAS · Centro de operações",
  description:
    "Autonomous Trading & Learning Agent System — operação, risco e auditoria.",
  icons: {
    icon: [{ url: "/icon.svg?v=20261102", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon?v=20261102", sizes: "180x180", type: "image/png" }],
  },
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Reloading (F5) always starts a page at its top (owner, 10/11/2026): the browser must not bring
            back the old scroll position, on any page, so this runs before the page is drawn. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{history.scrollRestoration="manual";scrollTo(0,0)}catch(e){}' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
