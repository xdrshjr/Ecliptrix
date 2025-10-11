-- Agent Workflow 表创建脚本
-- 用于在Supabase中创建Agent工作流信息表
-- 存储用户创建的工作流配置，包括节点信息、连线信息等

-- 创建agent_workflows表
CREATE TABLE IF NOT EXISTS agent_workflows (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    workflow_id VARCHAR(255) NOT NULL,
    workflow_name VARCHAR(255) NOT NULL,
    workflow_description TEXT,
    
    -- 工作流数据，存储为JSONB格式以支持灵活的数据结构
    nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
    connections JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- 元数据
    is_active BOOLEAN DEFAULT true,
    is_template BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1,
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_executed_at TIMESTAMP WITH TIME ZONE,
    
    -- 约束
    CONSTRAINT workflow_id_length CHECK (char_length(workflow_id) >= 1),
    CONSTRAINT workflow_name_length CHECK (char_length(workflow_name) >= 1),
    CONSTRAINT valid_nodes CHECK (jsonb_typeof(nodes) = 'array'),
    CONSTRAINT valid_connections CHECK (jsonb_typeof(connections) = 'array')
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_agent_workflows_user_id ON agent_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_workflow_id ON agent_workflows(workflow_id);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_created_at ON agent_workflows(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_is_active ON agent_workflows(is_active);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_user_workflow ON agent_workflows(user_id, workflow_id);

-- 为JSONB字段创建GIN索引以支持高效的JSON查询
CREATE INDEX IF NOT EXISTS idx_agent_workflows_nodes_gin ON agent_workflows USING GIN (nodes);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_connections_gin ON agent_workflows USING GIN (connections);

-- 创建更新时间的触发器函数（如果不存在）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 创建触发器
DROP TRIGGER IF EXISTS update_agent_workflows_updated_at ON agent_workflows;
CREATE TRIGGER update_agent_workflows_updated_at
    BEFORE UPDATE ON agent_workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 行级安全策略（RLS）
-- 暂时禁用RLS以避免复杂的权限问题，在生产环境中可以根据需要启用
ALTER TABLE agent_workflows DISABLE ROW LEVEL SECURITY;

-- 如果需要启用RLS，可以使用以下策略（已注释）:
/*
ALTER TABLE agent_workflows ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的工作流和模板工作流
CREATE POLICY agent_workflows_select_policy ON agent_workflows
    FOR SELECT USING (
        user_id = auth.uid() OR is_template = true
    );

-- 用户只能插入自己的工作流
CREATE POLICY agent_workflows_insert_policy ON agent_workflows
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- 用户只能更新自己的工作流
CREATE POLICY agent_workflows_update_policy ON agent_workflows
    FOR UPDATE USING (user_id = auth.uid());

-- 用户只能删除自己的工作流
CREATE POLICY agent_workflows_delete_policy ON agent_workflows
    FOR DELETE USING (user_id = auth.uid());
*/

-- 注释
COMMENT ON TABLE agent_workflows IS 'Agent工作流表，存储用户创建的工作流配置信息';
COMMENT ON COLUMN agent_workflows.id IS '工作流记录唯一标识符';
COMMENT ON COLUMN agent_workflows.user_id IS '创建该工作流的用户ID';
COMMENT ON COLUMN agent_workflows.workflow_id IS '工作流业务ID，用于前端标识';
COMMENT ON COLUMN agent_workflows.workflow_name IS '工作流名称';
COMMENT ON COLUMN agent_workflows.workflow_description IS '工作流描述';
COMMENT ON COLUMN agent_workflows.nodes IS '工作流节点配置，JSONB格式存储节点数组';
COMMENT ON COLUMN agent_workflows.connections IS '工作流连线配置，JSONB格式存储连线数组';
COMMENT ON COLUMN agent_workflows.is_active IS '工作流是否激活';
COMMENT ON COLUMN agent_workflows.is_template IS '是否为模板工作流';
COMMENT ON COLUMN agent_workflows.version IS '工作流版本号';
COMMENT ON COLUMN agent_workflows.created_at IS '创建时间';
COMMENT ON COLUMN agent_workflows.updated_at IS '最后更新时间';
COMMENT ON COLUMN agent_workflows.last_executed_at IS '最后执行时间';

