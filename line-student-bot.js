/**
 * AYBKK LINE Student Bot
 * Handles: follow events, welcome messages, verification codes
 * Works with: Neo4j (stores LINE UIDs), Claim page (links accounts)
 */

const express = require('express');
const neo4j = require('neo4j-driver');
const crypto = require('crypto');

// Config from env
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'poinefth水下123';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_WEBHOOK_VERIFY_TOKEN = process.env.LINE_WEBHOOK_VERIFY_TOKEN || 'aybkk-line-verify-token';

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// In-memory store for pending verification codes - DEPRECATED
// Now using Neo4j for cross-server code storage
const pendingCodes = new Map();
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Generate 4-digit code
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Store verification code in Neo4j (so claim API can access it)
async function storeVerificationCode(lineUid, code) {
  const session = driver.session();
  try {
    await session.run(
      `MATCH (la:LineAccount {uid: $uid})
       SET la.pendingCode = $code, 
           la.codeExpires = datetime() + duration('PT10M')`,
      { uid: lineUid, code }
    );
  } finally {
    await session.close();
  }
}

// Send push message to LINE user
async function linePush(userId, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('[LINE Bot] No access token configured');
    return false;
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: userId,
      messages: Array.isArray(messages) ? messages : [messages]
    })
  });

  if (!response.ok) {
    console.error('[LINE Bot] Push failed:', response.status);
    return false;
  }
  return true;
}

// Get user profile from LINE
async function getLineProfile(userId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return null;
  
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    console.error('[LINE Bot] Get profile failed:', err.message);
  }
  return null;
}

// Check if LINE user is already linked to a student
async function isLinkedToStudent(lineUid) {
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (s:Student)-[:HAS_LINE]->(:LineAccount {uid: $uid}) RETURN s.name as name LIMIT 1',
      { uid: lineUid }
    );
    return result.records.length > 0 ? result.records[0].get('name') : null;
  } finally {
    await session.close();
  }
}

// Handle: student added the LINE bot (follow event)
async function handleFollow(lineUid) {
  console.log('[LINE Bot] New follower:', lineUid);
  
  // Check if already linked
  const linkedName = await isLinkedToStudent(lineUid);
  
  if (linkedName) {
    // Already linked - welcome back
    await linePush(lineUid, {
      type: 'text',
      text: `Welcome back, ${linkedName}! 🙏\n\nYour LINE is already connected to your AYBKK profile.\n\nAny questions? Just ask!`
    });
    return;
  }

  // New user - generate verification code
  const code = generateCode();
  
  // Store LineAccount (unlinked state) with pending code
  const session = driver.session();
  try {
    await session.run(
      `MERGE (la:LineAccount {uid: $uid})
       ON CREATE SET la.createdAt = datetime(), la.followedBot = true, la.linked = false
       ON MATCH SET la.followedBot = true, la.unlinkedAt = null
       SET la.pendingCode = $code, la.codeExpires = datetime() + duration('PT10M')`,
      { uid: lineUid, code }
    );
  } finally {
    await session.close();
  }

  // Send welcome message with code
  await linePush(lineUid, {
    type: 'text',
    text: `Welcome to AYBKK! 🎉\n\nTo connect your LINE to your student profile:\n\n1️⃣ Go to: aybkk.com/claim\n2️⃣ Enter code: *${code}*\n3️⃣ Enter your name\n\n⚠️ Code expires in 10 minutes`
  });
}

// Handle: student removed the LINE bot (unfollow)
async function handleUnfollow(lineUid) {
  console.log('[LINE Bot] Unfollowed:', lineUid);
  const session = driver.session();
  try {
    await session.run(
      'MATCH (la:LineAccount {uid: $uid}) SET la.unfollowedAt = datetime()',
      { uid: lineUid }
    );
  } finally {
    await session.close();
  }
}

// Handle: student sends text message
async function handleMessage(lineUid, text) {
  const lowerText = text.trim().toLowerCase();
  
  // Simple commands
  if (lowerText === 'hi' || lowerText === 'hello' || lowerText === 'สวัสดี' || lowerText === '你好') {
    const linkedName = await isLinkedToStudent(lineUid);
    if (linkedName) {
      await linePush(lineUid, {
        type: 'text',
        text: `Hi ${linkedName}! 👋\n\nHow can I help you today?\n\n• Type "help" for commands\n• Type "progress" to see your practice stats`
      });
    } else {
      await linePush(lineUid, {
        type: 'text',
        text: `Hi there! 👋\n\nWelcome to AYBKK LINE bot.\n\nTo get started, visit aybkk.com/claim to link your student account.`
      });
    }
    return;
  }

  if (lowerText === 'help') {
    const linkedName = await isLinkedToStudent(lineUid);
    if (linkedName) {
      await linePush(lineUid, {
        type: 'text',
        text: `Available commands:\n\n📊 "progress" - View your practice progress\n📅 "check-in" - Check in for today's class\n❓ "help" - Show this message`
      });
    } else {
      await linePush(lineUid, {
        type: 'text',
        text: `Visit aybkk.com/claim first to link your account.`
      });
    }
    return;
  }

  if (lowerText === 'progress') {
    // TODO: Fetch from Neo4j
    await linePush(lineUid, {
      type: 'text',
      text: `📊 Your Progress\n\nCheck back soon - this feature is coming!`
    });
    return;
  }

  // Unknown message
  await linePush(lineUid, {
    type: 'text',
    text: `I didn't understand that. Type "help" for available commands.`
  });
}

// Verify LINE webhook signature
function verifySignature(rawBody, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) return true; // Skip in dev
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

// Clean expired codes periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of pendingCodes.entries()) {
    if (now - data.createdAt > CODE_EXPIRY_MS) {
      pendingCodes.delete(code);
      console.log('[LINE Bot] Expired code:', code);
    }
  }
}, 60 * 1000); // Every minute

// ============ EXPRESS SERVER ============
const app = express();

// LINE webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === LINE_WEBHOOK_VERIFY_TOKEN) {
    console.log('[LINE Bot] Webhook verified!');
    res.status(200).send(challenge);
  } else {
    console.log('[LINE Bot] Webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

// LINE webhook event receiver
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-line-signature'];

  if (!verifySignature(req.body, signature)) {
    console.log('[LINE Bot] Invalid signature');
    return res.status(401).send('Invalid signature');
  }

  try {
    const events = JSON.parse(req.body.toString()).events || [];

    for (const event of events) {
      console.log('[LINE Bot] Event:', event.type, event.source?.userId);

      if (event.type === 'follow') {
        await handleFollow(event.source.userId);
      } else if (event.type === 'unfollow') {
        await handleUnfollow(event.source.userId);
      } else if (event.type === 'message' && event.message.type === 'text') {
        await handleMessage(event.source.userId, event.message.text);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[LINE Bot] Webhook error:', err);
    res.status(500).send('Internal error');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    codes: pendingCodes.size,
    uptime: process.uptime()
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[LINE Bot] Server running on port ${PORT}`);
  console.log(`[LINE Bot] Webhook URL: /webhook`);
  console.log(`[LINE Bot] Health: /health`);
});

// Export for testing
module.exports = { app, pendingCodes, handleFollow, handleUnfollow, handleMessage };
