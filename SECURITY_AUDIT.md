## Rate limiting

**Limit:** 100 requests per minute per team, on the two Team 10 endpoints. The count is shared
across both endpoints, and each team has its own allowance.

**Why 100:** Team 10 calls us when a person uses their app (lost-item matching and a first-time-user
check), so normal use stays far below it. A buggy loop would reach 100 within seconds and be stopped
with a 429, instead of slowing down every student's checkout.

**Why only these routes:** they are the only ones open to other teams (API key). Student routes use
login tokens, and limiting them would count our own frontend against the limit.

**Order:** the limiter runs after the key check, so requests with a missing or wrong key get 401 and
use none of anyone's allowance.

**Evidence:** `200 200 200 429 429` with the limit lowered to 3 (screenshot), plus the 429 response
with its Retry-After header. Automated tests are in `__tests__/ratelimit.test.js`.

**Honest limits:** counts are kept in the server's memory, so they reset when the server restarts and
are not shared between several server copies. A shared store such as Redis would fix both.