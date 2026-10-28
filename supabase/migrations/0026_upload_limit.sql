-- Files are uploaded straight from the browser to storage (signed upload URL, src/lib/files.ts), so the 4 MB cap that
-- matched the hosting request limit can rise to 15 MB.
update storage.buckets set file_size_limit=15000000 where id='eliteflow-files';
