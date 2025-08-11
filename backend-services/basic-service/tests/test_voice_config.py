"""
Tests for voice configuration loading from YAML file.
"""

import pytest
import yaml
from pathlib import Path
from app.services.tts_service import TTSService


class TestVoiceConfiguration:
    """Test cases for voice configuration loading."""

    def test_config_file_exists(self):
        """Test that the voice configuration file exists."""
        config_path = Path(__file__).parent.parent / "config" / "batch_tts_config.yaml"
        assert config_path.exists(), f"Configuration file not found at {config_path}"

    def test_config_file_valid_yaml(self):
        """Test that the configuration file contains valid YAML."""
        config_path = Path(__file__).parent.parent / "config" / "batch_tts_config.yaml"
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        assert config is not None
        assert isinstance(config, dict)

    def test_config_file_has_voice_types(self):
        """Test that the configuration file contains voice types section."""
        config_path = Path(__file__).parent.parent / "config" / "batch_tts_config.yaml"
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        assert 'voice_types' in config
        assert 'volcano' in config['voice_types']
        assert 'voices' in config['voice_types']['volcano']
        
        voices = config['voice_types']['volcano']['voices']
        assert isinstance(voices, list)
        assert len(voices) > 0

    def test_voice_entries_have_required_fields(self):
        """Test that each voice entry has all required fields."""
        config_path = Path(__file__).parent.parent / "config" / "batch_tts_config.yaml"
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        voices = config['voice_types']['volcano']['voices']
        required_fields = ['value', 'label', 'category', 'gender', 'language', 'description']
        
        for i, voice in enumerate(voices):
            for field in required_fields:
                assert field in voice, f"Voice {i} missing required field '{field}': {voice}"
            
            # Validate field types and values
            assert isinstance(voice['value'], str) and voice['value'], f"Voice {i} has invalid value"
            assert isinstance(voice['label'], str) and voice['label'], f"Voice {i} has invalid label"
            assert isinstance(voice['category'], str) and voice['category'], f"Voice {i} has invalid category"
            assert voice['gender'] in ['male', 'female'], f"Voice {i} has invalid gender: {voice['gender']}"
            assert voice['language'] in ['zh-CN', 'en-US'], f"Voice {i} has invalid language: {voice['language']}"
            assert isinstance(voice['description'], str) and voice['description'], f"Voice {i} has invalid description"

    def test_voice_categories_are_valid(self):
        """Test that all voice categories are from the expected set."""
        config_path = Path(__file__).parent.parent / "config" / "batch_tts_config.yaml"
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        voices = config['voice_types']['volcano']['voices']
        expected_categories = ['通用场景', '趣味方言', '角色扮演', '播报解说', '有声阅读']
        
        categories_found = set()
        for voice in voices:
            category = voice['category']
            categories_found.add(category)
            assert category in expected_categories, f"Unexpected category '{category}' in voice: {voice['label']}"
        
        # Should have at least 3 different categories
        assert len(categories_found) >= 3, f"Expected at least 3 categories, found: {categories_found}"

    def test_voice_ids_are_unique(self):
        """Test that all voice IDs are unique."""
        config_path = Path(__file__).parent.parent / "config" / "batch_tts_config.yaml"
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        voices = config['voice_types']['volcano']['voices']
        voice_ids = [voice['value'] for voice in voices]
        
        assert len(voice_ids) == len(set(voice_ids)), "Duplicate voice IDs found"

    def test_tts_service_loads_config_successfully(self):
        """Test that TTSService can successfully load the configuration."""
        service = TTSService()
        voice_types = service.get_available_voice_types()
        
        # Should have loaded voices from config (more than just fallback)
        assert len(voice_types) > 6, f"Expected more than 6 voices, got {len(voice_types)}"
        
        # Check that we have voices from multiple categories
        categories = set()
        for voice_info in voice_types.values():
            categories.add(voice_info.category)
        
        assert len(categories) >= 3, f"Expected at least 3 categories, found: {categories}"
        
        # Verify some specific voices exist
        expected_voices = [
            'zh_male_shaonianzixin_moon_bigtts',
            'zh_female_linjianvhai_moon_bigtts',
            'zh_female_daimengchuanmei_moon_bigtts'
        ]
        
        for voice_id in expected_voices:
            assert voice_id in voice_types, f"Expected voice '{voice_id}' not found in loaded voices"

    def test_voice_distribution_by_category(self):
        """Test that voices are well distributed across categories."""
        service = TTSService()
        voice_types = service.get_available_voice_types()
        
        # Count voices by category
        category_counts = {}
        for voice_info in voice_types.values():
            category = voice_info.category
            category_counts[category] = category_counts.get(category, 0) + 1
        
        # Should have voices in each expected category
        expected_categories = ['通用场景', '趣味方言', '角色扮演', '播报解说', '有声阅读']
        for category in expected_categories:
            assert category in category_counts, f"No voices found for category '{category}'"
            assert category_counts[category] > 0, f"Category '{category}' has no voices"
        
        # 通用场景 should have the most voices
        assert category_counts['通用场景'] >= 10, f"通用场景 should have at least 10 voices, got {category_counts['通用场景']}"


if __name__ == "__main__":
    pytest.main([__file__]) 