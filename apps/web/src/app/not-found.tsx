import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <div className="vire-card max-w-md rounded-2xl p-10">
        <p className="font-mono text-xs text-[#71717A]">404</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.03em] text-[#0A0A0C]">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-[#71717A]">
          The route you requested does not exist on this deployment.
        </p>
        <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-6" })}>
          Back to overview
        </Link>
      </div>
    </div>
  );
}
