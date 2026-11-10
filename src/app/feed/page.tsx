import { Workspace } from "@/components/workspace";
export const metadata={title:"EliteFlow — Business Workspace",icons:{icon:"/brand/eliteflow-icon.png",apple:"/brand/eliteflow-mark.png"}};
// The sign-in address: after signing in, the workspace opens on ภาพรวม (เครือข่ายธุรกิจ lives at /workspace/feed).
export default function Page(){return <Workspace initialView="dashboard"/>;}
