import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M5.992 12v6M9 14.992H3M3 22h6M13 22c3.771 0 5.657 0 6.828-1.172C21 19.657 21 17.771 21 14v-3.343c0-.818 0-1.226-.152-1.594-.152-.367-.441-.657-1.02-1.235l-4.736-4.736c-.499-.499-.748-.748-1.058-.896a1.998 1.998 0 0 0-.197-.082C13.514 2 13.161 2 12.456 2c-3.245 0-4.868 0-5.967.886a4 4 0 0 0-.603.603C5.144 4.41 5.023 5.7 5.004 8M14 2.5V3c0 2.828 0 4.243.879 5.121C15.757 9 17.172 9 20 9h.5" />
  </svg>
)
export default SvgComponent
