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
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
      d="M2 10s3.5 4 10 4 10-4 10-4M4 11.645 2 14m20 0-1.996-2.352M8.914 13.68 8 16.5m7.063-2.812L16 16.5"
    />
  </svg>
)
export default SvgComponent
