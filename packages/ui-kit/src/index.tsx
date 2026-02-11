import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>;

export function UIButton({ children, ...props }: ButtonProps) {
  return (
    <button
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
      {...props}
    >
      {children}
    </button>
  );
}
