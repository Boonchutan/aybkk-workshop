require('dotenv').config();
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const Pinn_UID = 'Ud529d633c164b27ad36694e416a7c2fd';

async function testPush() {
  console.log('Sending test push to Pinn...');
  
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      to: Pinn_UID,
      messages: [{
        type: 'text',
        text: `🔗 AYBKK Link Test\n\nYour code is: 8284\n\nGo to: aybkk.com/claim\nName: Pinn Kant`
      }]
    })
  });
  
  console.log('Response:', res.status, res.statusText);
  const data = await res.json();
  console.log('Body:', JSON.stringify(data));
}

testPush().catch(console.error);
