import { Pool } from "pg";
import type { OnChainCreator, OnChainTip } from "@/lib/solanaServer";

const globalForPg = globalThis as unknown as {
  __solstreamPgPool?: Pool;
};

function getPool(): Pool | null {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return null;

  if (!globalForPg.__solstreamPgPool) {
    globalForPg.__solstreamPgPool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return globalForPg.__solstreamPgPool;
}

export interface DbCreatorRow extends OnChainCreator {
  id: string;
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
    audioDataUrl: r.audio_url || null,
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
      tip.audioDataUrl || null,
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
