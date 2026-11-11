# MONITORING_NOTES (Week 12)

## Part A: predictions (written before looking at any data)

1. **Slowest endpoint: `POST /api/orders`.** It opens a database transaction, runs several queries
   (cafeteria, menu items, one INSERT per line item) and, for a linked user, makes two calls to Pesa
   Tracker (read the budget, record the purchase) before it commits. Every other route is one or two queries.
2. **Most errors: `GET /api/orders` (Team 10's endpoint).** It is the only route that is rejected before it
   runs (missing or wrong key: 401) and the one that can hit the rate limit (429). I expect mostly 4xx and
   very few 5xx.

## Part E: what the data shows

> Fill this in AFTER running the traffic script, using your own `/stats` output and log lines.
> Do not write numbers you did not measure.

**Traffic used:** (your own runs of `tools/traffic.js` with N=__, your ring partner's runs, anything else)

**1. Prediction vs. data**
- Slowest endpoint: predicted `POST /api/orders`. Actual slowest by `avgMs`: ______ (avgMs ___ ms, maxMs ___ ms).
- Most errors: predicted `GET /api/orders`. Actual: ______ (clientErrors ___, serverErrors ___).

**2. One real pattern, with figures**
(example shape: "GET /api/orders averaged ___ ms but its slowest call was ___ ms, and ___ of its ___ calls were 401s")

**3. Why I think it happens / what I would check next**
(a hypothesis is fine; "I don't know yet, so I would look at..." is a good answer)

**4. One alert I would want in production**
(pick one number from `/stats`, a threshold, and what should happen when it fires. Think of Week 11:
while a person fixes the cause, the wallet already shows the saved budget with a banner.)