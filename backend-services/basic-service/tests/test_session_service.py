"""
测试会话管理服务

运行测试：
pytest tests/test_session_service.py -v
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from app.services.session_service import SessionService


class TestSessionService:
    """测试 SessionService 类"""

    @pytest.fixture
    def mock_supabase_client(self):
        """创建模拟的 Supabase 客户端"""
        mock_client = Mock()
        mock_table = Mock()
        mock_client.table.return_value = mock_table
        return mock_client, mock_table

    @pytest.fixture
    def session_service(self, mock_supabase_client):
        """创建 SessionService 实例并注入模拟客户端"""
        mock_client, _ = mock_supabase_client
        service = SessionService()
        service.client = mock_client
        return service

    @pytest.mark.asyncio
    async def test_create_session_success(self, session_service, mock_supabase_client):
        """测试成功创建会话"""
        _, mock_table = mock_supabase_client
        
        # 模拟查询现有会话
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.return_value = Mock(data=[{
            'active_session_token': 'old_token',
            'session_created_at': '2024-01-01T00:00:00Z'
        }])
        mock_table.select.return_value = select_mock
        
        # 模拟更新会话
        update_mock = Mock()
        update_mock.eq.return_value = update_mock
        update_mock.execute.return_value = Mock(data=[{
            'id': 'user-123',
            'active_session_token': 'new_token'
        }])
        mock_table.update.return_value = update_mock
        
        # 执行测试
        result = await session_service.create_session(
            user_id='user-123',
            device_info='Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            ip_address='192.168.1.1'
        )
        
        # 验证结果
        assert result['success'] is True
        assert result['message'] == '会话创建成功'
        assert 'session_token' in result
        assert len(result['session_token']) > 0

    @pytest.mark.asyncio
    async def test_create_session_no_existing_session(self, session_service, mock_supabase_client):
        """测试在没有现有会话时创建新会话"""
        _, mock_table = mock_supabase_client
        
        # 模拟没有现有会话
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.return_value = Mock(data=[{
            'active_session_token': None
        }])
        mock_table.select.return_value = select_mock
        
        # 模拟更新会话
        update_mock = Mock()
        update_mock.eq.return_value = update_mock
        update_mock.execute.return_value = Mock(data=[{
            'id': 'user-123',
            'active_session_token': 'new_token'
        }])
        mock_table.update.return_value = update_mock
        
        # 执行测试
        result = await session_service.create_session(
            user_id='user-123',
            device_info='Mozilla/5.0',
            ip_address='192.168.1.1'
        )
        
        # 验证结果
        assert result['success'] is True
        assert 'session_token' in result

    @pytest.mark.asyncio
    async def test_validate_session_valid(self, session_service, mock_supabase_client):
        """测试验证有效会话"""
        _, mock_table = mock_supabase_client
        
        # 模拟查询用户会话
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.return_value = Mock(data=[{
            'active_session_token': 'valid_token',
            'session_created_at': '2024-01-01T00:00:00Z',
            'is_active': True
        }])
        mock_table.select.return_value = select_mock
        
        # 执行测试
        result = await session_service.validate_session(
            user_id='user-123',
            session_token='valid_token'
        )
        
        # 验证结果
        assert result['success'] is True
        assert result['valid'] is True
        assert result['message'] == '会话有效'

    @pytest.mark.asyncio
    async def test_validate_session_invalid_token(self, session_service, mock_supabase_client):
        """测试验证无效会话令牌（另一设备登录）"""
        _, mock_table = mock_supabase_client
        
        # 模拟查询用户会话，令牌不匹配
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.return_value = Mock(data=[{
            'active_session_token': 'different_token',
            'session_created_at': '2024-01-01T00:00:00Z',
            'is_active': True
        }])
        mock_table.select.return_value = select_mock
        
        # 执行测试
        result = await session_service.validate_session(
            user_id='user-123',
            session_token='old_token'
        )
        
        # 验证结果
        assert result['success'] is True
        assert result['valid'] is False
        assert result['reason'] == '您的账号已在另一台设备上登录'

    @pytest.mark.asyncio
    async def test_validate_session_user_not_found(self, session_service, mock_supabase_client):
        """测试验证不存在的用户"""
        _, mock_table = mock_supabase_client
        
        # 模拟用户不存在
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.return_value = Mock(data=[])
        mock_table.select.return_value = select_mock
        
        # 执行测试
        result = await session_service.validate_session(
            user_id='nonexistent-user',
            session_token='any_token'
        )
        
        # 验证结果
        assert result['success'] is True
        assert result['valid'] is False
        assert result['reason'] == '用户不存在'

    @pytest.mark.asyncio
    async def test_validate_session_user_inactive(self, session_service, mock_supabase_client):
        """测试验证已禁用用户的会话"""
        _, mock_table = mock_supabase_client
        
        # 模拟用户已被禁用
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.return_value = Mock(data=[{
            'active_session_token': 'valid_token',
            'is_active': False
        }])
        mock_table.select.return_value = select_mock
        
        # 执行测试
        result = await session_service.validate_session(
            user_id='user-123',
            session_token='valid_token'
        )
        
        # 验证结果
        assert result['success'] is True
        assert result['valid'] is False
        assert result['reason'] == '用户已被禁用'

    @pytest.mark.asyncio
    async def test_validate_session_no_active_session(self, session_service, mock_supabase_client):
        """测试验证没有活跃会话的用户"""
        _, mock_table = mock_supabase_client
        
        # 模拟用户没有活跃会话
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.return_value = Mock(data=[{
            'active_session_token': None,
            'is_active': True
        }])
        mock_table.select.return_value = select_mock
        
        # 执行测试
        result = await session_service.validate_session(
            user_id='user-123',
            session_token='any_token'
        )
        
        # 验证结果
        assert result['success'] is True
        assert result['valid'] is False
        assert result['reason'] == '无活跃会话'

    @pytest.mark.asyncio
    async def test_invalidate_session_success(self, session_service, mock_supabase_client):
        """测试成功注销会话"""
        _, mock_table = mock_supabase_client
        
        # 模拟更新操作
        update_mock = Mock()
        update_mock.eq.return_value = update_mock
        update_mock.execute.return_value = Mock(data=[{
            'id': 'user-123'
        }])
        mock_table.update.return_value = update_mock
        
        # 执行测试
        result = await session_service.invalidate_session(user_id='user-123')
        
        # 验证结果
        assert result['success'] is True
        assert result['message'] == '会话已注销'

    def test_generate_session_token(self, session_service):
        """测试会话令牌生成"""
        token1 = session_service._generate_session_token()
        token2 = session_service._generate_session_token()
        
        # 验证令牌不为空且唯一
        assert len(token1) > 0
        assert len(token2) > 0
        assert token1 != token2

    @pytest.mark.asyncio
    async def test_create_session_database_error(self, session_service, mock_supabase_client):
        """测试数据库错误时的会话创建"""
        _, mock_table = mock_supabase_client
        
        # 模拟数据库错误
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.side_effect = Exception("Database connection error")
        mock_table.select.return_value = select_mock
        
        # 执行测试
        result = await session_service.create_session(
            user_id='user-123',
            device_info='Mozilla/5.0',
            ip_address='192.168.1.1'
        )
        
        # 验证结果
        assert result['success'] is False
        assert result['error_code'] == 'SESSION_ERROR'
        assert 'error_details' in result

    @pytest.mark.asyncio
    async def test_validate_session_database_error(self, session_service, mock_supabase_client):
        """测试数据库错误时的会话验证"""
        _, mock_table = mock_supabase_client
        
        # 模拟数据库错误
        select_mock = Mock()
        select_mock.eq.return_value = select_mock
        select_mock.execute.side_effect = Exception("Database connection error")
        mock_table.select.return_value = select_mock
        
        # 执行测试
        result = await session_service.validate_session(
            user_id='user-123',
            session_token='any_token'
        )
        
        # 验证结果
        assert result['success'] is False
        assert result['valid'] is False
        assert result['error_code'] == 'SESSION_VALIDATION_ERROR'

