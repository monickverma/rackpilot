import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "RackPilot", template: "%s · RackPilot" },
  description: "WhatsApp orders to reserved stock and rack pick lists for a small clothing shop. Rules decide stock; every number links to its ledger rows.",
};

// Runs while the HTML parses, before first paint, so a saved dark choice never flashes light.
const THEME_SCRIPT = `try{if(localStorage.getItem("rp-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

// The website lives in app/(site) and the live demo in app/(demo); each group has its own layout.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${robotoMono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
