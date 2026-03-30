
const neo4j = require('neo4j-driver');

async function mergeArtifactDuplicates() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
  const session = driver.session();
  
  try {
    // Find duplicate Artifact tasks by id
    const findDupes = await session.run(`
      MATCH (a:Artifact)
      WHERE a.type = 'task'
      WITH a.id as taskId, collect(a) as artifacts, count(*) as cnt
      WHERE cnt > 1
      RETURN taskId, artifacts, cnt
    `);
    
    console.log('DUPLICATE ARTIFACT-TASK GROUPS:', findDupes.records.length);
    
    for (const record of findDupes.records) {
      const taskId = record.get('taskId');
      const artifacts = record.get('artifacts');
      const count = record.get('cnt').low;
      
      console.log(`\nTask ID: "${taskId}" - ${count} copies`);
      console.log(`Subject: "${artifacts[0].properties.subject}"`);
      
      // Keep the first one, delete the rest
      const keep = artifacts[0];
      const deleteList = artifacts.slice(1);
      
      console.log(`  Keeping: ${keep.elementId}`);
      console.log(`  Deleting: ${deleteList.length} duplicates`);
      
      for (const dupe of deleteList) {
        await session.run('MATCH (a:Artifact) WHERE elementId(a) = $elementId DETACH DELETE a', {
          elementId: dupe.elementId
        });
        console.log(`    Deleted: ${dupe.elementId}`);
      }
    }
    
    // Also check for duplicate Artifact nodes with same id (not just tasks)
    const findArtifactDupes = await session.run(`
      MATCH (a:Artifact)
      WHERE a.id IS NOT NULL
      WITH a.id as artifactId, collect(a) as artifacts, count(*) as cnt
      WHERE cnt > 1
      RETURN artifactId, artifacts, cnt
    `);
    
    console.log('\nDUPLICATE ARTIFACT IDS:', findArtifactDupes.records.length);
    
    for (const record of findArtifactDupes.records) {
      const artifactId = record.get('artifactId');
      const artifacts = record.get('artifacts');
      const count = record.get('cnt').low;
      
      console.log(`Artifact ID: "${artifactId}" - ${count} copies`);
      
      const keep = artifacts[0];
      const deleteList = artifacts.slice(1);
      
      console.log(`  Keeping: ${keep.elementId}`);
      
      for (const dupe of deleteList) {
        await session.run('MATCH (a:Artifact) WHERE elementId(a) = $elementId DETACH DELETE a', {
          elementId: dupe.elementId
        });
        console.log(`    Deleted duplicate artifact`);
      }
    }
    
    console.log('\n✅ Artifact duplicate cleanup complete');
    
  } finally {
    await session.close();
    await driver.close();
  }
}

mergeArtifactDuplicates().catch(console.error);
