require('dotenv').config();
const { Client } = require('@notionhq/client');

console.log('=== NOTION - Query Student Database ===');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  // The student database ID from inspect-notion.js
  const dbId = '7e6f9c96-5e13-4784-995f-4048c321a2f7';
  
  try {
    // Query with POST to data_sources endpoint
    const response = await notion.request({
      method: 'POST',
      path: `data_sources/${dbId}/query`,
      body: { page_size: 5 }
    });
    
    console.log('Found entries:', response.results?.length);
    
    // Collect all tags from the results
    const allTags = {
      Strength: new Set(),
      Weaknesses: new Set(),
      'To improve': new Set(),
      'Practice series': new Set()
    };
    
    for (const page of response.results || []) {
      const props = page.properties;
      console.log('\n--- Student ---');
      
      for (const [key, value] of Object.entries(props)) {
        if (value.type === 'multi_select' && value.multi_select.length > 0) {
          const names = value.multi_select.map(s => s.name);
          console.log(key + ':', names.join(', '));
          if (allTags[key]) {
            names.forEach(n => allTags[key].add(n));
          }
        }
      }
    }
    
    console.log('\n=== AGGREGATED TAGS ===');
    for (const [category, tags] of Object.entries(allTags)) {
      if (tags.size > 0) {
        console.log('\n' + category + ':');
        Array.from(tags).sort().forEach(t => console.log('  -', t));
      }
    }
    
  } catch (e) {
    console.log('Error:', e.message);
    console.log('Code:', e.code);
    console.log('Body:', JSON.stringify(e.body, null, 2)?.substring(0, 500));
  }
}

main().catch(console.error);