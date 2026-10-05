import * as React from "react";
import { SVGProps } from "react";
const Microphone = ({
  isRecording,
  ...props
}: SVGProps<SVGSVGElement> & { isRecording?: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke={isRecording ? "#6F6E69" : "currentColor"}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 4v16M8 9v6M20 10v4M4 10v4M16 7v10"
    />
  </svg>
);
export default Microphone;
