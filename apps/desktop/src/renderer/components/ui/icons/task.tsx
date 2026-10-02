import type { SVGProps } from "react"
const SvgComponent = ({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={filled ? 2.25 : 1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M12 6h1c1.87 0 2.804 0 3.5.402A3 3 0 0 1 17.598 7.5C18 8.196 18 9.13 18 11M6 12v9M9 3 3 9M9 9 3 3" />
    <circle
      cx={18}
      cy={18}
      r={filled ? 3.75 : 3}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
    />
  </svg>
)
export default SvgComponent
