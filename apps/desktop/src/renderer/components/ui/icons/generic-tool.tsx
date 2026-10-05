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
    <path d="M8 6.5h8.75c2.107 0 3.16 0 3.917.506a3 3 0 0 1 .827.827c.442.661.498 1.549.505 3.167M12 6.5l-.633-1.267c-.525-1.05-1.005-2.106-2.168-2.542C8.69 2.5 8.108 2.5 6.944 2.5c-1.816 0-2.724 0-3.406.38A3 3 0 0 0 2.38 4.038C2 4.72 2 5.628 2 7.444V10.5c0 4.714 0 7.071 1.464 8.535C4.822 20.393 6.944 20.492 11 20.5M20.5 17.5A2.5 2.5 0 0 1 18 20m2.5-2.5A2.5 2.5 0 0 0 18 15m2.5 2.5H22M18 20a2.5 2.5 0 0 1-2.5-2.5M18 20v1.5m-2.5-4A2.5 2.5 0 0 1 18 15m-2.5 2.5H14m4-2.5v-1.5m1.768 2.232 1.06-1.06m-4.596 4.596-1.06 1.06m4.596-1.06 1.06 1.06m-4.596-4.596-1.06-1.06" />
  </svg>
)
export default SvgComponent
