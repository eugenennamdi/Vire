import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <div className="surface-card max-w-md rounded-2xl p-10">
        <p className="font-mono text-xs text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The route you requested does not exist on this deployment.
        </p>
        <Link href="/" className={buttonVariants({ variant: "primary", className: "mt-6" })}>
          Back to overview
        </Link>
      </div>
    </div>
  );
}
