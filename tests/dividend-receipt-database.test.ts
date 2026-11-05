import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps scheduled amounts unconfirmed and accepts an immutable, owner-scoped receipt only after payment", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.live_dividends (id bigint primary key,owner_id uuid,payment_date date,gross numeric(20,2));
      insert into public.live_dividends values (1,'00000000-0000-4000-8000-000000000001',current_date-1,10);`);
    await db.exec(readFileSync("supabase/migrations/20261105062547_dividend_receipt_evidence.sql", "utf8"));
    const owner = "00000000-0000-4000-8000-000000000001";
    expect((await db.query("select received_on from public.live_dividends")).rows[0]).toEqual({ received_on: null });
    await expect(db.query("select public.confirm_live_dividend_receipt($1,1,current_date+1,8.25)", [owner])).rejects.toThrow("ATLAS_INVALID_DIVIDEND_RECEIPT");
    await expect(db.query("select public.confirm_live_dividend_receipt($1,1,current_date,11)", [owner])).rejects.toThrow("ATLAS_INVALID_DIVIDEND_RECEIPT");
    await expect(db.query("select public.confirm_live_dividend_receipt('00000000-0000-4000-8000-000000000002',1,current_date,8.25)")).rejects.toThrow("ATLAS_DIVIDEND_NOT_FOUND");
    await db.exec("set role authenticated");
    await expect(db.query("select public.confirm_live_dividend_receipt($1,1,current_date,8.25)", [owner])).rejects.toThrow("permission denied");
    await db.exec("reset role; set role service_role");
    expect((await db.query("select public.confirm_live_dividend_receipt($1,1,current_date,8.25) as result", [owner])).rows[0]).toEqual({ result: "RECORDED" });
    expect((await db.query("select public.confirm_live_dividend_receipt($1,1,current_date,8.25) as result", [owner])).rows[0]).toEqual({ result: "DUPLICATE" });
    await expect(db.query("select public.confirm_live_dividend_receipt($1,1,current_date,9)", [owner])).rejects.toThrow("ATLAS_DIVIDEND_RECEIPT_ALREADY_RECORDED");
  } finally { await db.close(); }
});
