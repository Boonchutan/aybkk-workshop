/**
 * LINE Webhook Handler
 * Receives events from LINE Messaging API
 * Handles: follow (student added bot), unfollow, postback, message
 */

const neo4j = require('neo4j-driver');
const line = require('@line/bot-sdk');

// Neo4j connection
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'poinefth水下123';
const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// In-memory code storage (reset on server restart - for MVP)
// In production, use Redis or Neo4j
const pendingCodes = new Map(); // code -> { lineUid, createdAt }

// Generate 4-digit code
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Send welcome message with code
async function sendWelcomeMessage(lineUid, code) {
  const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  
  const message = {
    type: 'text',
    text: `Welcome to AYBKK! 🎉\n\nYour verification code: ${code}\n\nTo link your account:\n1. Go to AYBKK.com/claim\n2. Enter this code\n3. Search for your name\n\nThis links your LINE to your student profile for practice tracking.`
  };

  try {
    await fetch('https://api.line.me/v2/bot/profile/' + lineUid, {
      headers: {
        'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
      }
    });
    
    // Actually send the message
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
      },
      body: JSON.stringify({
        to: lineUid,
        messages: [message]
      })
    });
    
    return response.ok;
  } catch (err) {
    console.error('[LINE Webhook] Send welcome failed:', err.message);
    return false;
  }
}

// Handle follow event (student added bot)
async function handleFollow(lineUid) {
  console.log('[LINE] New follower:', lineUid);
  
  // Check if already linked
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (s:Student)-[:HAS_LINE]->(:LineAccount {uid: $uid}) RETURN s.name as name LIMIT 1',
      { uid: lineUid }
    );
    
    if (result.records.length > 0) {
      // Already linked
      const name = result.records[0].get('name');
      console.log('[LINE] Already linked:', name);
      return { type: 'already_linked', name };
    }
  } finally {
    await session.close();
  }
  
  // Generate new code
  const code = generateCode();
  pendingCodes.set(code, { lineUid, createdAt: Date.now() });
  
  // Send welcome with code
  await sendWelcomeMessage(lineUid, code);
  
  // Also log to Neo4j for tracking
  const session2 = driver.session();
  try {
    await session2.run(
      'MERGE (la:LineAccount {uid: $uid}) ON CREATE SET la.createdAt = datetime(), la.followedBot = true',
      { uid: lineUid }
    );
  } finally {
    await session2.close();
  }
  
  return { type: 'new_user', code };
}

// Handle unfollow event
async function handleUnfollow(lineUid) {
  console.log('[LINE] Unfollowed:', lineUid);
  // Mark as unfollowed (don't delete - keep for re-follow handling)
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

// Link LINE account to student
async function linkAccount(code, studentId) {
  const data = pendingCodes.get(code);
  
  if (!data) {
    return { success: false, error: 'Invalid or expired code' };
  }
  
  const { lineUid } = data;
  const session = driver.session();
  
  try {
    // Link student to LINE account
    await session.run(
      `MATCH (s:Student {studentId: $studentId})
       MERGE (la:LineAccount {uid: $lineUid})
       MERGE (s)-[:HAS_LINE]->(la)
       SET la.linkedAt = datetime()`,
      { studentId, lineUid }
    );
    
    // Remove from pending
    pendingCodes.delete(code);
    
    // Send confirmation
    await sendConfirmationMessage(lineUid);
    
    return { success: true };
  } finally {
    await session.close();
  }
}

// Send confirmation after linking
async function sendConfirmationMessage(lineUid) {
  const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  
  const message = {
    type: 'text',
    text: `✅ Account linked!\n\nYour LINE is now connected to your AYBKK student profile.\n\nYou'll receive:\n• Daily check-in reminders\n• Practice tracking\n• Weekly progress reports\n\nSee you on the mat! 🧘`
  };

  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
      },
      body: JSON.stringify({
        to: lineUid,
        messages: [message]
      })
    });
  } catch (err) {
    console.error('[LINE] Confirmation send failed:', err.message);
  }
}

// Get pending codes (for debugging/admin)
function getPendingCodes() {
  return Array.from(pendingCodes.entries()).map(([code, data]) => ({
    code,
    lineUid: data.lineUid,
    age: Date.now() - data.createdAt
  }));
}

module.exports = {
  handleFollow,
  handleUnfollow,
  linkAccount,
  getPendingCodes
};
