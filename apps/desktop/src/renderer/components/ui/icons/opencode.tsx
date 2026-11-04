import { SVGProps } from "react"

// Official square mark from OpenCode's brand assets
// (opencode-logo-light-square.svg / opencode-logo-dark-square.svg).
// The second subpath winds opposite the first, so the inner window is a hole.
const svgProps: SVGProps<SVGSVGElement> = {
  xmlns: "http://www.w3.org/2000/svg",
  width: "1em",
  height: "1em",
  fill: "none",
  viewBox: "0 0 300 300",
}

export default function OpenCode({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...svgProps}
      className={className}
      style={{ flex: "none", lineHeight: 1 }}
      {...props}
    >
      <title>OpenCode</title>
      <g transform="translate(30, 0)">
        <path d="M180 240H60V120H180V240Z" fill="currentColor" opacity="0.4" />
        <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" />
      </g>
    </svg>
  )
}
