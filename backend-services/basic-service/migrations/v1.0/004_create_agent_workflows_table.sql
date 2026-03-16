-- v1.0 - 004: Create agent_workflows table
-- Create agent_workflows table for workflow storage
-- Schema matches app/models/db_models.py AgentWorkflow model

CREATE TABLE IF NOT EXISTS agent_workflows (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(36),
    workflow_name VARCHAR(200) NOT NULL,
    workflow_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    description TEXT,
    is_template BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT workflow_name_length CHECK (char_length(workflow_name) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_agent_workflows_user_id ON agent_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_created_at ON agent_workflows(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_is_template ON agent_workflows(is_template);
-- Note: GIN index on workflow_data is omitted because existing tables may use JSON (not JSONB)

DROP TRIGGER IF EXISTS update_agent_workflows_updated_at ON agent_workflows;
CREATE TRIGGER update_agent_workflows_updated_at
    BEFORE UPDATE ON agent_workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
