import { SVGProps } from "react"

const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect
      x={6}
      y={6}
      width={12}
      height={12}
      rx={2}
      fill="currentColor"
    />
  </svg>
)
export default SvgComponent
