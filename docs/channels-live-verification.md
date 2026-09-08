# Live verification for Telegram and Slack

Two things need proving, and only one of them can be automated.

`lib/channels/live.test.ts` proves that the calls Arkitech makes are the calls Telegram and Slack actually accept today: the token is valid, `setWebhook` takes a `secret_token` and reports it back, a message is delivered, and a refusal does not carry the token into the error. It runs from the **Channels Live Verification** workflow, by hand, or locally.

What it cannot prove is a real inbound message arriving at a running Arkitech. That needs a deployment with a public HTTPS address for the provider to call, so it is the checklist at the bottom of this page.

## Running the automated part

In GitHub: Actions, **Channels Live Verification**, Run workflow, choose `telegram`, `slack` or `both`.

Repository secrets it reads:

| Secret | What it is | Needed for |
| --- | --- | --- |
| `TELEGRAM_TEST_BOT_TOKEN` | A disposable bot from @BotFather | Telegram |
| `TELEGRAM_TEST_CHAT_ID` | A chat that bot has been messaged from | Telegram delivery |
| `SLACK_TEST_BOT_TOKEN` | Bot token from a test workspace install | Slack |
| `SLACK_TEST_CHANNEL` | A channel that bot is in | Slack delivery |

Use a bot and a workspace you are willing to throw away. The run registers a webhook on the test bot pointing at a host that does not exist, then deletes it again, and the workflow deletes it once more on the way out in case the run died early. Do not point it at a bot serving real customers: a bot has exactly one webhook, and registering this one would take that bot off Arkitech until it was reconnected.

Locally:

```
set -a && . ./.env.local && set +a
LIVE_TELEGRAM=1 npx vitest run lib/channels/live.test.ts
LIVE_SLACK=1 npx vitest run lib/channels/live.test.ts
```

Without those variables the file skips, so it never runs in the ordinary suite.

## The manual part

Run this against a deployed Arkitech once per release that touches channels. It is the only thing that proves the whole path: a person types in Telegram or Slack, and their Team member answers.

Before starting, confirm the deployment has `CHANNEL_SECRET_KEY` set, and for Slack also `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`. `NEXT_PUBLIC_APP_URL` must be the public `https://` address; Telegram will not deliver to anything else, and Arkitech refuses to try.

### Telegram

1. Sign in as a test customer with at least one Team member and some Usage Credits.
2. Settings, Connections, Telegram, Connect. Paste a disposable bot token, choose a Team member, connect.
3. The screen should say **Almost there** and offer a link. Open it. Telegram should open a chat with the bot showing a Start button.
4. Press Start. The bot should reply that you are connected, and the Connections screen should read **Connected** with the bot's `@name` after a refresh.
5. Send an ordinary message. A reply should arrive from the Team member.
6. Check Arkitech: the usage dashboard shows one Run against that Team member, and one Usage Credit spent. Not two.
7. Open the Team member's chat in Arkitech. The exchange from Telegram should be there.
8. Send another message from Arkitech's own chat, then return to Telegram. The Team member should still be working from the same conversation.
9. From a **second** Telegram account, message the same bot. It must refuse and reach nothing. This is the one that matters most: a bot's username is public.
10. Disconnect. Message the bot again from the linked account. It must not answer.

### Slack

1. Settings, Connections, Slack, Connect. Choose a Team member and continue to Slack.
2. Approve the install in a test workspace. You should land back on Connections reading **Connected** with the workspace name.
3. Direct-message the Arkitech app in Slack. A reply should arrive from the Team member.
4. Check the usage dashboard again: one Run, one Usage Credit.
5. Have a **colleague in the same workspace** direct-message the app. It must not answer them, and nothing of yours may appear.
6. Disconnect, then message the app again. It must not answer.

### Both

7. Confirm an Agent can still use Slack as a tool through Composio, if that Agent has it connected. The two capabilities are separate and both must work.
8. Ask for something that needs approval or a browser. The approval must still be required. A channel is not a way around it.

Record the date, the release, and anything that failed. A step that could not be completed is a failure, not a skip.
