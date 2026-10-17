import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Triple Firma",
  description:
    "Agente que decide qué facturas pagar, frenar o escalar dentro de las reglas de la empresa.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
