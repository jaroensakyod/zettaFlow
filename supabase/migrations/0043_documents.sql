-- Printable business documents: ใบกำกับภาษี (tax invoice) and ใบเสร็จรับเงิน (receipt) get their own running numbers.
-- Both are issued from an existing record (an invoice, or an income payment / paid invoice); issuing is idempotent,
-- so printing the same document again shows the same number. Numbers run per calendar year: TAX-2026-0001, RC-2026-0001.
create table public.issued_documents(
 company_id uuid not null references companies(id) on delete cascade,
 kind text not null check(kind in('tax_invoice','receipt')),
 entity_id uuid not null references entities(id) on delete cascade,
 number text not null,
 issued_at timestamptz not null default now(),
 issued_by uuid references auth.users(id),
 primary key(company_id,kind,entity_id),
 unique(company_id,kind,number));
alter table issued_documents enable row level security;
revoke all on issued_documents from anon,authenticated;
grant all on issued_documents to service_role;

-- Issues (or returns the already issued) number. Finance writers only; the source must be a live record of the right kind.
create function public.issue_document(p_company uuid,p_kind text,p_entity uuid)returns text language plpgsql security definer set search_path=public as $$declare e entities;n text;p text;y int;begin
 if not can_write_dept(p_company,'Finance') then raise exception 'ไม่มีสิทธิ์';end if;
 select * into e from entities where id=p_entity and company_id=p_company and archived_at is null for update;
 if not found then raise exception 'ไม่พบเอกสาร';end if;
 if p_kind='tax_invoice' then
  if e.kind<>'invoices' then raise exception 'ออกใบกำกับภาษีได้จากใบแจ้งหนี้เท่านั้น';end if;p='TAX';
 elsif p_kind='receipt' then
  if not(e.kind='payments' and e.data->>'direction'='income' or e.kind='invoices' and e.data->>'status'='paid') then raise exception 'ออกใบเสร็จได้จากการรับชำระ หรือใบแจ้งหนี้ที่ชำระครบแล้ว';end if;p='RC';
 else raise exception 'ไม่รู้จักเอกสาร';end if;
 select number into n from issued_documents where company_id=p_company and kind=p_kind and entity_id=p_entity;
 if n is not null then return n;end if;
 y=extract(year from now() at time zone 'Asia/Bangkok')::int;
 n=p||'-'||y||'-'||lpad(next_number(p_company,p,y)::text,4,'0');
 insert into issued_documents(company_id,kind,entity_id,number,issued_by)values(p_company,p_kind,p_entity,n,auth.uid());
 return n;end$$;
revoke all on function public.issue_document(uuid,text,uuid)from public,anon;
grant execute on function public.issue_document(uuid,text,uuid)to authenticated;

-- The number and issue date (Bangkok) already issued for a record — {number,date}, null when not issued yet; Finance readers only.
create function public.document_number(p_company uuid,p_kind text,p_entity uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('number',number,'date',to_char(issued_at at time zone 'Asia/Bangkok','YYYY-MM-DD'))from issued_documents where company_id=p_company and kind=p_kind and entity_id=p_entity and can_read_dept(p_company,'Finance')$$;
revoke all on function public.document_number(uuid,text,uuid)from public,anon;
grant execute on function public.document_number(uuid,text,uuid)to authenticated;
