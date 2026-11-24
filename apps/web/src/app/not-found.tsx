import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-xs text-[#737373]">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#111111]">
        Page not found
      </h1>
      <p className="mt-2 max-w-sm text-sm text-[#525252]">
        The route you requested does not exist on this deployment.
      </p>
      <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-6" })}>
        Back to overview
      </Link>
    </div>
  );
}
