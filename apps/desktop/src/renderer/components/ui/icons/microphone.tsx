const SvgComponent = ({
  className,
  isRecording,
}: {
  className?: string;
  isRecording?: boolean;
}) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"
      fill={isRecording ? "#6F6E69" : "currentColor"}
    />
    <path
      d="M19 10v1a7 7 0 0 1-14 0v-1"
      stroke={isRecording ? "#6F6E69" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 18v4M8 22h8"
      stroke={isRecording ? "#6F6E69" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export default SvgComponent;
