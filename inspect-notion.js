require('dotenv').config();
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function queryStudents() {
  const dbId = '7e6f9c96-5e13-4784-995f-4048c321a2f7';

  try {
    // Use the low-level request method with the new API endpoint
    const response = await notion.request({
      method: 'POST',
      path: `data_sources/${dbId}/query`,
      body: {
        page_size: 5
      }
    });

    console.log(`Found ${response.results?.length || 0} entries\n`);

    response.results?.forEach((page, i) => {
      console.log(`--- Student ${i+1} ---`);
      const props = page.properties;
      console.log(`Name: ${props.Name?.title?.[0]?.plain_text || 'N/A'}`);
      console.log(`Phone: ${props['Phone number']?.phone_number || 'N/A'}`);
      console.log(`Email: ${props['Personal email']?.email || 'N/A'}`);
      console.log(`Membership: ${props['Membership type']?.select?.name || 'N/A'}`);
      console.log(`Status: ${props['Status']?.status?.name || 'N/A'}`);
      console.log(`Birthday: ${props['Birthday']?.date?.start || 'N/A'}`);
      console.log(`Start day: ${props['Start day']?.date?.start || 'N/A'}`);
      console.log(`Measurements: ${props['Arm/Body/Leg/Hip/Waist/Weight/Hight']?.rich_text?.[0]?.plain_text || 'N/A'}`);
      console.log(`Strength: ${props['Strength']?.multi_select?.map(s => s.name).join(', ') || 'N/A'}`);
      console.log(`Weaknesses: ${props['Weaknesses']?.multi_select?.map(s => s.name).join(', ') || 'N/A'}`);
      console.log(`To improve: ${props['To improve']?.multi_select?.map(s => s.name).join(', ') || 'N/A'}`);
      console.log(`Practice series: ${props['Practice series']?.multi_select?.map(s => s.name).join(', ') || 'N/A'}`);
      console.log(`Number: ${props['Number']?.number || 'N/A'}`);
      console.log(`Notion ID: ${props['ID']?.unique_id?.number || 'N/A'}`);
      console.log();
    });
  } catch (e) {
    console.error('Error:', e.message);
    console.error('Details:', JSON.stringify(e, null, 2));
  }
}

queryStudents();