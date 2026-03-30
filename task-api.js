/**
 * TaskQueue API for Agent Coordination
 * Neo4j-based task management between Nicco and Neo
 */

const { v4: uuidv4 } = require('uuid');

// Create Task
async function createTask(session, taskData) {
  const task = {
    id: taskData.id || `TASK-${uuidv4().slice(0, 8)}`,
    assignee: taskData.assignee,
    title: taskData.title,
    description: taskData.description,
    acceptanceCriteria: taskData.acceptanceCriteria || '',
    status: 'ASSIGNED',
    priority: taskData.priority || 'MEDIUM',
    deadline: taskData.deadline,
    estimatedHours: taskData.estimatedHours || 0,
    actualHours: 0,
    createdAt: new Date().toISOString(),
    createdBy: taskData.createdBy || 'system',
    updatedAt: new Date().toISOString(),
    result: '',
    files: JSON.stringify([]),
    feedback: ''
  };

  const result = await session.run(`
    CREATE (t:Task $task)
    RETURN t
  `, { task });

  return result.records[0].get('t').properties;
}

// Get tasks by assignee
async function getTasksByAssignee(session, assignee, status = null) {
  let query = `
    MATCH (t:Task {assignee: $assignee})
    ${status ? 'WHERE t.status = $status' : ''}
    RETURN t
    ORDER BY t.createdAt DESC
  `;
  
  const params = { assignee };
  if (status) params.status = status;
  
  const result = await session.run(query, params);
  return result.records.map(r => r.get('t').properties);
}

// Update task status
async function updateTaskStatus(session, taskId, updates) {
  const setClauses = [];
  const params = { taskId };
  
  Object.keys(updates).forEach(key => {
    setClauses.push(`t.${key} = $${key}`);
    params[key] = updates[key];
  });
  
  setClauses.push('t.updatedAt = datetime()');
  
  const result = await session.run(`
    MATCH (t:Task {id: $taskId})
    SET ${setClauses.join(', ')}
    RETURN t
  `, params);
  
  return result.records[0]?.get('t')?.properties;
}

// Get task by ID
async function getTaskById(session, taskId) {
  const result = await session.run(`
    MATCH (t:Task {id: $taskId})
    RETURN t
  `, { taskId });
  
  return result.records[0]?.get('t')?.properties;
}

module.exports = {
  createTask,
  getTasksByAssignee,
  updateTaskStatus,
  getTaskById
};
