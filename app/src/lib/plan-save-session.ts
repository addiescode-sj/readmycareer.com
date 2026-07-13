export const PLAN_SAVE_STATUS_KEY = "rmc_plan_saved";
export const PLAN_SAVE_BLOCKED_KEY = "rmc_plan_save_blocked";
export const PLAN_SAVE_INFLIGHT_KEY = "rmc_plan_save_inflight";
export const PLAN_LIMIT_REACHED = "plan_limit_reached";
const INFLIGHT_LOCK_TTL_MS = 60_000;

function storage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

export function isPlanSaved() {
  return storage()?.getItem(PLAN_SAVE_STATUS_KEY) === "true";
}

export function isPlanSaveBlockedByLimit() {
  return storage()?.getItem(PLAN_SAVE_BLOCKED_KEY) === PLAN_LIMIT_REACHED;
}

export function beginPlanSave() {
  const store = storage();
  if (!store) return false;
  const inflightStartedAt = Number(store.getItem(PLAN_SAVE_INFLIGHT_KEY));
  const hasFreshInflightLock =
    Number.isFinite(inflightStartedAt) &&
    Date.now() - inflightStartedAt < INFLIGHT_LOCK_TTL_MS;

  if (
    store.getItem(PLAN_SAVE_STATUS_KEY) === "true" ||
    store.getItem(PLAN_SAVE_BLOCKED_KEY) === PLAN_LIMIT_REACHED ||
    hasFreshInflightLock
  ) {
    return false;
  }
  store.setItem(PLAN_SAVE_INFLIGHT_KEY, String(Date.now()));
  return true;
}

export function finishPlanSave() {
  storage()?.removeItem(PLAN_SAVE_INFLIGHT_KEY);
}

export function markPlanSaveSucceeded() {
  const store = storage();
  store?.setItem(PLAN_SAVE_STATUS_KEY, "true");
  store?.removeItem(PLAN_SAVE_BLOCKED_KEY);
  store?.removeItem(PLAN_SAVE_INFLIGHT_KEY);
}

export function markPlanSaveLimitReached() {
  const store = storage();
  store?.setItem(PLAN_SAVE_BLOCKED_KEY, PLAN_LIMIT_REACHED);
  store?.removeItem(PLAN_SAVE_INFLIGHT_KEY);
}

/**
 * Clears only the limit-blocked flag, leaving PLAN_SAVE_STATUS_KEY untouched. Call this after
 * the user frees up a plan slot (deletes an existing plan) so a retry in the same session can
 * save the pending plan — unlike clearPlanSaveState(), it doesn't also discard PLAN_SAVE_STATUS_KEY.
 */
export function clearPlanSaveLimitBlock() {
  storage()?.removeItem(PLAN_SAVE_BLOCKED_KEY);
}

export function clearPlanSaveState() {
  const store = storage();
  store?.removeItem(PLAN_SAVE_STATUS_KEY);
  store?.removeItem(PLAN_SAVE_BLOCKED_KEY);
  store?.removeItem(PLAN_SAVE_INFLIGHT_KEY);
}
