require('dotenv').config();
const { Client } = require('@notionhq/client');

console.log('=== NOTION - Quick Tag Search ===');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  // Search broadly for anything that might have tags
  const queries = ['student', 'practice', 'improve', 'strength', 'weakness', 'ashtanga'];
  const allTags = new Set();
  
  for (const query of queries) {
    try {
      const search = await notion.search({ query, page_size: 25 });
      for (const page of search.results.filter(r => r.object === 'page')) {
        for (const [key, value] of Object.entries(page.properties || {})) {
          if (value.type === 'multi_select' && value.multi_select.length > 0) {
            for (const tag of value.multi_select) {
              allTags.add(tag.name);
            }
          }
        }
      }
    } catch (e) {
      console.log('Error for', query, ':', e.message);
    }
  }
  
  console.log('\n=== FOUND TAGS ===');
  const sorted = Array.from(allTags).sort();
  console.log('Count:', sorted.length);
  sorted.forEach(t => console.log('-', t));
}

main().catch(console.error);