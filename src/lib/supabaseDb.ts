import fs from "fs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import type { OnChainCreator, OnChainTip } from "@/lib/solanaServer";
import {
  classifyPollVote,
  stripVoteTagForSpeech,
  type CreatorPollState,
} from "@/lib/polls";

export { classifyPollVote, stripVoteTagForSpeech, type CreatorPollState };

const globalForPg = globalThis as unknown as {
  __solstreamPgPool?: Pool;
};

function resolveSslConfig(connStr: string): false | { rejectUnauthorized: true; ca?: string } {
  const isLocalHost =
    /\/\/[^/]*@(localhost|127\.0\.0\.1)(:|\/|$)/i.test(connStr) ||
    connStr.includes("@localhost") ||
    connStr.includes("@127.0.0.1");

  if (isLocalHost && !/sslmode=require/i.test(connStr)) {
    return false;
  }

  const inlineCa = process.env.DATABASE_SSL_CA?.trim();
  if (inlineCa) {
    return {
      rejectUnauthorized: true,
      ca: inlineCa.replace(/\\n/g, "\n"),
    };
  }

  const certPath = process.env.PGSSLROOTCERT?.trim();
  if (certPath) {
    try {
      return {
        rejectUnauthorized: true,
        ca: fs.readFileSync(certPath, "utf8"),
      };
    } catch (err) {
      console.warn("Failed to read PGSSLROOTCERT:", err);
    }
  }

  return { rejectUnauthorized: true };
}

function getPool(): Pool | null {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return null;

  if (!globalForPg.__solstreamPgPool) {
    globalForPg.__solstreamPgPool = new Pool({
      connectionString: connStr,
      ssl: resolveSslConfig(connStr),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return globalForPg.__solstreamPgPool;
}

export async function ensureDbReady(): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    console.error("Database readiness check failed:", err);
    return false;
  }
}

export interface DbCreatorRow extends OnChainCreator {
  id: string;
}

export interface DbLeaderboardEntry {
  donorKey: string;
  displayName: string;
  totalLamports: number;
  count: number;
  latestSig: string;
  latestTimestamp: number;
}

export function normalizeAudioUrl(url?: string | null): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  return null;
}

export async function uploadAlertAudioToStorage(
  username: string,
  signature: string,
  audioBuffer: Buffer
): Promise<string | null> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      "Supabase Storage upload skipped: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Storing null audio_url."
    );
    return null;
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const safeUser = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const safeSig = signature.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    const objectPath = `${safeUser}/${safeSig}.mp3`;

    const { error } = await admin.storage
      .from("stream-alerts")
      .upload(objectPath, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (error) {
      console.warn("Supabase Storage upload failed:", error.message);
      return null;
    }

    const { data } = admin.storage
      .from("stream-alerts")
      .getPublicUrl(objectPath);

    return normalizeAudioUrl(data?.publicUrl);
  } catch (err) {
    console.warn("Supabase Storage upload error:", err);
    return null;
  }
}

export function isPostgresUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
  );
}

function mapCreatorRow(r: any): DbCreatorRow {
  return {
    id: r.id,
    pda: r.pda_address,
    authority: r.wallet_address,
    username: r.username,
    voiceId: r.voice_id,
    goalTitle: r.goal_title,
    goalTargetLamports: Number(r.goal_target_lamports) || 0,
    goalCurrentLamports: Number(r.goal_current_lamports) || 0,
    totalTips: Number(r.total_tips) || 0,
    totalVolume: Number(r.total_volume_lamports) || 0,
    bump: 255,
  };
}

function mapTipRow(r: any): OnChainTip {
  return {
    signature: r.signature,
    creator: r.creator_wallet || "",
    donor: r.donor_wallet,
    amountLamports: Number(r.amount_lamports) || 0,
    tier: Number(r.tier) || 0,
    displayName: r.display_name || "Anonymous",
    message: r.message || "",
    timestamp: new Date(r.created_at).getTime(),
    audioUrl: normalizeAudioUrl(r.audio_url),
  };
}

export async function upsertCreatorInDb(
  creator: OnChainCreator
): Promise<DbCreatorRow | null> {
  const pool = getPool();
  if (!pool) return null;

  const res = await pool.query(
    `
    INSERT INTO public.creators (
      username, wallet_address, pda_address, voice_id, goal_title,
      goal_target_lamports, goal_current_lamports, total_tips, total_volume_lamports, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
    ON CONFLICT (wallet_address) DO UPDATE SET
      username = EXCLUDED.username,
      pda_address = EXCLUDED.pda_address,
      voice_id = EXCLUDED.voice_id,
      goal_title = EXCLUDED.goal_title,
      goal_target_lamports = EXCLUDED.goal_target_lamports,
      goal_current_lamports = GREATEST(public.creators.goal_current_lamports, EXCLUDED.goal_current_lamports),
      total_tips = GREATEST(public.creators.total_tips, EXCLUDED.total_tips),
      total_volume_lamports = GREATEST(public.creators.total_volume_lamports, EXCLUDED.total_volume_lamports),
      updated_at = now()
    RETURNING *
    `,
    [
      creator.username.toLowerCase(),
      creator.authority,
      creator.pda,
      creator.voiceId,
      creator.goalTitle,
      creator.goalTargetLamports,
      creator.goalCurrentLamports,
      creator.totalTips,
      creator.totalVolume,
    ]
  );

  return res.rows[0] ? mapCreatorRow(res.rows[0]) : null;
}

export async function syncCreatorExactStatsInDb(
  creator: OnChainCreator
): Promise<DbCreatorRow | null> {
  const pool = getPool();
  if (!pool) return null;

  const res = await pool.query(
    `
    INSERT INTO public.creators (
      username, wallet_address, pda_address, voice_id, goal_title,
      goal_target_lamports, goal_current_lamports, total_tips, total_volume_lamports, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
    ON CONFLICT (wallet_address) DO UPDATE SET
      username = EXCLUDED.username,
      pda_address = EXCLUDED.pda_address,
      voice_id = EXCLUDED.voice_id,
      goal_title = EXCLUDED.goal_title,
      goal_target_lamports = EXCLUDED.goal_target_lamports,
      goal_current_lamports = EXCLUDED.goal_current_lamports,
      total_tips = EXCLUDED.total_tips,
      total_volume_lamports = EXCLUDED.total_volume_lamports,
      updated_at = now()
    RETURNING *
    `,
    [
      creator.username.toLowerCase(),
      creator.authority,
      creator.pda,
      creator.voiceId,
      creator.goalTitle,
      creator.goalTargetLamports,
      creator.goalCurrentLamports,
      creator.totalTips,
      creator.totalVolume,
    ]
  );

  return res.rows[0] ? mapCreatorRow(res.rows[0]) : null;
}

export async function getCreatorsFromDb(): Promise<DbCreatorRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const res = await pool.query(
    `SELECT * FROM public.creators ORDER BY created_at DESC`
  );
  return res.rows.map(mapCreatorRow);
}

export async function getCreatorFromDb(
  username: string
): Promise<DbCreatorRow | null> {
  const pool = getPool();
  if (!pool) return null;
  const res = await pool.query(
    `SELECT * FROM public.creators WHERE username = $1 LIMIT 1`,
    [username.toLowerCase()]
  );
  return res.rows[0] ? mapCreatorRow(res.rows[0]) : null;
}

export async function getTipsFromDb(username: string): Promise<OnChainTip[]> {
  const pool = getPool();
  if (!pool) return [];
  const res = await pool.query(
    `
    SELECT t.*, c.wallet_address AS creator_wallet
    FROM public.tips t
    JOIN public.creators c ON c.id = t.creator_id
    WHERE t.username = $1
    ORDER BY t.created_at DESC
    LIMIT 50
    `,
    [username.toLowerCase()]
  );
  return res.rows.map(mapTipRow);
}

export async function getTopDonorsFromDb(
  creatorId: string
): Promise<DbLeaderboardEntry[]> {
  const pool = getPool();
  if (!pool || !creatorId) return [];

  const res = await pool.query(
    `
    SELECT
      COALESCE(NULLIF(donor_wallet, ''), NULLIF(display_name, ''), signature) AS donor_key,
      COALESCE(
        NULLIF(
          (ARRAY_AGG(display_name ORDER BY created_at DESC)
            FILTER (WHERE display_name IS NOT NULL AND display_name <> '' AND display_name <> 'Anonymous')
          )[1],
          ''
        ),
        'Anonymous'
      ) AS display_name,
      SUM(amount_lamports)::bigint AS total_lamports,
      COUNT(*)::int AS tip_count,
      (ARRAY_AGG(signature ORDER BY created_at DESC))[1] AS latest_sig,
      MAX(EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS latest_timestamp
    FROM public.tips
    WHERE creator_id = $1
    GROUP BY COALESCE(NULLIF(donor_wallet, ''), NULLIF(display_name, ''), signature)
    ORDER BY total_lamports DESC, latest_timestamp DESC
    LIMIT 10
    `,
    [creatorId]
  );

  return res.rows.map((r: any) => ({
    donorKey: String(r.donor_key),
    displayName: String(r.display_name || "Anonymous"),
    totalLamports: Number(r.total_lamports) || 0,
    count: Number(r.tip_count) || 0,
    latestSig: String(r.latest_sig || ""),
    latestTimestamp: Number(r.latest_timestamp) || 0,
  }));
}

export async function hasTipSignatureInDb(
  signature: string
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const res = await pool.query(
    `SELECT 1 FROM public.tips WHERE signature = $1 LIMIT 1`,
    [signature]
  );
  return res.rows.length > 0;
}

export async function getExistingTipSignaturesInDb(
  signatures: string[]
): Promise<Set<string>> {
  const pool = getPool();
  if (!pool || signatures.length === 0) return new Set();
  const res = await pool.query(
    `SELECT signature FROM public.tips WHERE signature = ANY($1::text[])`,
    [signatures]
  );
  return new Set(res.rows.map((r: any) => String(r.signature)));
}

export async function insertTipInDb(
  creatorId: string,
  username: string,
  tip: OnChainTip,
  ttsEngine: string | null = null
): Promise<{ inserted: boolean; row: OnChainTip | null }> {
  const pool = getPool();
  if (!pool) return { inserted: false, row: null };

  const createdAt = new Date(tip.timestamp || Date.now());
  const res = await pool.query(
    `
    INSERT INTO public.tips (
      signature, creator_id, username, donor_wallet, display_name,
      amount_lamports, tier, message, audio_url, tts_engine, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (signature) DO NOTHING
    RETURNING *
    `,
    [
      tip.signature,
      creatorId,
      username.toLowerCase(),
      tip.donor,
      tip.displayName || "Anonymous",
      tip.amountLamports,
      tip.tier,
      tip.message || "",
      normalizeAudioUrl(tip.audioUrl),
      ttsEngine,
      createdAt,
    ]
  );

  const inserted = res.rows.length > 0;
  if (inserted) {
    // Update creator aggregate counters in DB
    await pool.query(
      `
      UPDATE public.creators
      SET
        goal_current_lamports = goal_current_lamports + $1,
        total_tips = total_tips + 1,
        total_volume_lamports = total_volume_lamports + $1,
        updated_at = now()
      WHERE id = $2
      `,
      [tip.amountLamports, creatorId]
    );
  }

  return {
    inserted,
    row: res.rows[0] ? { ...tip } : null,
  };
}

export async function getPollWithResultsFromDb(
  username: string
): Promise<CreatorPollState | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const clean = username.trim().toLowerCase();
    const pollRes = await pool.query(
      `SELECT * FROM public.creator_polls WHERE username = $1 LIMIT 1`,
      [clean]
    );
    const row = pollRes.rows[0];
    if (!row) return null;

    const tipsRes = await pool.query(
      `
      SELECT message, amount_lamports
      FROM public.tips
      WHERE username = $1 AND created_at >= $2
      ORDER BY created_at DESC
      LIMIT 500
      `,
      [clean, row.started_at]
    );

    let votesA = 0;
    let votesB = 0;
    let lamportsA = 0;
    let lamportsB = 0;
    const minLamports = Number(row.min_vote_lamports) || 1_000_000;

    for (const t of tipsRes.rows) {
      const amt = Number(t.amount_lamports) || 0;
      if (amt < minLamports) continue;
      const choice = classifyPollVote(t.message);
      if (choice === "A") {
        votesA += 1;
        lamportsA += amt;
      } else if (choice === "B") {
        votesB += 1;
        lamportsB += amt;
      }
    }

    return {
      username: String(row.username),
      question: String(row.question),
      optionA: String(row.option_a),
      optionB: String(row.option_b),
      minVoteLamports: minLamports,
      isActive: Boolean(row.is_active),
      startedAt: new Date(row.started_at).getTime(),
      votesA,
      votesB,
      lamportsA,
      lamportsB,
    };
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "42P01"
    ) {
      return null;
    }
    throw err;
  }
}

export async function upsertCreatorPollInDb(params: {
  creatorId: string;
  username: string;
  question: string;
  optionA: string;
  optionB: string;
  minVoteLamports: number;
  isActive: boolean;
  resetCounts?: boolean;
}): Promise<CreatorPollState | null> {
  const pool = getPool();
  if (!pool) return null;

  const clean = params.username.trim().toLowerCase();
  const shouldReset = params.resetCounts !== false;

  await pool.query(
    `
    INSERT INTO public.creator_polls (
      creator_id, username, question, option_a, option_b,
      min_vote_lamports, is_active, started_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
    ON CONFLICT (username) DO UPDATE SET
      creator_id = EXCLUDED.creator_id,
      question = EXCLUDED.question,
      option_a = EXCLUDED.option_a,
      option_b = EXCLUDED.option_b,
      min_vote_lamports = EXCLUDED.min_vote_lamports,
      is_active = EXCLUDED.is_active,
      started_at = CASE WHEN $8 THEN now() ELSE public.creator_polls.started_at END,
      updated_at = now()
    `,
    [
      params.creatorId,
      clean,
      params.question,
      params.optionA,
      params.optionB,
      params.minVoteLamports,
      params.isActive,
      shouldReset,
    ]
  );

  return getPollWithResultsFromDb(clean);
}
