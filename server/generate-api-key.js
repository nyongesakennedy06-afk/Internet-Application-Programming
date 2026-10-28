/**
 * CLI utility – generates a random API key for a named consumer.
 *
 * Usage:
 *   node generate-api-key.js team10
 *
 * Output (copy the whole line into API_KEYS in your .env):
 *   team10:a1b2c3d4e5...
 *
 * If API_KEYS already has values, append with a comma:
 *   API_KEYS=team10:abc...,devtest:def...
 */

import crypto from 'node:crypto';

const name = process.argv[2];

if (!name) {
    console.error('Usage: node generate-api-key.js <consumer-name>');
    console.error('Example: node generate-api-key.js team10');
    process.exit(1);
}

const key = crypto.randomBytes(24).toString('hex'); // 48 hex characters
console.log(`\n  ${name}:${key}\n`);
console.log('Copy the line above into the API_KEYS variable in your .env file.');
console.log('If API_KEYS already has values, separate entries with commas (no spaces).\n');
