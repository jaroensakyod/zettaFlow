// Who may open หลังบ้าน. The owners are PLATFORM_ADMIN_EMAILS (set on the server, cannot be removed from the page);
// they can add team members in ตั้งค่าแพลตฟอร์ม as "admin" (everything except the team) or "viewer" (look, change
// nothing). The list lives in the platform company's settings and is loaded with the catalogue (platform-settings.ts).
export type AdminRole = "owner" | "admin" | "viewer";
export type TeamMember = { email: string; role: Exclude<AdminRole, "owner">; name?: string; added_by?: string; added_at?: string };

let team: TeamMember[] = [];
export const setAdminTeam = (t: TeamMember[]) => {
  team = t;
};
export const adminTeam = () => team;
export const ownerEmails = () =>
  (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
/** The role of a signed-in email, or null when it is not on the platform team. */
export function adminRoleOf(email: string): AdminRole | null {
  const e = email.toLowerCase();
  if (ownerEmails().includes(e)) return "owner";
  return team.find((m) => m.email === e)?.role || null;
}
