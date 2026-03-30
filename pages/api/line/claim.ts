/**
 * LINE Account Claim API
 * POST /api/line/claim - Link LINE account to student
 * Body: { code: string, studentId: string }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import neo4j from 'neo4j-driver';

// Neo4j connection
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'poinefth水下123';
const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// In-memory code storage (shared with webhook handler in production, use Redis)
const pendingCodes = new Map();

// Import shared code handler (monkey-patch for now)
async function linkAccount(code: string, studentId: string) {
  const data = (pendingCodes as any).get(code);
  
  if (!data) {
    return { success: false, error: 'Invalid or expired code. Please get a new code from the LINE bot.' };
  }
  
  const { lineUid } = data;
  const session = driver.session();
  
  try {
    // Check if student exists
    const studentCheck = await session.run(
      'MATCH (s:Student) WHERE s.studentId = $studentId OR s.name = $studentId RETURN s',
      { studentId }
    );
    
    if (studentCheck.records.length === 0) {
      return { success: false, error: 'Student not found. Please check your name or ID.' };
    }
    
    // Link student to LINE account
    await session.run(
      `MATCH (s:Student) WHERE s.studentId = $studentId OR s.name = $studentId
       MERGE (la:LineAccount {uid: $lineUid})
       MERGE (s)-[:HAS_LINE]->(la)
       SET la.linkedAt = datetime()`,
      { studentId, lineUid }
    );
    
    // Remove from pending
    pendingCodes.delete(code);
    
    return { success: true, message: 'LINE account linked successfully!' };
  } finally {
    await session.close();
  }
}

// Export for use by webhook handler
export { pendingCodes, linkAccount };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, studentId } = req.body;

  if (!code || !studentId) {
    return res.status(400).json({ error: 'Missing code or studentId' });
  }

  const result = await linkAccount(code, studentId);
  
  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(400).json(result);
  }
}
