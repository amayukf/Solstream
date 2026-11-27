use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

// Solana Playground generated Program ID:
declare_id!("BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA");

// Limits are in BYTES (Rust String::len). Amharic/Ethiopic characters are 3 bytes
// each in UTF-8, so the byte limits are larger than the UI's character limits.
pub const MAX_USERNAME: usize = 32;
pub const MAX_VOICE_ID: usize = 20;
pub const MAX_GOAL_TITLE: usize = 64;
pub const MAX_DISPLAY_NAME_BYTES: usize = 96; // UI: 32 chars
pub const MAX_MESSAGE_BYTES: usize = 300; // UI: 100 chars
pub const MAX_TIER: u8 = 5; // 0..=5 -> Coffee..Crown
pub const MIN_TIP_LAMPORTS: u64 = 1_000_000; // 0.001 SOL, blocks dust/TTS spam
pub const RESERVED_USERNAMES: &[&str] = &[
    "claim",
    "dashboard",
    "overlay",
    "api",
    "actions",
    "_next",
    "login",
    "signup",
    "admin",
    "settings",
    "solstream",
];

#[program]
pub mod solstream {
    use super::*;

    pub fn initialize_creator(
        ctx: Context<InitializeCreator>,
        username: String,
        voice_id: String,
        goal_target: u64,
        goal_title: String,
    ) -> Result<()> {
        require!(
            !username.is_empty()
                && username.len() <= MAX_USERNAME
                && username
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
            SolStreamError::InvalidUsername
        );
        require!(
            !RESERVED_USERNAMES.contains(&username.as_str()),
            SolStreamError::ReservedUsername
        );
        require!(voice_id.len() <= MAX_VOICE_ID, SolStreamError::VoiceIdTooLong);
        require!(goal_title.len() <= MAX_GOAL_TITLE, SolStreamError::GoalTitleTooLong);

        let creator = &mut ctx.accounts.creator_account;
        creator.authority = ctx.accounts.authority.key();
        creator.username = username;
        creator.voice_id = voice_id;
        creator.goal_title = goal_title;
        creator.goal_target_lamports = goal_target;
        creator.goal_current_lamports = 0;
        creator.total_tips = 0;
        creator.total_volume = 0;
        creator.bump = ctx.bumps.creator_account;

        let registry = &mut ctx.accounts.handle_registry;
        registry.authority = ctx.accounts.authority.key();
        registry.bump = ctx.bumps.handle_registry;
        Ok(())
    }

    /// Backfills a HandleRegistry PDA for legacy CreatorAccount holders created before unique handle enforcement.
    pub fn register_existing_handle(ctx: Context<RegisterExistingHandle>) -> Result<()> {
        let creator = &ctx.accounts.creator_account;
        let registry = &mut ctx.accounts.handle_registry;
        registry.authority = creator.authority;
        registry.bump = ctx.bumps.handle_registry;
        Ok(())
    }

    pub fn send_tip(
        ctx: Context<SendTip>,
        amount: u64,
        tier: u8,
        display_name: String,
        message: String,
    ) -> Result<()> {
        require!(amount >= MIN_TIP_LAMPORTS, SolStreamError::TipTooSmall);
        require!(tier <= MAX_TIER, SolStreamError::InvalidTier);
        require!(display_name.len() <= MAX_DISPLAY_NAME_BYTES, SolStreamError::DisplayNameTooLong);
        require!(message.len() <= MAX_MESSAGE_BYTES, SolStreamError::MessageTooLong);

        // Move SOL directly from donor to the creator's wallet (no escrow).
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.donor.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        let creator = &mut ctx.accounts.creator_account;
        creator.goal_current_lamports = creator
            .goal_current_lamports
            .checked_add(amount)
            .ok_or(SolStreamError::MathOverflow)?;
        creator.total_tips = creator
            .total_tips
            .checked_add(1)
            .ok_or(SolStreamError::MathOverflow)?;
        creator.total_volume = creator
            .total_volume
            .checked_add(amount)
            .ok_or(SolStreamError::MathOverflow)?;

        emit!(TipEvent {
            creator: creator.authority,
            donor: ctx.accounts.donor.key(),
            amount,
            tier,
            display_name,
            message,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Sets a new goal and resets progress to zero.
    pub fn update_goal(
        ctx: Context<UpdateGoal>,
        new_target: u64,
        new_title: String,
    ) -> Result<()> {
        require!(new_title.len() <= MAX_GOAL_TITLE, SolStreamError::GoalTitleTooLong);
        let creator = &mut ctx.accounts.creator_account;
        creator.goal_target_lamports = new_target;
        creator.goal_title = new_title;
        creator.goal_current_lamports = 0;
        Ok(())
    }

    pub fn update_voice(ctx: Context<UpdateGoal>, new_voice_id: String) -> Result<()> {
        require!(new_voice_id.len() <= MAX_VOICE_ID, SolStreamError::VoiceIdTooLong);
        ctx.accounts.creator_account.voice_id = new_voice_id;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct CreatorAccount {
    pub authority: Pubkey,
    #[max_len(32)]
    pub username: String,
    #[max_len(20)]
    pub voice_id: String,
    #[max_len(64)]
    pub goal_title: String,
    pub goal_target_lamports: u64,
    pub goal_current_lamports: u64,
    pub total_tips: u64,
    pub total_volume: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct HandleRegistry {
    pub authority: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(username: String)]
pub struct InitializeCreator<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + CreatorAccount::INIT_SPACE,
        seeds = [b"creator", authority.key().as_ref()],
        bump
    )]
    pub creator_account: Account<'info, CreatorAccount>,
    #[account(
        init,
        payer = authority,
        space = 8 + HandleRegistry::INIT_SPACE,
        seeds = [b"handle", username.as_bytes()],
        bump
    )]
    pub handle_registry: Account<'info, HandleRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterExistingHandle<'info> {
    #[account(
        seeds = [b"creator", authority.key().as_ref()],
        bump = creator_account.bump,
        has_one = authority
    )]
    pub creator_account: Account<'info, CreatorAccount>,
    #[account(
        init,
        payer = authority,
        space = 8 + HandleRegistry::INIT_SPACE,
        seeds = [b"handle", creator_account.username.as_bytes()],
        bump
    )]
    pub handle_registry: Account<'info, HandleRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SendTip<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"creator", creator_account.authority.as_ref()],
        bump = creator_account.bump,
        has_one = authority @ SolStreamError::WrongRecipient
    )]
    pub creator_account: Account<'info, CreatorAccount>,
    /// CHECK: recipient wallet; constrained to creator_account.authority by has_one.
    #[account(mut)]
    pub authority: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGoal<'info> {
    #[account(
        mut,
        seeds = [b"creator", authority.key().as_ref()],
        bump = creator_account.bump,
        has_one = authority
    )]
    pub creator_account: Account<'info, CreatorAccount>,
    pub authority: Signer<'info>,
}

#[event]
pub struct TipEvent {
    pub creator: Pubkey,
    pub donor: Pubkey,
    pub amount: u64,
    pub tier: u8,
    pub display_name: String,
    pub message: String,
    pub timestamp: i64,
}

#[error_code]
pub enum SolStreamError {
    #[msg("Username must be 1-32 chars of a-z, 0-9 or _")]
    InvalidUsername,
    #[msg("Voice ID too long")]
    VoiceIdTooLong,
    #[msg("Goal title too long")]
    GoalTitleTooLong,
    #[msg("Display name too long")]
    DisplayNameTooLong,
    #[msg("Message too long")]
    MessageTooLong,
    #[msg("Tip is below the minimum amount")]
    TipTooSmall,
    #[msg("Invalid gift tier")]
    InvalidTier,
    #[msg("Recipient does not match the creator's wallet")]
    WrongRecipient,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("This handle name is reserved by the platform")]
    ReservedUsername,
}
