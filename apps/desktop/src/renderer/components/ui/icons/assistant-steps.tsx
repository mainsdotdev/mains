import type { SVGProps } from "react";

const silhouette = "M5 7.25h2.75V5.5a2 2 0 0 1 2-2h3.5a2 2 0 0 1 2 2H19a2 2 0 0 1 2 2v8.75a2.5 2.5 0 0 1-2.5 2.5H18v.75a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5v-.75h-.5a2.5 2.5 0 0 1-2.5-2.5v-7a2 2 0 0 1 2-2Z";
const eyes = "M7.75 13h1.5a.5.5 0 0 1 .5.5V15a.5.5 0 0 1-.5.5h-1.5a.5.5 0 0 1-.5-.5v-1.5a.5.5 0 0 1 .5-.5ZM14.5 13H16a.5.5 0 0 1 .5.5V15a.5.5 0 0 1-.5.5h-1.5a.5.5 0 0 1-.5-.5v-1.5a.5.5 0 0 1 .5-.5Z";

export default function AssistantSteps({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24" fill="none" {...props}>
      {filled ? (
        <path fill="currentColor" fillRule="evenodd" d={`${silhouette} ${eyes}`} />
      ) : (
        <>
          <path stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
            d={`${silhouette} M3 10.75h18 M7.75 7.25v3.5 M15.25 5.5v5.25`} />
          <path fill="currentColor" d={eyes} />
        </>
      )}
    </svg>
  );
}
