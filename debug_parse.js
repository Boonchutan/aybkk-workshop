const fs = require('fs');
const statePath = '/Users/alfredoagent/mission-control/data/ru-bot-state.json';
const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const byChat = raw.byChat || {};
const chatIds = Object.keys(byChat).filter(k => !['byChat','knownGroups'].includes(k));

console.log('First raw value type:', typeof byChat[chatIds[0]]);
console.log('First raw value (200 chars):', byChat[chatIds[0]].substring(0, 200));

// Try eval
try {
  const result = eval('(' + byChat[chatIds[0]] + ')');
  console.log('\nEval success:', result);
  console.log('studentId:', result.studentId);
} catch(e) {
  console.log('\nEval error:', e.message);
}

// Try Function constructor
try {
  const fn = new Function('return ' + byChat[chatIds[0]]);
  const result = fn();
  console.log('\nFunction success:', result.studentId);
} catch(e) {
  console.log('\nFunction error:', e.message);
}

// Try JSON.parse on a simpler field
const simple = byChat[chatIds[0]];
console.log('\n\nContains True:', simple.includes('True'));
console.log('Contains None:', simple.includes('None'));
console.log('Contains False:', simple.includes('False'));