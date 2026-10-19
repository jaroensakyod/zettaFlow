// น้องโฟลว์: EliteFlow's assistant mascot.
export function FlowMascot({ size = 48, antenna = true, label }: { size?: number; antenna?: boolean; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {antenna && (
        <>
          <line x1="60" y1="22" x2="60" y2="10" stroke="#6a43d1" strokeWidth="4" strokeLinecap="round" />
          <circle cx="60" cy="9" r="6" fill="#ffc94d" />
        </>
      )}
      <ellipse cx="22" cy="74" rx="7" ry="10" fill="#6a43d1" />
      <ellipse cx="98" cy="74" rx="7" ry="10" fill="#6a43d1" />
      <ellipse cx="60" cy="68" rx="42" ry="40" fill="#7c55e6" />
      <ellipse cx="60" cy="66" rx="31" ry="27" fill="#ffffff" />
      <ellipse cx="48" cy="64" rx="6" ry="8" fill="#2a1f55" />
      <ellipse cx="72" cy="64" rx="6" ry="8" fill="#2a1f55" />
      <circle cx="50" cy="61" r="2.2" fill="#ffffff" />
      <circle cx="74" cy="61" r="2.2" fill="#ffffff" />
      <ellipse cx="39" cy="76" rx="5" ry="3.2" fill="#ffb3c7" />
      <ellipse cx="81" cy="76" rx="5" ry="3.2" fill="#ffb3c7" />
      <path d="M53 77 Q60 84 67 77" fill="none" stroke="#2a1f55" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
