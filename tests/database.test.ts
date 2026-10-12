import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("SQL migrations enforce tenant isolation, permissions and inventory transactions", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text)returns text[]language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
    insert into auth.users(id,email,email_confirmed_at)values('10000000-0000-4000-8000-000000000001','owner@test.local',now()),('10000000-0000-4000-8000-000000000002','other@test.local',now()),('10000000-0000-4000-8000-000000000003','viewer@test.local',now());`);
    await db.exec(
      (await readFile("supabase/migrations/0001_core.sql", "utf8")).replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
    await db.exec(
      await readFile("supabase/migrations/0002_workflows.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/0003_calendar.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/0004_analytics.sql", "utf8"),
    );
    await db.exec(await readFile("supabase/migrations/0005_retry.sql", "utf8"));
    await db.exec(
      await readFile("supabase/migrations/0006_complete_job.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/0007_legacy.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/0008_workflow_links.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/0009_design_reviews.sql", "utf8"),
    );
    const login = async (id: string, email: string) => {
      await db.exec("reset role;");
      await db.query(
        `select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)`,
        [id, email],
      );
      await db.exec("set role authenticated;");
    };
    await login("10000000-0000-4000-8000-000000000001", "owner@test.local");
    const c = (
      await db.query<{ id: string }>("select create_company($1)as id", [
        "Company A",
      ])
    ).rows[0].id;
    const p = (
      await db.query<{ id: string }>(
        `select (save_entity($1,'products',$2)).id`,
        [
          c,
          JSON.stringify({
            name: "Shirt",
            sku: "A",
            unit: "piece",
            cost: 100,
            price: 200,
            reorderLevel: 5,
            status: "active",
            stock: 99999,
          }),
        ],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ data: { stock: number } }>(
          "select data from entities where id=$1",
          [p],
        )
      ).rows[0].data.stock,
      0,
    );
    await db.query(`select post_stock_movement($1,$2,'in',10,'TEST-IN','')`, [
      c,
      p,
    ]);
    await assert.rejects(
      db.query(`select post_stock_movement($1,$2,'out',11,'TEST-OUT','')`, [
        c,
        p,
      ]),
    );
    await assert.rejects(
      db.query(`select post_stock_movement($1,$2,'in',10,'TEST-IN','')`, [
        c,
        p,
      ]),
    );
    assert.equal(
      (
        await db.query<{ data: { stock: number } }>(
          "select data from entities where id=$1",
          [p],
        )
      ).rows[0].data.stock,
      10,
    );
    const save = async (kind: string, data: Record<string, unknown>) =>
      (
        await db.query<{ id: string }>("select (save_entity($1,$2,$3)).id", [
          c,
          kind,
          JSON.stringify(data),
        ])
      ).rows[0].id;
    const supplier = await save("suppliers", {
      name: "Supplier",
      status: "active",
    });
    const purchase = await save("purchases", {
      name: "PO-001",
      supplierId: supplier,
      productId: p,
      quantity: 4,
      unitCost: 100,
      orderDate: "2026-10-12",
    });
    await assert.rejects(
      db.query("select purchase_action($1,$2,'receive')", [c, purchase]),
    );
    await db.query("select purchase_action($1,$2,'approve')", [c, purchase]);
    await db.query("select purchase_action($1,$2,'receive')", [c, purchase]);
    await assert.rejects(
      db.query("select purchase_action($1,$2,'receive')", [c, purchase]),
    );
    assert.equal(
      (
        await db.query<{ data: { stock: number } }>(
          "select data from entities where id=$1",
          [p],
        )
      ).rows[0].data.stock,
      14,
    );
    const customer = await save("customers", {
      name: "Customer",
      status: "active",
    });
    const invoice = await save("invoices", {
      name: "INV-001",
      customerId: customer,
      date: "2026-10-12",
      dueDate: "2026-10-20",
      subtotal: 100,
      vat: 7,
    });
    await save("payments", {
      name: "Receipt",
      invoiceId: invoice,
      direction: "income",
      date: "2026-10-12",
      amount: 40,
      method: "โอนธนาคาร",
    });
    await assert.rejects(
      save("payments", {
        name: "Overpay",
        invoiceId: invoice,
        direction: "income",
        date: "2026-10-12",
        amount: 68,
        method: "เงินสด",
      }),
    );
    let invoiceData = (
      await db.query<{ data: { paid: number; status: string } }>(
        "select data from entities where id=$1",
        [invoice],
      )
    ).rows[0].data;
    assert.equal(invoiceData.paid, 40);
    assert.equal(invoiceData.status, "partial");
    await save("payments", {
      name: "Receipt 2",
      invoiceId: invoice,
      direction: "income",
      date: "2026-10-12",
      amount: 67,
      method: "โอนธนาคาร",
    });
    invoiceData = (
      await db.query<{ data: { paid: number; status: string } }>(
        "select data from entities where id=$1",
        [invoice],
      )
    ).rows[0].data;
    assert.equal(invoiceData.status, "paid");
    const deal = await save("deals", {
      name: "Promenade",
      location: "Bangkok",
      rent: 55000,
      status: "pending",
      startDate: "2026-10-16",
      endDate: "2026-10-28",
    });
    await db.query("select approve_deal($1,$2)", [c, deal]);
    await assert.rejects(db.query("select approve_deal($1,$2)", [c, deal]));
    assert.equal(
      (await db.query("select * from entities where kind='tasks'")).rows.length,
      5,
    );
    assert.equal(
      (await db.query("select * from calendar_entries($1,'2026-10')", [c])).rows
        .length,
      2,
    );
    const template = (
      await db.query<{ id: string }>(
        "select (save_template($1,'Sales','Sales',$2,$3)).id",
        [
          c,
          JSON.stringify([
            { key: "sales", label: "ยอดขาย", type: "number", required: true },
          ]),
          JSON.stringify([{ name: "Check sales", department: "Sales" }]),
        ],
      )
    ).rows[0].id;
    const job = (
      await db.query<{ id: string }>(
        "select (submit_ingestion($1,$2,'ยอดขาย: 120')).id",
        [c, template],
      )
    ).rows[0].id;
    await assert.rejects(db.query("select * from claim_ingestion($1)", [job]));
    await db.exec("reset role;");
    await db.query(
      "update ingestions set group_id='test-line-group'where id=$1",
      [job],
    );
    await db.exec("set role service_role;");
    const claimed = (
      await db.query<{ id: string; lease_id: string }>(
        "select * from claim_ingestion($1)",
        [job],
      )
    ).rows[0];
    assert.equal(claimed.id, job);
    await db.query(
      "select complete_ingestion($1,$2,'{}','[\"ยอดขาย\"]','explicit-fields')",
      [job, claimed.lease_id],
    );
    await db.query(
      "select complete_ingestion($1,$2,'{\"sales\":9999}','[]','ai')",
      [job, claimed.lease_id],
    );
    assert.equal(
      (await db.query("select * from notification_outbox")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ values: Record<string, unknown> }>(
          "select values from ingestions where id=$1",
          [job],
        )
      ).rows[0].values.sales,
      undefined,
    );
    await db.exec("reset role;set role authenticated;");
    await assert.rejects(
      db.query("select decide_ingestion($1,$2,'approved','{}','')", [c, job]),
    );
    await db.query(
      "select decide_ingestion($1,$2,'approved','{\"sales\":120}','')",
      [c, job],
    );
    await assert.rejects(
      db.query(
        "select decide_ingestion($1,$2,'approved','{\"sales\":120}','')",
        [c, job],
      ),
    );
    const metrics = (
      await db.query<{ value: { total: number }[] }>(
        "select template_metrics($1)as value",
        [c],
      )
    ).rows[0].value;
    assert.equal(metrics[0].total, 120);
    await assert.rejects(db.query("select retry_ingestion($1,$2)", [c, job]));
    const spaceValues = {
      project: "Central Rama 2",
      location: "Bangkok",
      rent: 45000,
      start: "2026-11-01",
      end: "2026-11-14",
    };
    const spaceFields = Object.keys(spaceValues).map((key) => ({
      key,
      label: key,
      type:
        key === "rent"
          ? "number"
          : ["start", "end"].includes(key)
            ? "date"
            : "text",
      required: true,
    }));
    const spaceTemplate = (
      await db.query<{ id: string }>(
        "select (save_template($1,'Space','Business Development',$2,$3)).id",
        [
          c,
          JSON.stringify(spaceFields),
          JSON.stringify([{ name: "Design space", department: "Design" }]),
        ],
      )
    ).rows[0].id;
    const spaceJob = (
      await db.query<{ id: string }>(
        "select (submit_ingestion($1,$2,'Space report')).id",
        [c, spaceTemplate],
      )
    ).rows[0].id;
    await db.exec("reset role;set role service_role;");
    const lease = (
      await db.query<{ lease_id: string }>(
        "select * from claim_ingestion($1)",
        [spaceJob],
      )
    ).rows[0].lease_id;
    await db.query(
      "select complete_ingestion($1,$2,$3,'[]','explicit-fields')",
      [spaceJob, lease, JSON.stringify(spaceValues)],
    );
    await db.exec("reset role;set role authenticated;");
    await db.query("select decide_ingestion($1,$2,'approved',$3,'')", [
      c,
      spaceJob,
      JSON.stringify(spaceValues),
    ]);
    const linkedDeal = (
      await db.query<{ data: { projectId: string; status: string } }>(
        "select data from entities where kind='deals'and data->>'ingestionId'=$1",
        [spaceJob],
      )
    ).rows[0];
    assert.equal(linkedDeal.data.status, "approved");
    assert.ok(linkedDeal.data.projectId);
    assert.equal(
      (
        await db.query(
          "select * from entities where kind='tasks'and data->>'projectId'=$1",
          [linkedDeal.data.projectId],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from calendar_entries($1,'2026-11')", [c])).rows
        .length,
      2,
    );
    await db.exec("reset role;set role service_role;");
    const fileIds = [];
    for (let index = 0; index < 3; index++) {
      fileIds.push(
        (
          await db.query<{ id: string }>(
            `insert into attachments(company_id,entity_id,department,name,mime,size,path) values($1,$2,'Design','Layout.png','image/png',100,$3) returning id`,
            [c, linkedDeal.data.projectId, `design-file-${index}`],
          )
        ).rows[0].id,
      );
    }
    await db.exec("reset role;set role authenticated;");
    const attachmentId = "10000000-0000-4000-8000-000000000099";
    await db.query(
      "select add_attachment($1,$2,$3,'Design','Version.pdf','application/pdf',100,$4)",
      [
        c,
        attachmentId,
        linkedDeal.data.projectId,
        `${c}/Design/${attachmentId}`,
      ],
    );
    const revision = (
      await db.query<{ id: string; version: number }>(
        "select * from create_design_revision($1,$2,$3,'layout','Initial')",
        [c, linkedDeal.data.projectId, fileIds[0]],
      )
    ).rows[0];
    assert.equal(revision.version, 1);
    await assert.rejects(
      db.query("select create_design_revision($1,$2,$3,'layout','Duplicate')", [
        c,
        linkedDeal.data.projectId,
        fileIds[0],
      ]),
    );
    const v2 = (
      await db.query<{ id: string; version: number }>(
        "select * from create_design_revision($1,$2,$3,'layout','Updated')",
        [c, linkedDeal.data.projectId, fileIds[1]],
      )
    ).rows[0];
    assert.equal(v2.version, 2);
    await assert.rejects(
      db.query("select review_design_revision($1,$2,'approved','')", [
        c,
        revision.id,
      ]),
    );
    await assert.rejects(
      db.query("select review_design_revision($1,$2,'revision','')", [
        c,
        v2.id,
      ]),
    );
    await db.query(
      "select comment_design_revision($1,$2,'Please increase the logo size')",
      [c, v2.id],
    );
    await db.query(
      "select review_design_revision($1,$2,'revision','Increase logo size')",
      [c, v2.id],
    );
    await assert.rejects(
      db.query("select review_design_revision($1,$2,'approved','')", [
        c,
        v2.id,
      ]),
    );
    const v3 = (
      await db.query<{ id: string }>(
        "select (create_design_revision($1,$2,$3,'layout','Logo fixed')).id",
        [c, linkedDeal.data.projectId, fileIds[2]],
      )
    ).rows[0];
    await db.query(
      "select review_design_revision($1,$2,'approved','Accepted')",
      [c, v3.id],
    );
    assert.equal(
      (await db.query("select * from design_revisions")).rows.length,
      3,
    );
    await assert.rejects(
      db.query("update design_revisions set status='approved' where id=$1", [
        revision.id,
      ]),
    );
    await db.query(
      `select invite_member($1,'viewer@test.local','viewer',array['Warehouse'])`,
      [c],
    );
    await login("10000000-0000-4000-8000-000000000003", "viewer@test.local");
    await db.query("select accept_invitations()");
    assert.equal(
      (await db.query("select * from design_revisions")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from design_comments")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select review_design_revision($1,$2,'approved','')", [
        c,
        v3.id,
      ]),
    );
    const visible = (
      await db.query<{ department: string }>("select * from entities")
    ).rows;
    assert.equal(visible.length, 2);
    assert.ok(visible.every((r) => r.department === "Warehouse"));
    await assert.rejects(
      db.query(`select post_stock_movement($1,$2,'in',1,'VIEWER','')`, [c, p]),
    );
    await assert.rejects(
      db.query(`update entities set data='{}'where id=$1`, [p]),
    );
    await login("10000000-0000-4000-8000-000000000002", "other@test.local");
    const c2 = (
      await db.query<{ id: string }>("select create_company($1)as id", [
        "Company B",
      ])
    ).rows[0].id;
    assert.notEqual(c, c2);
    assert.equal((await db.query("select * from entities")).rows.length, 0);
    assert.equal(
      (await db.query("select * from design_revisions")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select comment_design_revision($1,$2,'Cross tenant')", [
        c,
        v3.id,
      ]),
    );
    await assert.rejects(
      db.query(`select post_stock_movement($1,$2,'in',1,'CROSS-TENANT','')`, [
        c,
        p,
      ]),
    );
  } finally {
    await db.close();
  }
});
