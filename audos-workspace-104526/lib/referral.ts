/**
 * Where "Build on Audos" sends users, and whether the owner's referral link is
 * attached.
 *
 * Referral links are currently OFF: users go straight to Audos.com with no
 * extra parameters, and the owner shares users' contacts with the Audos team
 * by hand. Clicks are still logged to the `audos_referrals` table.
 *
 * To switch referral links back on, set `enabled` to true. The saved link,
 * referral ID and source tag from the Audos Referral settings app are then
 * applied again (and if no valid link is saved, users still reach Audos.com).
 */
export const REFERRAL_SETTINGS = {
  enabled: false,
  defaultUrl: 'https://audos.com/camps/africa/apply',
};
