import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    viewBox="0 -5 32 32"
    {...props}
  >
    <title>{"delete"}</title>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M22.708 7.28a1.016 1.016 0 0 0-1.427 0l-2.3 2.3-2.239-2.24a1.002 1.002 0 1 0-1.415 1.42l2.239 2.23-2.268 2.27a1.013 1.013 0 0 0 0 1.43c.394.39 1.033.39 1.427 0l2.268-2.27 2.239 2.24a1.002 1.002 0 1 0 1.415-1.42l-2.239-2.23 2.3-2.3c.395-.4.395-1.03 0-1.43ZM29.998 18c0 1.1-.896 2-2.002 2H10.467l-8.151-9.02L10.438 2h17.558c1.106 0 2.002.9 2.002 2v14ZM27.996 0H10.051c-.28-.02-.566.07-.78.28L.285 10.22a.989.989 0 0 0-.287.76c-.015.28.076.56.287.77l8.986 9.94c.196.19.452.29.708.29V22h18.017A4.002 4.002 0 0 0 32 18V4c0-2.21-1.793-4-4.004-4Z"
    />
  </svg>
)
export default SvgComponent
