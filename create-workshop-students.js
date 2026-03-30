const neo4j = require('neo4j-driver');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

const students = [
  // 3 weeks - 9870元
  { name: '马儿', wechatId: '', classType: '3-week-workshop', size: 'L', paid: true },
  { name: '权哥', wechatId: '', classType: '3-week-workshop', size: 'XL', paid: true },
  { name: '嘉芬', wechatId: '', classType: '3-week-workshop', size: 'L', paid: true },
  { name: '老谢', wechatId: '', classType: '3-week-workshop', size: 'XL', paid: true },
  { name: '陈云', wechatId: '', classType: '3-week-workshop', size: 'L', paid: true },
  { name: '刘建梅', wechatId: '', classType: '3-week-workshop', size: 'L', paid: true },
  { name: 'Maggie', wechatId: '', classType: '3-week-workshop', size: 'XL', paid: true },
  { name: '郑莉', wechatId: '', classType: '3-week-workshop', size: 'M', paid: true },
  { name: '萍姐', wechatId: '', classType: '3-week-workshop', size: 'M', paid: true },
  { name: '丽君', wechatId: '', classType: '3-week-workshop', size: 'L', paid: true },
  { name: '华姐', wechatId: '', classType: '3-week-workshop', size: 'L', paid: true },
  { name: '吉吉', wechatId: '', classType: '3-week-workshop', size: 'M', paid: false, deposit: 2000, remaining: 7870 },
  { name: '白姐', wechatId: '', classType: '3-week-workshop', size: 'M', paid: true, paymentMethod: 'bank' },
  { name: '小辣椒', wechatId: '', classType: '3-week-workshop', size: 'XL', paid: true },
  { name: '刑晨晨', wechatId: '', classType: '3-week-workshop', size: 'XL', paid: true },
  { name: '汪晓红', wechatId: '', classType: '3-week-workshop', size: 'M', paid: true },
  // Deep course - 7485元
  { name: 'Smile', wechatId: '', classType: 'deep-course', size: 'XL', paid: true },
  { name: '老聂', wechatId: '', classType: 'deep-course', size: 'XL', paid: true },
  { name: '李蓉君', wechatId: '', classType: 'deep-course', size: 'L', paid: true, paymentMethod: 'bank' },
  // 1 week - 4180元
  { name: '歆芝Zia', wechatId: '', classType: '1-week', size: '', paid: true },
  { name: '骆文', wechatId: '', classType: '1-week', size: '', paid: true },
  // 9 days - 4300元
  { name: '隋洪乙', wechatId: '', classType: '9-day', size: '', paid: false, deposit: 2000, remaining: 4300 },
  // 4 days Mysore - 2200元
  { name: '乔乔', wechatId: '', classType: '4-day-mysore', size: '', paid: true, paymentMethod: 'alipay' },
];

async function createStudent(session, student) {
  const studentId = uuidv4();
  const now = new Date().toISOString();
  
  try {
    // Check if exists
    const existing = await session.run(
      'MATCH (s:Student {name: $name}) RETURN s LIMIT 1',
      { name: student.name }
    );
    
    if (existing.records.length > 0) {
      const existingId = existing.records[0].get('s').properties.id;
      console.log(`SKIP (exists): ${student.name} -> ${existingId}`);
      return { name: student.name, studentId: existingId, skipped: true };
    }
    
    // Create
    await session.run(`
      CREATE (s:Student {
        id: $id,
        name: $name,
        wechatId: $wechatId,
        isChineseStudent: true,
        classType: $classType,
        size: $size,
        paid: $paid,
        deposit: $deposit,
        remaining: $remaining,
        paymentMethod: $paymentMethod,
        createdAt: datetime($createdAt),
        isActive: true
      })
      RETURN s
    `, {
      id: studentId,
      name: student.name,
      wechatId: student.wechatId || null,
      classType: student.classType,
      size: student.size || null,
      paid: student.paid,
      deposit: student.deposit || null,
      remaining: student.remaining || null,
      paymentMethod: student.paymentMethod || null,
      createdAt: now
    });
    
    console.log(`CREATE: ${student.name} -> ${studentId}`);
    return { name: student.name, studentId, skipped: false };
  } catch (err) {
    console.error(`ERROR ${student.name}: ${err.message}`);
    return { name: student.name, studentId: null, error: err.message };
  }
}

async function main() {
  const session = driver.session();
  
  try {
    console.log('Creating workshop student profiles...\n');
    const results = [];
    
    for (const student of students) {
      const result = await createStudent(session, student);
      results.push(result);
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total: ${students.length}`);
    console.log(`Created: ${results.filter(r => !r.skipped && !r.error).length}`);
    console.log(`Skipped (exists): ${results.filter(r => r.skipped).length}`);
    console.log(`Errors: ${results.filter(r => r.error).length}`);
    
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);