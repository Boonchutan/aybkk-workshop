# Can a Claude MCP replace ManyChat? (research 19 Oct 2026)

Boonchu: "I saw ChatGPT has MCP which replace Manychat. Deep research for Claude mcp which works same or better than Manychat."
Method: 6 researchers (one angle each), 6 skeptics re-checking the key claims, 1 completeness critic. 13 agents, primary sources where possible.

## Verdict
No. No MCP (ChatGPT or Claude) does ManyChat's job by itself. An MCP is a remote control that an AI uses while you chat. It does not sit awake waiting for comments. Every "MCP replaces ManyChat" product (Blotato, InstantDM, Inro, SetSmart, ChatPlace, Zernio) is a Meta-approved vendor whose own server receives the comment and sends the fixed DM 24/7, the same as ManyChat. The AI only sets rules or drafts. Claude can plug into those vendor MCPs the same way ChatGPT can (claude.ai custom connectors work on Max).
Likely source of the claim: vendor marketing such as Sabrina Ramonov / Blotato "Automate DMs with Claude & ChatGPT" (26 Aug 2026; she founded Blotato). Also OpenAI "MCP Events" in ChatGPT (draft spec, needs your own always-on server, no Instagram source). Not confirmed which one he saw.

## Facts that matter (checked)
- ManyChat has no official MCP and no Claude connector (19 Oct). Community ManyChat MCPs can fire existing flows and tag contacts, but cannot create or edit flows.
- Meta's only official MCP is "Meta Ads AI Connectors" (ads only, open beta since 29 Apr 2026). Nothing for DMs or comments.
- Why /meta/webhook has never received an Instagram or Facebook message: Meta sends comment webhooks from the public only to an app that is Live, has Advanced Access (App Review) and Business Verification, plus the /subscribed_apps call and the "Allow access to messages" toggle in Instagram. Standard Access only covers people with a role on the app.
- Private replies: one DM per comment, within 7 days. More only if the person replies, inside 24 hours. API is free. Rate limits irrelevant at our volume (750 private replies an hour).
- No WhatsApp-style AI-bot ban on Instagram or Messenger (Developer Policies, 3 Feb 2026). Disclose a bot where the law requires it.
- ManyChat Free plan (help page 15 Oct 2026): 25 active contacts a month, 4 live automations, ManyChat branding; all Free accounts were moved to it. Commenters count as contacts (Active Contacts page 18 Oct). Past the cap, new commenters may get nothing. Essential: USD 17/mo or 14/mo yearly, 250 contacts. Pro: USD 39 or 29 yearly.
- A commenter is reachable later (24-hour window, API) only after tapping a quick reply or button in the first DM. An "open website" button does not count.
- Claude Max includes monthly API credit: USD 100 (Max 5x) or 200 (Max 20x), for ONE linked Console organization; covers the Messages API (our inbox sorter); expires each month (support.claude.com article 17154008, checked 19 Oct).
- Claude routines can be started by an HTTP call (/fire, research preview, 30 runs an hour per routine). Meta cannot call it directly; our server would pass messages on.

## Do not
- Password or cookie login Instagram MCPs (e.g. trypeggy, osAlhaddad1, Stupidoodle use instagrapi): break Instagram's Terms; documented account suspensions. A ban kills the daily Reels engine.
- ManyChat AI Replies / AI Comments and Meta Business Agent: they send AI-written messages by themselves (breaks the drafts-only rule; risk of a price or a wrong promise in a DM).
- Two tools on the same keyword or post (one private reply per comment).
- SetSmart (USD 99) or Blotato (USD 29+): paying again for what ManyChat already does.

## Options found (comment-to-DM, cost, MCP)
- ManyChat (now): works if the plan covers our contacts. No MCP.
- InstantDM Free: USD 0, 500 DM automations a month, 3 trigger words, Instagram only, no MCP (MCP from USD 24.99/mo yearly).
- Zernio: 2 accounts free, API + webhooks, hosted MCP; comment automations on free tier probable, not confirmed.
- Inro: Free (100 contacts, 3 automations); MCP needs Pro (EUR 12.99/mo).
- SendPulse: free chatbot plan; MCP free but not shown to build comment rules.
- CreatorFlow: Free 500 DMs/mo; no MCP.
- Meta Business Suite "Comment to Message": free, but may fire only on #hashtags and be unreliable on Reels. Test with a second account before trusting it.
- Zapier: cannot do Instagram comment-to-DM. Make: watches comments, no private-reply module. n8n: can do it, needs our own Meta app (same App Review). Pipedream Workflows shuts down 31 Mar 2027.
- Our own server (inbox.js): receiver code exists; sending the fixed guide reply is about 1-2 days of code; Meta setup about 4-8 hours of hands-on plus 1-6 weeks of waiting.

## Still unknown
- Which ManyChat plan @aybkk is on and its Active Contacts a month (only in the account).
- Whether Meta's Comment to Message fires on plain "MYSORE" or only "#MYSORE".
- Keyword matching for Thai, Chinese, Russian commenters (not checked by anyone).
- Whether Business Verification or App Review was ever started.
- Where vendor MCP tools store DM content (PDPA).

## Main sources
- MCP tools are model-controlled: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Instagram webhooks setup (Live, Advanced Access, Business Verification): https://developers.facebook.com/documentation/instagram-platform/webhooks/setup.md
- Private replies: https://developers.facebook.com/docs/instagram-platform/private-replies
- Meta Ads AI Connectors: https://www.facebook.com/business/news/meta-ads-ai-connectors
- ManyChat MCP requests (no staff reply): https://community.manychat.com/ideas/we-need-mcps-10925
- ManyChat Free plan: https://help.manychat.com/hc/en-us/articles/25800197498652-Free-plan
- ManyChat Active Contacts: https://help.manychat.com/hc/en-us/articles/25800323349020-Active-Contacts
- Max API credit: https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
- Claude routines /fire: https://platform.claude.com/docs/en/api/claude-code/routines-fire
- OpenAI MCP Events: https://developers.openai.com/plugins/build/mcp-events.md
- Vendor example: https://www.sabrina.dev/p/facebook-instagram-dm-automation-with-claude-chatgpt-blotato
- InstantDM pricing: https://instantdm.com/pricing · Zernio: https://zernio.com/pricing · Inro: https://www.inro.social/pricing
- Meta Business Suite Comment to Message limits (vendor, 29 Sep 2026): https://rapiddm.com/blog/meta-business-suite-comment-to-message-limits-2026
