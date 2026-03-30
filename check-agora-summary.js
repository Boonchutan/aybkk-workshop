const neo4j = require('neo4j-driver');
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);
const session = driver.session();

session.run(`
  MATCH (a:Agora {id:'aybkk-agora'})-[:CONTAINS]->(x)
  RETURN labels(x) as labels, x.id as id, x.subject as subject, x.status as status,
         x.assigned_to as assigned, x.summary as summary, x.description as desc,
         x.date as date, x.name as name
  ORDER BY x.timestamp DESC, x.created_at DESC
  LIMIT 30
`).then(r => {
  const tasks = [], decisions = [], contexts = [], actions = [], other = [];
  r.records.forEach(rec => {
    const labels = rec.get('labels');
    const item = {
      id: rec.get('id'),
      subject: rec.get('subject'),
      status: rec.get('status'),
      assigned: rec.get('assigned'),
      summary: rec.get('summary'),
      desc: rec.get('desc'),
      date: rec.get('date'),
      name: rec.get('name')
    };
    if (labels.includes('Task')) tasks.push(item);
    else if (labels.includes('Decision')) decisions.push(item);
    else if (labels.includes('Context')) contexts.push(item);
    else if (labels.includes('Action')) actions.push(item);
    else other.push(item);
  });

  console.log('=== TASKS (' + tasks.length + ') ===');
  tasks.forEach(t => console.log('  [' + (t.status || 'pending') + '] ' + (t.subject || t.name) + (t.assigned ? ' -> ' + t.assigned : '')));

  console.log('\n=== DECISIONS (' + decisions.length + ') ===');
  decisions.forEach(d => console.log('  ' + (d.desc || d.name || d.id)));

  console.log('\n=== CONTEXT (' + contexts.length + ') ===');
  contexts.forEach(c => console.log('  ' + (c.date || '') + ': ' + (c.summary || c.name || c.id)));

  console.log('\n=== ACTIONS (' + actions.length + ') ===');
  actions.forEach(a => console.log('  ' + (a.subject || a.name || a.desc || a.id)));

  session.close();
  driver.close();
}).catch(e => {
  console.error('Error:', e.message);
  session.close();
  driver.close();
});
