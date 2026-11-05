-- 0026 raised the storage bucket to 15 MB but the attachments table still capped size at 4 MB (0001),
-- so 4–15 MB files reached storage and then failed to save. Match the table to MAX_UPLOAD in src/lib/files.ts.
alter table public.attachments drop constraint if exists attachments_size_check;
alter table public.attachments add constraint attachments_size_check check(size<=15000000);
