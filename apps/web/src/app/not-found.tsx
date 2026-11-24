import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <div className="vire-sheet max-w-md rounded-[6px] p-10">
        <p className="font-mono text-xs text-[#68665F]">404</p>
        <h1 className="mt-2 font-serif text-3xl font-normal tracking-[-0.02em] text-[#121210]">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-[#68665F]">
          The route you requested does not exist on this deployment.
        </p>
        <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-6" })}>
          Back to overview
        </Link>
      </div>
    </div>
  );
}
