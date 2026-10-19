export type Role = "owner" | "manager" | "staff" | "viewer";
export type Entity = {
  id: string;
  company_id: string;
  kind: string;
  department: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string;
  version: number;
  archived_at: string | null;
};
export type HomeData = {
  finance: {
    kind: "sales" | "expenses";
    date: string;
    amount: number;
    projectId: string | null;
  }[];
  projects: { id: string; name: string }[];
  tasks: Entity[];
};
export type Member = {
  id: string;
  company_id: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
  departments: string[];
  disabled: boolean;
};
export type Company = {
  id: string;
  name: string;
  profile: Record<string, unknown>;
  settings: Record<string, unknown>;
};
export type Context = {
  user: { id: string; email: string; name: string };
  member: Member;
  company: Company;
  demo: boolean;
};
export type Template = {
  id: string;
  company_id: string;
  name: string;
  department: string;
  fields: {
    key: string;
    label: string;
    type: "text" | "number" | "date" | "choice";
    required: boolean;
    options?: string[];
  }[];
  steps: { name: string; department: string }[];
  version: number;
};
export type Ingestion = {
  id: string;
  company_id: string;
  template: Template;
  raw: string;
  values: Record<string, unknown>;
  missing: string[];
  status:
    "queued" | "processing" | "review" | "approved" | "rejected" | "failed";
  source: string;
  created_at: string;
  error?: string;
  group_id?: string;
  attachment_id?: string;
  engine?: string;
  source_user?: string;
  created_by?: string;
  lease_until?: string;
};
export type Attachment = {
  id: string;
  company_id: string;
  entity_id: string | null;
  department: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  created_at: string;
};
export type DesignRevision = {
  id: string;
  company_id: string;
  project_id: string;
  attachment_id: string;
  category: "layout" | "perspective" | "site";
  version: number;
  status: "submitted" | "revision" | "approved";
  notes: string;
  created_by: string;
  created_name: string;
  created_at: string;
  reviewed_by?: string;
  reviewed_name?: string;
  reviewed_at?: string;
  review_note?: string;
};
export type ProjectStage = {
  company_id: string;
  project_id: string;
  key: string;
  ordinal: number;
  department: string;
  label: string;
  english: string;
  status: "pending" | "progress" | "review" | "done";
  version: number;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
  updated_by?: string | null;
};
export type StockTransfer = {
  id: string;
  company_id: string;
  product_id: string;
  from_project: string | null;
  to_project: string | null;
  quantity: number;
  reference: string;
  reason: string;
  created_by: string;
  created_name: string;
  created_at: string;
};
export type ProjectInventory = {
  company_id: string;
  product_id: string;
  project_id: string;
  quantity: number;
  updated_at: string;
};
export type StageHistory = {
  id: string;
  company_id: string;
  project_id: string;
  key: string;
  department: string;
  status: ProjectStage["status"];
  actor?: string;
  created_at: string;
};
export type DesignComment = {
  id: string;
  revision_id: string;
  company_id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
};
export type Message = {
  id: string;
  company_id: string;
  department: string;
  channel: string;
  body: string;
  user_id: string;
  name: string;
  created_at: string;
};
