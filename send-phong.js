require('dotenv').config();
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const Phong_UID = 'Ud529d633c164b27ad36694e416a7c2fd';

async function sendPhongInstructions() {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      to: Phong_UID,
      messages: [{
        type: 'text',
        text: `🔗 Link your LINE to AYBKK

Go to this page and enter:

Name: PhongThitipong Suwannachaya
Code: 7488

Link: https://compiled-car-reviews-hear.trycloudflare.com/claim

⚠️ Code expires soon!`
      }]
    })
  });
  
  console.log('Response:', res.status);
  const data = await res.json();
  console.log('Result:', JSON.stringify(data));
}

sendPhongInstructions().catch(console.error);
