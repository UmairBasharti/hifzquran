import "./globals.css";

export const metadata = {
  title: "HifzAI",
  description: "Free, open-source Quran memorization with AI.",
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
