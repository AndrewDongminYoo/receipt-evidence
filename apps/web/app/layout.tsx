import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "receipt-evidence",
  description: "Extract a receipt's fields and items, each with the evidence that earned it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
