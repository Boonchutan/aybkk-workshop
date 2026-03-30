require('dotenv').config();

async function verifyToken() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  console.log('Token length:', token ? token.length : 0);
  
  if (!token) {
    console.log('No token found in env');
    return;
  }
  
  // Verify token by calling LINE profile
  const res = await fetch('https://api.line.me/v2/bot/info', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  console.log('Verify response:', res.status);
  const data = await res.json();
  console.log('Bot info:', JSON.stringify(data, null, 2));
}

verifyToken().catch(console.error);
