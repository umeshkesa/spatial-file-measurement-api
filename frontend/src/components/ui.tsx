import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm",
        variant === "primary" && "bg-emerald-600 text-white hover:bg-emerald-700",
        variant === "secondary" && "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...rest}
    />
  );
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl bg-white shadow-sm ring-1 ring-slate-200", className)} {...rest} />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-slate-100 px-5 py-3", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...rest} />;
}

const badgeTones: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-800",
  COMPLETED_WITH_ERRORS: "bg-amber-100 text-amber-800",
  PROCESSING: "bg-sky-100 text-sky-800",
  FAILED: "bg-red-100 text-red-800",
  NOT_APPLICABLE: "bg-slate-200 text-slate-600",
  UNSUPPORTED: "bg-orange-100 text-orange-800",
};

export function Badge({ status, children }: { status?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        (status && badgeTones[status]) || "bg-slate-200 text-slate-700",
      )}
    >
      {children ?? status}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
      <span className="text-sm text-slate-500">{label}…</span>
    </span>
  );
}

export function Alert({
  tone = "error",
  title,
  children,
}: {
  tone?: "error" | "info" | "warning";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "error" && "border-red-200 bg-red-50 text-red-800",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "info" && "border-sky-200 bg-sky-50 text-sky-800",
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="text-slate-400">{icon}</div>
      <p className="font-semibold text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{hint}</p>
    </div>
  );
}
