const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function main() {
  const session = driver.session();
  const result = await session.run(`
    MERGE (tm:TeamMemory {id: 'aybkk-shared'})
    SET tm.updatedAt = datetime(),
        tm.botSchema = 'assessment-bot v4',
        tm.assessmentNode = '{id, teacher_id, teacher_name, energy_level, practice_behavior, last_asana_comment, last_asana_pass, to_fix_now, created_at}',
        tm.assessmentRelations = '[:FOR_STUDENT]',
        tm.studentNode = '{studentId (UUID), name, firstName, lastName, email, phone, nationality, pgId, active}',
        tm.membershipNode = '{status, startsAt, expiresAt}',
        tm.tagNode = '{name, type (strength/weakness/course)}',
        tm.tagRelations = '[:HAS_STRENGTH, HAS_WEAKNESS, HAS_CURRENT, HAS_ASSESSMENT]',
        tm.teacherNames = ['Boonchu', 'Jamsai', 'M'],
        tm.teachers = ['Boonchu Tanti (@boonchu_tanti)', 'Jamsai (@unknown)', 'M (@unknown)'],
        tm.lineChannel = 'AYBKK Assistant',
        tm.lineTokenSet = true,
        tm.lastUpdated = 'March 22, 2026',
        tm.notes = 'Student tracking bot with voting on asana progression. Teachers assess independently via Telegram. Each vote saved separately per teacher. LINE broadcast notifies other teachers after assessment.'
    RETURN tm.id as id
  `);

  console.log('TeamMemory updated:', result.records[0].get('id'));
  await session.close();
  driver.close();
}
main().catch(console.error);