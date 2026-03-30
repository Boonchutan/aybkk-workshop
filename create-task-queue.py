# Create TaskQueue schema in Neo4j
from neo4j import GraphDatabase
import os

uri = "bolt://localhost:7687"
auth = ("neo4j", "aybkk_neo4j_2026")

driver = GraphDatabase.driver(uri, auth=auth)

with driver.session() as session:
    # Create constraints
    try:
        session.run("CREATE CONSTRAINT task_id IF NOT EXISTS FOR (t:Task) REQUIRE t.id IS UNIQUE")
        print("✓ Constraint created: task_id")
    except Exception as e:
        print(f"Constraint: {e}")
    
    # Create indexes
    try:
        session.run("CREATE INDEX task_assignee IF NOT EXISTS FOR (t:Task) ON (t.assignee)")
        session.run("CREATE INDEX task_status IF NOT EXISTS FOR (t:Task) ON (t.status)")
        print("✓ Indexes created")
    except Exception as e:
        print(f"Index: {e}")
    
    # Check existing tasks
    result = session.run("MATCH (t:Task) RETURN count(t) as count")
    count = result.single()['count']
    print(f"✓ Tasks in system: {count}")

driver.close()
print("✓ TaskQueue schema ready")
