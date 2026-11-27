import { NextResponse } from "next/server";
import { ensureDbReady } from "@/lib/supabaseDb";
import { checkSolanaRpcHealth } from "@/lib/solanaServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const [db, rpcHealth] = await Promise.all([
    ensureDbReady(),
    checkSolanaRpcHealth(),
  ]);

  const rpc = rpcHealth.ok;
  const ok = Boolean(db && rpc);

  return NextResponse.json(
    {
      ok,
      db,
      rpc,
      ...(typeof rpcHealth.slot === "number" ? { slot: rpcHealth.slot } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
