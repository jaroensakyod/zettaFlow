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
    type: "text" | "number" | "date";
    required: boolean;
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
    | "queued"
    | "processing"
    | "review"
    | "approved"
    | "rejected"
    | "failed";
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
