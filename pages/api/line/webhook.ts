/**
 * LINE Webhook API Endpoint
 * POST /api/line/webhook - receives events from LINE
 * GET /api/line/webhook - LINE verification endpoint
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { handleFollow, handleUnfollow } from '../../lib/line-webhook-handler';

export const config = {
  api: {
    bodyParser: false, // Need raw body for LINE signature verification
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // LINE webhook verification
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.LINE_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[LINE Webhook] Verified!');
      res.status(200).send(challenge);
    } else {
      console.log('[LINE Webhook] Verification failed');
      res.status(403).send('Forbidden');
    }
    return;
  }

  if (req.method === 'POST') {
    const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

    // Read raw body for signature verification
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    const body = rawBody.toString();

    // Verify signature
    const crypto = require('crypto');
    const signature = req.headers['x-line-signature'] as string;
    
    if (LINE_CHANNEL_SECRET) {
      const hash = crypto
        .createHmac('sha256', LINE_CHANNEL_SECRET)
        .update(rawBody)
        .digest('base64');
      
      if (signature !== hash) {
        console.log('[LINE Webhook] Invalid signature');
        res.status(401).send('Invalid signature');
        return;
      }
    }

    try {
      const events = JSON.parse(body).events || [];

      for (const event of events) {
        console.log('[LINE Webhook] Event:', event.type, event.source?.userId);

        if (event.type === 'follow') {
          await handleFollow(event.source.userId);
        } else if (event.type === 'unfollow') {
          await handleUnfollow(event.source.userId);
        } else if (event.type === 'postback') {
          // Handle postback data (e.g., button clicks)
          console.log('[LINE] Postback:', event.postback?.data);
        } else if (event.type === 'message') {
          // Echo or handle text messages
          console.log('[LINE] Message:', event.message?.text);
        }
      }

      res.status(200).send('OK');
    } catch (err) {
      console.error('[LINE Webhook] Error:', err);
      res.status(500).send('Internal error');
    }
    return;
  }

  res.status(405).send('Method not allowed');
}
