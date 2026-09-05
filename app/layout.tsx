/**
 * Root layout that wires global providers, Clerk, fonts, and application metadata.
 */
import { ClerkProvider } from '@clerk/nextjs';
import "./globals.css";
import type { Metadata } from "next";
import { Figtree } from 'next/font/google'
import axios from 'axios'
import Provider from './provider';
import { Toaster } from '@/components/ui/toast';
export const metadata: Metadata = {
  title: "Arkitech AI",
  description: "Create, schedule, and run AI agents for everyday operations.",
};

const figTree = Figtree({ subsets: ['latin'] })



export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {


  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ margin: 0, padding: 0 }} className={figTree.className}>
          <Provider>
            {children}
          </Provider>
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
