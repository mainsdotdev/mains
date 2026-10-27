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
    <path d="M16 13.5v4c0 1.414 0 2.121.44 2.56.439.44 1.146.44 2.56.44 1.414 0 2.121 0 2.56-.44.44-.439.44-1.146.44-2.56v-4c0-1.414 0-2.121-.44-2.56-.439-.44-1.146-.44-2.56-.44-1.414 0-2.121 0-2.56.44-.44.439-.44 1.146-.44 2.56ZM4 16.5v-8c0-2.357 0-3.535.733-4.267.732-.733 1.911-.733 4.27-.733h7.004c2.358 0 3.538 0 4.27.733.558.557.69 1.372.723 2.767M13 20.5H2.516c-.383 0-.632-.39-.461-.723L4 16.5h9" />
  </svg>
)
export default SvgComponent
