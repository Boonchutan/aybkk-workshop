require('dotenv').config();
const { Client } = require('@notionhq/client');

console.log('=== NOTION TEST ===');
console.log('API Key:', process.env.NOTION_API_KEY ? 'SET (' + process.env.NOTION_API_KEY.substring(0, 10) + '...)' : 'NOT SET');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function getPageContent(pageId) {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = page.properties;
    let title = 'Untitled';
    let tags = [];
    
    // Find title property
    for (const [key, value] of Object.entries(props)) {
      if (value.type === 'title') {
        title = value.title.map(t => t.plain_text).join('');
      }
      if (value.type === 'multi_select') {
        tags.push(...value.multi_select.map(s => s.name));
      }
    }
    return { title, tags, id: pageId };
  } catch (e) {
    return { title: 'Error: ' + e.message, tags: [], id: pageId };
  }
}

async function main() {
  // Search for Ashtanga or Tag related pages
  const queries = ['Ashtanga', 'tag', 'series', 'pose'];
  
  for (const query of queries) {
    try {
      const search = await notion.search({ query, page_size: 100 });
      console.log('\n=== SEARCH: ' + query + ' (' + search.results.length + ') ===');
      
      // Get first 20 pages with their content
      const pages = search.results.filter(r => r.object === 'page').slice(0, 20);
      
      for (const page of pages) {
        const info = await getPageContent(page.id);
        if (info.title && !info.title.includes('Error')) {
          console.log(info.id.substring(0, 8), '|', info.title.substring(0, 50), '| Tags:', info.tags.join(', '));
        }
      }
    } catch (e) {
      console.log('Search error for', query, ':', e.message);
    }
  }
}

main().catch(console.error);