import type { SVGProps } from "react";

export default function Info(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 11v6" />
      <circle cx={12} cy={7.5} r={0.75} fill="currentColor" stroke="none" />
    </svg>
  );
}
