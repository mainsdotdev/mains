import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      d="M8 4.981H6c-1.886 0-2.828 0-3.414.586C2 6.153 2 7.096 2 8.982v6.899c0 1.5 0 2.25.382 2.775a2 2 0 0 0 .443.443c.526.382 1.275.382 2.774.382h3.352a3.11 3.11 0 0 1 3.049 2.5v-15c-.293-.39-.44-.586-.599-.754a4 4 0 0 0-2.438-1.22c-.23-.026-.475-.026-.963-.026Z"
    />
    <path
      strokeLinecap="square"
      d="M12 6.981v15a3.11 3.11 0 0 1 3.05-2.5H18.4c1.499 0 2.248 0 2.774-.382.17-.123.32-.273.444-.443C22 18.13 22 17.38 22 15.88v-8.4c0-.465 0-.697-.038-.89a2 2 0 0 0-1.572-1.572c-.193-.038-.425-.038-.89-.038"
    />
    <path
      strokeLinecap="round"
      d="M12 7.48s.77-4.237 5.017-5.273c.812-.198 1.218-.297 1.6.003C19 2.51 19 3 19 3.98v10.5c0 .87 0 1.304-.213 1.576-.214.271-.733.398-1.77.651C12.77 17.743 12 21.981 12 21.981"
    />
  </svg>
)
export default SvgComponent
