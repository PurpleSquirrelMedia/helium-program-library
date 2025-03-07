use crate::state::*;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateSubDaoArgsV0 {
  pub authority: Option<Pubkey>,
  pub emission_schedule: Option<Vec<EmissionScheduleItem>>,
  pub onboarding_dc_fee: Option<u64>,
  pub dc_burn_authority: Option<Pubkey>,
  pub active_device_aggregator: Option<Pubkey>,
}

#[derive(Accounts)]
#[instruction(args: UpdateSubDaoArgsV0)]
pub struct UpdateSubDaoV0<'info> {
  #[account(
    mut,
    seeds = ["sub_dao".as_bytes(), sub_dao.dnt_mint.key().as_ref()],
    bump = sub_dao.bump_seed,
    has_one = authority,
  )]
  pub sub_dao: Box<Account<'info, SubDaoV0>>,
  pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateSubDaoV0>, args: UpdateSubDaoArgsV0) -> Result<()> {
  if let Some(new_authority) = args.authority {
    ctx.accounts.sub_dao.authority = new_authority;
  }

  if let Some(emission_schedule) = args.emission_schedule {
    ctx.accounts.sub_dao.emission_schedule = emission_schedule;
  }

  if let Some(onboarding_dc_fee) = args.onboarding_dc_fee {
    ctx.accounts.sub_dao.onboarding_dc_fee = onboarding_dc_fee;
  }

  if let Some(dc_burn_authority) = args.dc_burn_authority {
    ctx.accounts.sub_dao.dc_burn_authority = dc_burn_authority;
  }

  if let Some(active_device_aggregator) = args.active_device_aggregator {
    ctx.accounts.sub_dao.active_device_aggregator = active_device_aggregator;
  }

  Ok(())
}
