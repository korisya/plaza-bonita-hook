# Plaza Bonita Hook
This project allows you to deploy a Cloudflare Worker to send a Discord message every day when Round 1 Plaza Bonita opens. It reads the opening hour directly from the Round 1 website and schedules the message at the opening time.

## Setup
1. Install dependencies with `npm install`.


2. Set up your D1 database. Use the schema given in `schema.sql.example`, and set the number of days Plaza Bonita has been open plus 1.


3. Create your `wrangler.toml` file from `wrangler.toml.example`, and set `database_id` to your D1 database ID.


5. Deploy your worker with `npm run deploy`.


6. Create a new webhook in a Discord channel. From the webhook URL, extract the webhook ID and webhook token.


7. Set up environment variables (`WEBHOOK_ID`, `WEBHOOK_TOKEN`) accordingly.
