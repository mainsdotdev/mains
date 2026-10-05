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
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M17 12a5 5 0 1 1-5-5" />
    <path d="M14 2.2c-.646-.131-1.315-.2-2-.2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10c0-.685-.069-1.354-.2-2" />
    <path
      strokeLinejoin="round"
      d="m12.03 11.963 4.553-4.553m3.157-3.065-.553-1.988a.48.48 0 0 0-.761-.24c-1.436 1.173-3 2.754-1.723 5.247 2.574 1.2 4.044-.418 5.17-1.779a.486.486 0 0 0-.248-.775l-1.885-.465Z"
    />
  </svg>
)
export default SvgComponent
