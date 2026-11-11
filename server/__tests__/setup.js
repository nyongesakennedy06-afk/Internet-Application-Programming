// Runs before every test file, before the app is imported (see "setupFiles" in package.json).
//
// 1. Tests use their own fake API key, so your real keys in .env are never needed or used.
//    (dotenv never overwrites a variable that is already set, so this wins over .env.)
// 2. The Pesa Tracker integration starts switched off, so tests never contact your partner's real server.
//    budget.test.js switches it on itself, pointed at a stand-in server.
import { TEST_API_KEY } from './testKey.js';

process.env.API_KEYS = `jest:${TEST_API_KEY}`;
process.env.PESA_TRACKER_URL = '';
process.env.RATE_LIMIT_MAX = '1000'; // from Week 9: a low demo limit in .env must not break the tests
process.env.PESA_RETRY_DELAY_MS = '1'; // keep failure tests fast: tiny waits between retries

// The "retrying in ..." log lines are expected when tests make Pesa Tracker fail on purpose. Hide just those.
const realWarn = console.warn;
console.warn = (...args) => { if (!String(args[0]).includes('retrying in')) realWarn(...args); };