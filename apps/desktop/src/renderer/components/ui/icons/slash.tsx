import type { SVGProps } from "react";

export default function Slash(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="m9 18 6-12" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
    </svg>
  );
}
