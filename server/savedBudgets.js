// The last remaining budget we read from Pesa Tracker for each user (Week 11 fallback).
// Kept in memory only, so it is empty again after a server restart. It is stored per user:
// one student must never be shown another student's budget.

const MAX_USERS = 5000; // a safety cap so the map cannot grow forever
const saved = new Map(); // userId -> { remaining, asOf }

export function saveBudget(userId, remaining) {
    saved.delete(userId); // re-insert so the oldest entries are first in line to go
    saved.set(userId, { remaining, asOf: new Date().toISOString() });
    if (saved.size > MAX_USERS) saved.delete(saved.keys().next().value);
}

export const getSavedBudget = (userId) => saved.get(userId) ?? null;

export const forgetBudget = (userId) => saved.delete(userId);

export const clearSavedBudgets = () => saved.clear();