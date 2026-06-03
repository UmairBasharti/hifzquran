import "./globals.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "HifzAI",
  description: "Free, open-source Quran memorization with AI.",
  openGraph: {
    title: "HifzAI",
    description: "Free, open-source Quran memorization with AI.",
    url: "/",
    siteName: "HifzAI",
    locale: "en_US",
    type: "website",
  },
};

// viewport-fit=cover lets env(safe-area-inset-*) report real values on notch/home-indicator
// devices, which the .pb-safe utility relies on to keep the fixed footer controls reachable.
export const viewport = {
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
