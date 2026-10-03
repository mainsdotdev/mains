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
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M14.5 7h-5c-3.287 0-4.931 0-6.038.908a4 4 0 0 0-.554.554C2 9.57 2 11.212 2 14.5c0 3.288 0 4.931.908 6.038a4 4 0 0 0 .554.554C4.57 22 6.212 22 9.5 22h5c3.288 0 4.931 0 6.038-.908.202-.166.388-.352.554-.554C22 19.43 22 17.788 22 14.5c0-3.287 0-4.931-.908-6.038a4 4 0 0 0-.554-.554C19.43 7 17.788 7 14.5 7Z" />
    <path
      strokeLinejoin="round"
      d="M12 7V5a1 1 0 0 1 1-1 1 1 0 0 0 1-1V2M7 12h1M11.5 12h1M16 12h1M7 17h10"
    />
  </svg>
)
export default SvgComponent
