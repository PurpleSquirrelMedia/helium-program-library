use crate::{canopy::check_canopy_bytes, id, state::*};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct InitializeLazyTransactionsArgsV0 {
  pub root: [u8; 32],
  pub name: String,
  pub authority: Pubkey,
  pub max_depth: u32,
}

#[derive(Accounts)]
#[instruction(args: InitializeLazyTransactionsArgsV0)]
pub struct InitializeLazyTransactionsV0<'info> {
  #[account(mut)]
  pub payer: Signer<'info>,
  #[account(
    init,
    payer = payer,
    space = 60 + std::mem::size_of::<LazyTransactionsV0>(),
    seeds = ["lazy_transactions".as_bytes(), args.name.as_bytes()],
    bump,
  )]
  pub lazy_transactions: Box<Account<'info, LazyTransactionsV0>>,
  /// CHECK: Account to store the canopy, the size will determine the size of the canopy
  #[account(
    mut,
    owner = id(),
    constraint = canopy.data.borrow()[0] == 0,
    constraint = check_canopy_bytes(&canopy.data.borrow()[1..]).is_ok(),
  )]
  pub canopy: AccountInfo<'info>,
  pub system_program: Program<'info, System>,
}

pub fn handler(
  ctx: Context<InitializeLazyTransactionsV0>,
  args: InitializeLazyTransactionsArgsV0,
) -> Result<()> {
  let mut data = ctx.accounts.canopy.try_borrow_mut_data()?;
  data[0] = 1;

  ctx
    .accounts
    .lazy_transactions
    .set_inner(LazyTransactionsV0 {
      root: args.root,
      name: args.name,
      authority: args.authority,
      canopy: ctx.accounts.canopy.key(),
      max_depth: args.max_depth,
      bump_seed: ctx.bumps["lazy_transactions"],
    });

  Ok(())
}
