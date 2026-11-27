import { PublicKey } from "@solana/web3.js";
import {
  fetchOnChainCreatorByUsername,
  buildSerializedSendTipTransaction,
} from "@/lib/solanaServer";
import { getCreatorFromDb, getPollWithResultsFromDb } from "@/lib/supabaseDb";
import { getTierForAmountSol, MIN_TIP_LAMPORTS } from "@/lib/constants";
import { ACTIONS_CORS_HEADERS, resolveRequestOrigin } from "@/lib/solanaActions";

export const dynamic = "force-dynamic";

function trimToMaxUtf8Bytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let result = input;
  while (encoder.encode(result).length > maxBytes && result.length > 0) {
    result = result.slice(0, -1);
  }
  return result;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: ACTIONS_CORS_HEADERS });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim().toLowerCase();
    const origin = resolveRequestOrigin(req);

    const [dbCreator, chainCreator, activePoll] = await Promise.all([
      getCreatorFromDb(username).catch(() => null),
      fetchOnChainCreatorByUsername(username).catch(() => null),
      getPollWithResultsFromDb(username).catch(() => null),
    ]);

    const creator = chainCreator || dbCreator;
    if (!creator) {
      return Response.json(
        { error: `Creator @${username} not found on SolStream` },
        { status: 404, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const currentSol = (creator.goalCurrentLamports / 1_000_000_000).toFixed(2);
    const targetSol = (creator.goalTargetLamports / 1_000_000_000).toFixed(2);
    const pollNote =
      activePoll && activePoll.isActive
        ? ` | Live Poll: "${activePoll.question}" (${activePoll.optionA} vs ${activePoll.optionB})`
        : "";

    const actions: Array<Record<string, unknown>> = [
      {
        type: "transaction",
        label: "☕ 0.005 SOL",
        href: `/api/actions/tip/${encodeURIComponent(username)}?amount=0.005`,
      },
      {
        type: "transaction",
        label: "🔥 0.025 SOL",
        href: `/api/actions/tip/${encodeURIComponent(username)}?amount=0.025`,
      },
      {
        type: "transaction",
        label: "💎 0.05 SOL",
        href: `/api/actions/tip/${encodeURIComponent(username)}?amount=0.05`,
      },
    ];

    if (activePoll && activePoll.isActive) {
      const voteSol = Math.max(
        0.001,
        activePoll.minVoteLamports / 1_000_000_000
      );
      actions.push(
        {
          type: "transaction",
          label: `Vote A: ${activePoll.optionA} (${voteSol} SOL)`,
          href: `/api/actions/tip/${encodeURIComponent(
            username
          )}?amount=${voteSol}&vote=A`,
        },
        {
          type: "transaction",
          label: `Vote B: ${activePoll.optionB} (${voteSol} SOL)`,
          href: `/api/actions/tip/${encodeURIComponent(
            username
          )}?amount=${voteSol}&vote=B`,
        }
      );
    }

    actions.push({
      type: "transaction",
      label: "Tip with Alert Message",
      href: `/api/actions/tip/${encodeURIComponent(
        username
      )}?amount={amount}&name={name}&message={message}`,
      parameters: [
        {
          type: "number",
          name: "amount",
          label: "SOL amount (min 0.001)",
          required: true,
        },
        {
          type: "text",
          name: "name",
          label: "Your display name (optional)",
          required: false,
        },
        {
          type: "text",
          name: "message",
          label: "Alert message read live on stream",
          required: false,
        },
      ],
    });

    return Response.json(
      {
        type: "action",
        icon: `${origin}/solstream-blink.png`,
        title: `Tip @${username} on SolStream ⚡`,
        description: `0% platform cut on Solana Devnet. Goal "${creator.goalTitle}": ${currentSol}/${targetSol} SOL.${pollNote}`,
        label: "Send SOL Tip",
        links: { actions },
      },
      { headers: ACTIONS_CORS_HEADERS }
    );
  } catch (err) {
    console.error("GET /api/actions/tip/[username] error:", err);
    return Response.json(
      { error: "Failed to build SolStream Blink metadata" },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    );
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim().toLowerCase();
    const url = new URL(req.url);
    const body = await req.json().catch(() => null);

    const account =
      typeof body?.account === "string" ? body.account.trim() : "";
    if (!account) {
      return Response.json(
        { message: "Missing donor wallet account" },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    try {
      new PublicKey(account);
    } catch {
      return Response.json(
        { message: "Invalid Solana wallet public key" },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const actionData =
      body?.data && typeof body.data === "object"
        ? (body.data as Record<string, unknown>)
        : {};

    const rawAmount = String(
      actionData.amount ?? url.searchParams.get("amount") ?? "0.005"
    ).trim();
    const amountSol = parseFloat(rawAmount);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return Response.json(
        { message: "Invalid SOL tip amount" },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const amountLamports = Math.round(amountSol * 1_000_000_000);
    if (amountLamports < MIN_TIP_LAMPORTS) {
      return Response.json(
        { message: "Minimum tip is 0.001 SOL" },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const rawRef = url.searchParams.get("ref")?.trim() || "";
    let validatedRef: string | undefined;
    if (rawRef) {
      try {
        validatedRef = new PublicKey(rawRef).toBase58();
      } catch {
        return Response.json(
          { message: "Invalid Solana Pay reference key" },
          { status: 400, headers: ACTIONS_CORS_HEADERS }
        );
      }
    }

    const voteRaw = String(
      actionData.vote ?? url.searchParams.get("vote") ?? ""
    )
      .trim()
      .toUpperCase();
    const votePrefix =
      voteRaw === "A" || voteRaw === "B" ? `[VOTE:${voteRaw}] ` : "";

    const rawName = String(
      actionData.name ?? url.searchParams.get("name") ?? ""
    ).trim();
    const displayName = trimToMaxUtf8Bytes(rawName || "Blink Fan", 96);

    const rawMessage = String(
      actionData.message ?? url.searchParams.get("message") ?? ""
    ).trim();
    const baseMessage =
      rawMessage || (votePrefix ? `Voted Option ${voteRaw}!` : "Tipped via Solana Blink ⚡");
    const message = trimToMaxUtf8Bytes(`${votePrefix}${baseMessage}`, 300);

    const creator = await fetchOnChainCreatorByUsername(username);
    if (!creator) {
      return Response.json(
        { message: `Creator @${username} not found on Solana Devnet` },
        { status: 404, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const tier = getTierForAmountSol(amountSol);
    const serializedTx = await buildSerializedSendTipTransaction({
      donorAddress: account,
      creatorAuthority: creator.authority,
      creatorPda: creator.pda,
      amountLamports,
      tier: tier.id,
      displayName,
      message,
      referenceKey: validatedRef,
    });

    return Response.json(
      {
        type: "transaction",
        transaction: serializedTx,
        message: `Sending ${amountSol} SOL to @${username} via SolStream ⚡`,
        links: {
          next: {
            type: "post",
            href: `/api/actions/tip/${encodeURIComponent(username)}/confirm`,
          },
        },
      },
      { headers: ACTIONS_CORS_HEADERS }
    );
  } catch (err) {
    console.error("POST /api/actions/tip/[username] error:", err);
    return Response.json(
      { message: "Failed to construct SolStream tip transaction" },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    );
  }
}
