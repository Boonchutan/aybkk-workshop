const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  const db = await notion.databases.query({ database_id: '7e6f9c96-5e13-4784-995f-4048c321a2f7' });
  console.log('Total pages:', db.results.length);
  db.results.forEach(p => {
    const props = p.properties;
    console.log(JSON.stringify({
      id: p.id,
      name: props.Name?.title?.[0]?.plain_text || '?',
      email: props.Email?.email || '?',
      phone: props.Phone?.phone_number || '?',
      membership: props['Membership Type']?.select?.name || '?'
    }));
  });
}

main().catch(e => console.error(e.message));
