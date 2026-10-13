export function ReferencePhoto({
  name,
  kind = "site",
}: {
  name: string;
  kind?: "layout" | "perspective" | "site";
}) {
  const promenade = name.toLowerCase().includes("promenade");
  if (promenade && kind !== "site") {
    const crop =
      kind === "layout"
        ? { x: 255, y: 299, w: 445, h: 240 }
        : { x: 714, y: 299, w: 465, h: 240 };
    return (
      <span
        className="z-reference-crop"
        style={{ aspectRatio: `${crop.w}/${crop.h}` }}
      >
        <img
          src="/zetta/design-review-reference.png"
          alt={
            kind === "layout" ? "Layout Plan ต้นฉบับ" : "Perspective 3D ต้นฉบับ"
          }
          style={{
            width: (1672 / crop.w) * 100 + "%",
            left: (-crop.x / crop.w) * 100 + "%",
            top: 0,
            transform: `translateY(${(-crop.y / 941) * 100}%)`,
          }}
        />
      </span>
    );
  }
  if (promenade && kind === "site")
    return (
      <span className="z-reference-crop" style={{ aspectRatio: "270/180" }}>
        <img
          src="/zetta/system-overview-reference.png"
          alt="ภาพหน้างานต้นฉบับ"
          style={{
            width: (1536 / 270) * 100 + "%",
            left: (-1040 / 270) * 100 + "%",
            top: 0,
            transform: `translateY(${(-455 / 1024) * 100}%)`,
          }}
        />
      </span>
    );
  const src =
    kind === "layout"
      ? "fashion-island-layout"
      : kind === "perspective"
        ? "perspective-plan"
        : "fashion-island-interior";
  return (
    <img src={"/zetta/" + src + ".png"} alt={kind + " ตัวอย่างจาก PPTX"} />
  );
}
