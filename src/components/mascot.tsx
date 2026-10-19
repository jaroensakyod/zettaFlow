// น้องโฟลว์: EliteFlow's assistant character. Moods and actions drive CSS animations (see .flow-char in globals.css).
export type FlowMood = "idle" | "listening" | "thinking" | "talking" | "happy";
export type FlowAct = "" | "wave" | "hop" | "look" | "wiggle";
export function FlowMascot({
  size = 48,
  antenna = true,
  label,
  mood = "idle",
  act = "",
  animated = false,
}: {
  size?: number;
  antenna?: boolean;
  label?: string;
  mood?: FlowMood;
  act?: FlowAct;
  animated?: boolean;
}) {
  return (
    <svg
      className={animated ? `flow-char mood-${mood}${act ? " act-" + act : ""}` : undefined}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      overflow="visible"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g className="fc-body">
        {antenna && (
          <g className="fc-antenna">
            <line x1="60" y1="22" x2="60" y2="10" stroke="#6a43d1" strokeWidth="4" strokeLinecap="round" />
            <circle className="fc-bulb" cx="60" cy="9" r="6" fill="#ffc94d" />
          </g>
        )}
        <ellipse className="fc-arm fc-arm-l" cx="22" cy="74" rx="7" ry="10" fill="#6a43d1" />
        <ellipse className="fc-arm fc-arm-r" cx="98" cy="74" rx="7" ry="10" fill="#6a43d1" />
        <ellipse cx="60" cy="68" rx="42" ry="40" fill="#7c55e6" />
        <ellipse cx="60" cy="66" rx="31" ry="27" fill="#ffffff" />
        <g className="fc-eyes">
          <g className="fc-pupils">
            <ellipse cx="48" cy="64" rx="6" ry="8" fill="#2a1f55" />
            <ellipse cx="72" cy="64" rx="6" ry="8" fill="#2a1f55" />
            <circle cx="50" cy="61" r="2.2" fill="#ffffff" />
            <circle cx="74" cy="61" r="2.2" fill="#ffffff" />
          </g>
        </g>
        <ellipse cx="39" cy="76" rx="5" ry="3.2" fill="#ffb3c7" />
        <ellipse cx="81" cy="76" rx="5" ry="3.2" fill="#ffb3c7" />
        <path className="fc-smile" d="M53 77 Q60 84 67 77" fill="none" stroke="#2a1f55" strokeWidth="3" strokeLinecap="round" />
        {animated && <ellipse className="fc-mouth" cx="60" cy="80" rx="5.5" ry="4.5" fill="#2a1f55" />}
      </g>
    </svg>
  );
}
