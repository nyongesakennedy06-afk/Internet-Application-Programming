# CONTRACT_QUESTIONS

## Questions on Team 8's (Pesa Tracker) openapi.yaml BY Team 9 (Strathbites) 

1. Every endpoint requires a Pesa Tracker `userId` (e.g. `usr_7f2a9c1e`), described as
   "not the student's university ID." No endpoint in this contract issues or looks up that
   ID for a given Strathbites user. How is this identifier meant to be obtained — a separate
   auth/sync endpoint, or should Strathbites store it at signup time?

2. Both `PATCH /users/{id}/budget` (action: deduct) and `POST /users/{id}/transactions`
   reduce a user's remaining balance. Which one should Strathbites call after a completed
   order, and what's the intended use case for the other?

3. `POST /transactions` can return a 422 if the amount exceeds the remaining budget. Since
   the corresponding Strathbites order likely already exists by the time this call happens,
   what's the expected behavior on our side if this occurs — rollback, flag, or allow the
   order to proceed regardless?
