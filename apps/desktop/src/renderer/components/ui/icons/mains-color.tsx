import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={1024}
    height={1024}
    fill="none"
    viewBox="0 0 1024 1024"
    {...props}
  >
    <path
      fill="url(#mainsc-a)"
      d="M216 359.443c0-47.38 28-91.045 73-115.199L620 51.935c34-18.58 59-18.58 91 0l67 39.02c-29-14.865-54-9.29-85 8.36L366 288.838c-42 24.155-67 66.89-67 112.412L301 987l-85-45.058V359.443Z"
    />
    <path
      fill="url(#mainsc-b)"
      d="M288 244.244 619 51.935c34-18.58 59-18.58 91 0l67 39.02c-29-14.865-54-9.29-85 8.36L365.5 289.35c-42 24.155-66.5 66.296-66.5 111.819l1 586.318-85.5-45.213 1.5-582.83c0-47.38 27-91.045 72-115.199Z"
      opacity={0.9}
    />
    <path
      fill="url(#mainsc-c)"
      d="M299 401.597c0-45.531 25-88.275 67-112.434L693 99.604c65-38.098 114-9.292 114 62.257v553.81l-85 45.747V183.233l-127 67.832v535.69l-83 44.602v-534.76L385 363.5v577.969L301 987l-2-585.403Z"
    />
    <path
      fill="url(#mainsc-d)"
      d="m428 341.362 84-44.72v534.784l-84-45.652V341.362Z"
    />
    <path
      fill="url(#mainsc-e)"
      d="m638 227.524 84-44.646v578.54l-84-45.576V227.524Z"
    />
    <defs>
      <linearGradient
        id="mainsc-a"
        x1={301.5}
        x2={297.866}
        y1={987}
        y2={411.378}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#fff" />
        <stop offset={1} stopColor="#282828" />
      </linearGradient>
      <linearGradient
        id="mainsc-b"
        x1={221.5}
        x2={710.857}
        y1={361.765}
        y2={13.171}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#1F1F1F" />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
      <linearGradient
        id="mainsc-c"
        x1={510.5}
        x2={510.5}
        y1={293.344}
        y2={828.57}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#252525" />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
      <linearGradient
        id="mainsc-d"
        x1={512}
        x2={512}
        y1={831.426}
        y2={296.642}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#252525" />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
      <linearGradient
        id="mainsc-e"
        x1={722}
        x2={722}
        y1={761.418}
        y2={182.878}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#999" stopOpacity={0.2} />
        <stop offset={1} stopColor="#fff" />
      </linearGradient>
    </defs>
  </svg>
)
export default SvgComponent
