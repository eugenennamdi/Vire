import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Submit Deliverable",
  description:
    "Bind an external Celo wallet and submit deliverable proof for automated verification and exact-output local stablecoin settlement.",
  alternates: { canonical: "/claim" },
};

export default function ClaimLayout({ children }: { children: ReactNode }) {
  return children;
}
