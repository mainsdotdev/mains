import type { SVGProps } from "react";

export default function Warning(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" {...props}>
      <path fillRule="evenodd" d="M6.88 2.68a1.3 1.3 0 0 1 2.24 0l5.34 9.15a1.3 1.3 0 0 1-1.12 1.95H2.66a1.3 1.3 0 0 1-1.12-1.95L6.88 2.68ZM8 5.2a.7.7 0 0 0-.7.7v3.05a.7.7 0 1 0 1.4 0V5.9a.7.7 0 0 0-.7-.7Zm0 6.97a.82.82 0 1 0 0-1.64.82.82 0 0 0 0 1.64Z" />
    </svg>
  );
}
