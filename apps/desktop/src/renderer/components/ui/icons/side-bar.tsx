import { SVGProps } from "react"

const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={22}
    height={22}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M20 17.5v-11A4.53 4.53 0 0 0 15.43 2H8.57A4.54 4.54 0 0 0 4 6.5v11A4.53 4.53 0 0 0 8.57 22h6.85a4.53 4.53 0 0 0 4.57-4.5H20ZM14 5h-4"
    />
  </svg>
)
export default SvgComponent
