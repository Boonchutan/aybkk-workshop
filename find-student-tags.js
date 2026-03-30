require('dotenv').config();
const { Client } = require('@notionhq/client');

console.log('=== NOTION - Find Student Tags ===');
console.log('API Key:', process.env.NOTION_API_KEY ? 'SET' : 'NOT SET');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function getPageContent(pageId) {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = page.properties;
    let title = 'Untitled';
    let tags = [];
    let allMultiSelect = {};
    
    // Find title property and ALL multi_select fields
    for (const [key, value] of Object.entries(props)) {
      if (value.type === 'title') {
        title = value.title.map(t => t.plain_text).join('');
      }
      if (value.type === 'multi_select') {
        const selectNames = value.multi_select.map(s => s.name);
        if (selectNames.length > 0) {
          allMultiSelect[key] = selectNames;
          tags.push(...selectNames);
        }
      }
    }
    return { title, tags, allMultiSelect, id: pageId };
  } catch (e) {
    return { title: 'Error', tags: [], allMultiSelect: {}, id: pageId };
  }
}

async function main() {
  // Try to access known database IDs from the codebase
  const dbIds = [
    '7e6f9c96-5e13-4784-995f-4048c321a2f7', // Student directory from inspect-notion.js
    // Let's search for more
  ];
  
  // First, let's get ALL pages and collect unique tags
  console.log('\n=== Collecting all pages and tags ===');
  
  const allTags = new Set();
  const tagToPages = {};
  
  try {
    const search = await notion.search({ page_size: 100 });
    console.log('Total pages found:', search.results.length);
    
    const pages = search.results.filter(r => r.object === 'page');
    console.log('Pages (not databases):', pages.length);
    
    for (const page of pages) {
      const info = await getPageContent(page.id);
      if (info.title && !info.title.includes('Error') && info.tags.length > 0) {
        console.log('\n--- Page:', info.title, '---');
        console.log('Multi-select fields:', JSON.stringify(info.allMultiSelect));
        
        for (const tag of info.tags) {
          allTags.add(tag);
          if (!tagToPages[tag]) tagToPages[tag] = [];
          tagToPages[tag].push(info.title);
        }
      }
    }
    
    console.log('\n\n=== UNIQUE TAGS COLLECTED ===');
    console.log('Total unique tags:', allTags.size);
    console.log(Array.from(allTags).sort().join('\n'));
    
  } catch (e) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);