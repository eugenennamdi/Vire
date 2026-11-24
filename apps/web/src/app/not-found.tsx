import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-[#8A8F98]">
        404 · Route not found
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-[#F4F5F6]">
        This clearing route does not exist.
      </h1>
      <p className="mt-2 max-w-md text-sm text-[#8A8F98]">
        Return to Mission Control to inspect live Textile FX corridors, active campaigns, or the
        public audit ledger.
      </p>
      <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-6" })}>
        Back to Mission Control
      </Link>
    </div>
  );
}
