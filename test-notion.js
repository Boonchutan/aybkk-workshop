require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function test() {
  try {
    const response = await notion.search({ 
      filter: { property: 'object', value: 'data_source' } 
    });
    console.log('✓ Connected! Found', response.results.length, 'databases');
    
    // List first few databases
    response.results.slice(0, 3).forEach((db, i) => {
      console.log(`  ${i+1}. ${db.title?.[0]?.plain_text || 'Untitled'}`);
    });
    
    process.exit(0);
  } catch (e) {
    console.error('✗ Error:', e.message);
    process.exit(1);
  }
}

test();