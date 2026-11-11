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
    <path d="M4.5 18.212V8.235c0-2.703 0-4.055.824-4.895.824-.84 2.15-.84 4.801-.84h3.75c2.652 0 3.977 0 4.801.84.824.84.824 2.192.824 4.895v9.977c0 1.915 0 2.873-.601 3.196-.602.322-1.376-.22-2.924-1.306l-1.85-1.297c-1.029-.72-1.543-1.081-2.125-1.081-.582 0-1.096.36-2.124 1.081l-1.851 1.297C6.477 21.187 5.703 21.73 5.1 21.408c-.601-.323-.601-1.28-.601-3.196Z" />
  </svg>
)
export default SvgComponent
