import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Black } from "next/font/google";
import "./globals.css";

const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  subsets: ["latin"],
  weight: "400",
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
});

export const metadata: Metadata = {
  title: "SEM PERDÃO* — cartas contra a humanidade",
  description:
    "O jogo de cartas mais cruel do escritório. Um juiz, uma pergunta terrível e a resposta mais sem perdão vence. *Nem para você. Conteúdo 18+.",
  applicationName: "Sem Perdão",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sem Perdão",
  },
  openGraph: {
    title: "SEM PERDÃO* — cartas contra a humanidade",
    description:
      "O jogo de cartas mais cruel do escritório. *Nem para você. Conteúdo 18+.",
    type: "website",
    locale: "pt_BR",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#17161a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${archivoBlack.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
