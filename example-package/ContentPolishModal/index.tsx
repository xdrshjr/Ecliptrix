import React, { useState, useEffect } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Textarea,
  Text,
  Box,
  VStack,
  HStack,
  Badge,
  useToast,
  Flex,
  Card,
  CardBody,
  useColorModeValue,
  Tooltip,
  Checkbox,
  SimpleGrid,
  CheckboxGroup,
  Wrap,
  WrapItem,
  Icon,
  Divider,
  RadioGroup,
  Radio,
  Stack
} from '@chakra-ui/react';
import { InfoIcon } from '@chakra-ui/icons';
import ModelSelector from '@/components/ModelSelector';
import { ModelOption } from '@/lib/utils/models';
import { apiCall } from '@/lib/api-client';
import { useArticleStore } from '@/store/articleStore';
import { ContentGenerationLanguage } from '@/types';
import {
  controversialPolishPrompt,
  hasControversialOption,
  differentiationPolishPrompt,
  hasDifferentiationOption
} from '@/lib/prompts/controversialPrompts';

interface ContentPolishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContentSelect: (content: string) => void;
  originalContent: string;
  contentTitle?: string;
}

interface ContentSuggestion {
  content: string;
  explanation: string;
}

const ContentPolishModal: React.FC<ContentPolishModalProps> = ({
  isOpen,
  onClose,
  onContentSelect,
  originalContent,
  contentTitle = '自由创作内容'
}) => {
  const toast = useToast();
  
  // 获取文章参数以获取语言设置
  const { params } = useArticleStore();

  // 颜色主题 - 必须在所有其他逻辑之前调用，确保Hook调用顺序一致
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const cardBgColor = useColorModeValue('gray.50', 'gray.700');
  const selectedCardBgColor = useColorModeValue('blue.50', 'blue.900');
  const selectedCardBorderColor = useColorModeValue('blue.300', 'blue.500');
  const headerBgColor = useColorModeValue('purple.50', 'purple.900');
  const headerTextColor = useColorModeValue('purple.800', 'purple.100');
  const headerSubTextColor = useColorModeValue('gray.600', 'gray.300');
  const blueBgColor = useColorModeValue('blue.50', 'blue.900');
  const blueBorderColor = useColorModeValue('blue.200', 'blue.700');
  const blueTextColor = useColorModeValue('blue.800', 'blue.200');
  const blueSubTextColor = useColorModeValue('blue.700', 'blue.300');
  const grayTextColor = useColorModeValue('gray.600', 'gray.400');
  const grayLightTextColor = useColorModeValue('gray.500', 'gray.400');
  const whiteBgColor = useColorModeValue('white', 'gray.700');
  const grayBorderColor = useColorModeValue('gray.200', 'gray.600');
  const emptyStateTextColor = useColorModeValue('gray.500', 'gray.400');
  const emptyStateSubTextColor = useColorModeValue('gray.400', 'gray.500');

  // 状态
  const [polishGoal, setPolishGoal] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>(process.env.LLM_MODEL_NAME || 'gpt-4-turbo');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [contentSuggestions, setContentSuggestions] = useState<ContentSuggestion[]>([]);
  const [selectedContent, setSelectedContent] = useState<string>('');
  
  // 预制润色目标选项
  const [selectedPresetGoals, setSelectedPresetGoals] = useState<string[]>([]);
  
  // 语言选择状态 - 默认从参数获取
  const [selectedLanguage, setSelectedLanguage] = useState<ContentGenerationLanguage>(() => {
    // 初始化时从参数获取默认语言
    switch (params.multilingualMode) {
      case 'pure-english':
        return 'english';
      case 'pure-chinese':
      case 'chinese-english':
      case 'none':
      default:
        return 'chinese';
    }
  });
  
  // 预制润色目标选项列表
  const presetGoals = [
    { value: 'short_video', label: '短视频文案', description: '适合抖音、快手等短视频平台的文案风格' },
    { value: 'three_second_hook', label: '三秒钩子', description: '开头3秒内抓住观众注意力' },
    { value: 'engage_comments', label: '激发用户评论', description: '引导用户互动和留言讨论' },
    { value: 'reader_resonance', label: '激发读者共鸣', description: '让读者产生强烈的情感共鸣' },
    { value: 'empathy', label: '激发共情', description: '触动读者的情感，产生同理心' },
    { value: 'call_to_action', label: '行动号召', description: '引导读者采取具体行动' },
    { value: 'storytelling', label: '故事化表达', description: '用故事的方式讲述内容' },
    { value: 'pain_point', label: '痛点切入', description: '直击用户痛点，引起关注' },
    { value: 'viral_potential', label: '传播性强', description: '容易被分享和传播的内容' },
    { value: 'curiosity_gap', label: '好奇心缺口', description: '制造悬念，激发好奇心' },
    { value: 'fan_sb', label: '犯SB', description: '故意犯一些小错误，引发用户纠正和评论' },
    { value: 'provoke_debate', label: '故意引战', description: '使用专业引战技巧，制造争议性观点激发讨论和辩论（已升级）' },
    { value: 'differentiation', label: '差异化', description: '采用独特视角和创新表达，让内容脱颖而出，在同质化环境中形成鲜明差异' },
    { value: 'echo_ending', label: '收尾呼应', description: '结尾与开头形成呼应，增强整体性' },
    { value: 'contrast_strong', label: '强烈对比', description: '通过鲜明对比突出重点' },
    { value: 'golden_sentence', label: '金句输出', description: '包含容易被引用的经典语句' },
    { value: 'data_support', label: '数据支撑', description: '用具体数据增强说服力' },
    { value: 'authority_quote', label: '权威引用', description: '引用专家或名人观点增加可信度' },
    { value: 'scenario_immersion', label: '场景代入', description: '让读者身临其境，增强体验感' },
    { value: 'reverse_thinking', label: '反向思维', description: '与常规思路相反，制造惊喜' },
    { value: 'anxiety_marketing', label: '焦虑营销', description: '合理利用焦虑心理驱动行动' },
    { value: 'benefit_driven', label: '利益驱动', description: '明确指出读者能获得的好处' },
    { value: 'scarcity_urgency', label: '稀缺紧迫', description: '营造稀缺感和紧迫感' },
    { value: 'social_proof', label: '社会认同', description: '利用从众心理增强说服力' },
    { value: 'emotional_trigger', label: '情绪触发', description: '激发强烈的情绪反应' },
    { value: 'practical_tips', label: '实用干货', description: '提供具体可执行的方法技巧' }
  ];
  
  // 获取可用模型列表状态
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  
  // 从API获取模型列表
  useEffect(() => {
    const fetchModels = async () => {
      try {
        setModelsLoading(true);
        setModelsError(null);
        
        // 使用新的API调用工具进行认证请求
        const response = await apiCall('models', {
          method: 'GET',
          requireAuth: true,
          timeout: 10000 // 10秒超时
        });

        if (!response.success) {
          // 处理频次限制错误
          if (response.error?.statusCode === 429) {
            const retryAfter = response.rateLimitInfo?.retryAfter || 10;
            throw new Error(`请求过于频繁，请等待 ${retryAfter} 秒后重试`);
          }
          throw new Error(response.error?.message || '获取模型列表失败');
        }
        
        if (response.data.success && response.data.models) {
          setAvailableModels(response.data.models);
          console.log('[ContentPolishModal] 成功获取模型列表:', response.data.models.length, '个模型');
        } else {
          throw new Error(response.data.error || '获取模型列表失败');
        }
      } catch (error) {
        console.error('[ContentPolishModal] 获取模型列表失败:', error);
        setModelsError((error as Error).message);
        
        // 设置默认模型作为fallback
        setAvailableModels([{
          value: 'gpt-4-turbo',
          label: 'GPT-4 Turbo',
          description: '默认模型（配置加载失败）'
        }]);
      } finally {
        setModelsLoading(false);
      }
    };
    
    // 只在模态框打开时获取
    if (isOpen) {
      fetchModels();
    }
  }, [isOpen]);

  // 同步语言选择状态与参数变化
  useEffect(() => {
    if (isOpen) {
      setSelectedLanguage(getContentLanguageFromParams());
    }
  }, [isOpen, params.multilingualMode]);

  // 处理模型变更
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
  };

  // 处理预制目标选择
  const handlePresetGoalChange = (values: string[]) => {
    setSelectedPresetGoals(values);
  };

  // 一键全选/取消全选
  const handleSelectAllPresets = () => {
    if (selectedPresetGoals.length === presetGoals.length) {
      // 如果已全选，则取消全选
      setSelectedPresetGoals([]);
    } else {
      // 否则全选
      setSelectedPresetGoals(presetGoals.map(goal => goal.value));
    }
  };

  // 构建润色目标文本
  const buildPolishGoalText = () => {
    const selectedGoalTexts = selectedPresetGoals.map(value => {
      const goal = presetGoals.find(g => g.value === value);
      return goal ? goal.label : '';
    }).filter(Boolean);

    const presetText = selectedGoalTexts.length > 0 ? selectedGoalTexts.join('、') : '';
    const customText = polishGoal.trim();

    if (presetText && customText) {
      return `${presetText}；${customText}`;
    } else if (presetText) {
      return presetText;
    } else if (customText) {
      return customText;
    } else {
      return '';
    }
  };

  // 将multilingualMode映射到contentLanguage
  const getContentLanguageFromParams = (): ContentGenerationLanguage => {
    switch (params.multilingualMode) {
      case 'pure-english':
        return 'english';
      case 'pure-chinese':
      case 'chinese-english':
      case 'none':
      default:
        return 'chinese';
    }
  };

  // 获取内容润色建议 - 改为并行调用3次LLM
  const handlePolish = async () => {
    if (!originalContent || !originalContent.trim()) {
      toast({
        title: "错误",
        description: "没有可润色的内容",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      setIsLoading(true);
      setContentSuggestions([]);
      
      // 检查是否选择了特殊润色模式
      const isControversialMode = hasControversialOption(selectedPresetGoals);
      const isDifferentiationMode = hasDifferentiationOption(selectedPresetGoals);
      
      if (isControversialMode) {
        // 故意引战模式：使用专门的提示词模板
        console.log('🔥 检测到故意引战模式，使用专门的提示词模板');
        
        const controversialPrompt = controversialPolishPrompt(
          originalContent,
          contentTitle,
          buildPolishGoalText()
        );
        
        // 生成3种不同程度的引战风格
        const controversialStyles = [
          {
            style: "温和引战风格",
            description: "适度制造话题，激发理性讨论",
            prompt: controversialPrompt
          },
          {
            style: "中等引战风格", 
            description: "增强争议性表达，引发更多关注和讨论",
            prompt: controversialPrompt + "\n\n请在保持理性的前提下，适度增强争议性和话题性。"
          },
          {
            style: "强势引战风格",
            description: "最大化争议效果，适合追求高讨论度的内容",
            prompt: controversialPrompt + "\n\n请在保持建设性的前提下，最大化内容的争议性和讨论价值，让读者看完后忍不住想要评论和分享。"
          }
        ];
        
        // 并行调用3次LLM API，使用故意引战提示词
        const polishPromises = controversialStyles.map(async (styleConfig, index) => {
          try {
            console.log(`🔥 开始第${index + 1}次引战润色调用 - ${styleConfig.style}`);
            
            // 使用apiCall进行认证请求
            const response = await apiCall('ai/generate', {
              method: 'POST',
              body: {
                prompt: styleConfig.prompt,
                temperature: 0.8, // 稍微提高温度以增加创意性
                model: selectedModel
              },
              requireAuth: true,
              timeout: 600000 // 600秒超时
            });
            
            if (!response.success) {
              // 处理频次限制错误
              if (response.error?.statusCode === 429) {
                const retryAfter = response.rateLimitInfo?.retryAfter || 10;
                throw new Error(`请求过于频繁，请等待 ${retryAfter} 秒后重试`);
              }
              throw new Error(response.error?.message || `第${index + 1}次引战润色失败`);
            }
            
            console.log(`✅ 第${index + 1}次引战润色调用完成 - ${styleConfig.style}`);
            
            return {
              content: response.data.content?.trim() || '',
              explanation: styleConfig.description
            };
          } catch (error) {
            console.error(`❌ 第${index + 1}次引战润色调用失败:`, error);
            return {
              content: `引战润色失败: ${(error as Error).message}`,
              explanation: `${styleConfig.style} - 生成失败`
            };
          }
        });
        
        // 等待所有并行调用完成
        console.log('⏱️ 等待所有引战润色调用完成...');
        const results = await Promise.all(polishPromises);
        
        // 过滤掉失败的结果
        const successfulResults = results.filter(result => 
          result.content && 
          !result.content.startsWith('引战润色失败:') && 
          result.content.trim().length > 0
        );
        
        if (successfulResults.length === 0) {
          throw new Error('所有引战润色尝试都失败了，请重试');
        }
        
        setContentSuggestions(successfulResults);
        
        // 默认选择第一个成功的内容
        if (successfulResults.length > 0) {
          setSelectedContent(successfulResults[0].content);
        }
        
      } else if (isDifferentiationMode) {
        // 差异化模式：使用专门的差异化提示词模板
        console.log('🎨 检测到差异化模式，使用专门的差异化提示词模板');
        
        const differentiationPrompt = differentiationPolishPrompt(
          originalContent,
          contentTitle,
          buildPolishGoalText()
        );
        
        // 生成3种不同程度的差异化风格
        const differentiationStyles = [
          {
            style: "轻度差异化风格",
            description: "保持易读性的同时，增加独特视角和表达方式",
            prompt: differentiationPrompt
          },
          {
            style: "中度差异化风格", 
            description: "显著增强差异化特色，采用更独特的表达和视角",
            prompt: differentiationPrompt + "\n\n请在保持内容价值的前提下，显著增强差异化特色，使用更加独特和新颖的表达方式。"
          },
          {
            style: "高度差异化风格",
            description: "最大化差异化效果，创造极具特色的独特表达",
            prompt: differentiationPrompt + "\n\n请最大化差异化效果，采用极具创意和冲击力的表达方式，让内容在众多同质化内容中脱颖而出，形成强烈的记忆点。"
          }
        ];
        
        // 并行调用3次LLM API，使用差异化提示词
        const polishPromises = differentiationStyles.map(async (styleConfig, index) => {
          try {
            console.log(`🎨 开始第${index + 1}次差异化润色调用 - ${styleConfig.style}`);
            
            // 使用apiCall进行认证请求
            const response = await apiCall('ai/generate', {
              method: 'POST',
              body: {
                prompt: styleConfig.prompt,
                temperature: 0.9, // 提高温度以增加创意性
                model: selectedModel
              },
              requireAuth: true,
              timeout: 600000 // 600秒超时
            });
            
            if (!response.success) {
              // 处理频次限制错误
              if (response.error?.statusCode === 429) {
                const retryAfter = response.rateLimitInfo?.retryAfter || 10;
                throw new Error(`请求过于频繁，请等待 ${retryAfter} 秒后重试`);
              }
              throw new Error(response.error?.message || `第${index + 1}次差异化润色失败`);
            }
            
            console.log(`✅ 第${index + 1}次差异化润色调用完成 - ${styleConfig.style}`);
            
            return {
              content: response.data.content?.trim() || '',
              explanation: styleConfig.description
            };
          } catch (error) {
            console.error(`❌ 第${index + 1}次差异化润色调用失败:`, error);
            return {
              content: `差异化润色失败: ${(error as Error).message}`,
              explanation: `${styleConfig.style} - 生成失败`
            };
          }
        });
        
        // 等待所有并行调用完成
        console.log('⏱️ 等待所有差异化润色调用完成...');
        const results = await Promise.all(polishPromises);
        
        // 过滤掉失败的结果
        const successfulResults = results.filter(result => 
          result.content && 
          !result.content.startsWith('差异化润色失败:') && 
          result.content.trim().length > 0
        );
        
        if (successfulResults.length === 0) {
          throw new Error('所有差异化润色尝试都失败了，请重试');
        }
        
        setContentSuggestions(successfulResults);
        
        // 默认选择第一个成功的内容
        if (successfulResults.length > 0) {
          setSelectedContent(successfulResults[0].content);
        }
        
      } else {
        // 常规润色模式：使用原有的三种润色风格
        console.log('📝 使用常规润色模式');
        
        // 使用用户在弹窗中选择的语言设置
        const contentLanguage = selectedLanguage;
        
        // 根据语言设置添加语言约束指令
        let languageInstruction = '';
        if (contentLanguage === 'english') {
          languageInstruction = '\n<Instruct>Language Requirements:</Instruct> Please ensure that all polished content is in pure English, without any Chinese characters or expressions.';
        } else {
          languageInstruction = '\n<Instruct>语言要求:</Instruct> 请确保润色后的内容为纯中文，不要包含任何英文词汇或表达。';
        }
        
        const polishStyles = [
          {
            style: "生动有趣风格",
            description: "增强感染力和可读性，让内容更有温度和趣味性",
            prompt: `你是一位文字功底深厚的编辑，请对以下内容进行深度润色，采用生动有趣的风格：

<Instruct>章节标题:</Instruct> ${contentTitle}
<Instruct>原始内容:</Instruct> ${originalContent}
${buildPolishGoalText() ? `<Instruct>特殊润色要求:</Instruct> ${buildPolishGoalText()}` : ''}

<Instruct>润色目标 - 生动有趣风格:</Instruct>
1. 消除AI化的机械表达，让文字更具人性温度
2. 增加生动的描述和具体的细节
3. 使用更多形象化的比喻和表达
4. 让语言更加亲切自然，增强感染力
5. 适当增加一些有趣的表达方式

<Instruct>具体润色要求:</Instruct>
1. 替换僵硬的连接词和过渡语
2. 增加具体细节和生动描述
3. 优化句式结构，增强表达节奏
4. 保持原文的核心观点和信息量
5. 让语言更自然，更像真人的表达习惯
6. 删除或替换AI常用的套话表达

请直接返回润色后的内容，不要包含任何解释或格式标记。${languageInstruction}`
          },
          {
            style: "专业严谨风格", 
            description: "保持专业性和权威性，适合正式场合和学术环境",
            prompt: `你是一位文字功底深厚的编辑，请对以下内容进行深度润色，采用专业严谨的风格：

<Instruct>章节标题:</Instruct> ${contentTitle}
<Instruct>原始内容:</Instruct> ${originalContent}
${buildPolishGoalText() ? `<Instruct>特殊润色要求:</Instruct> ${buildPolishGoalText()}` : ''}

<Instruct>润色目标 - 专业严谨风格:</Instruct>
1. 消除AI化的机械表达，保持专业性
2. 增强内容的逻辑性和条理性
3. 使用更准确、权威的表达方式
4. 保持严谨的论证结构
5. 让语言更规范，符合专业标准

<Instruct>具体润色要求:</Instruct>
1. 使用更准确的专业术语
2. 优化逻辑结构和论证层次
3. 增强表达的准确性和权威性
4. 保持原文的核心观点和信息量
5. 让语言更规范，符合专业写作标准
6. 删除或替换AI常用的套话表达

请直接返回润色后的内容，不要包含任何解释或格式标记。${languageInstruction}`
          },
          {
            style: "通俗易懂风格",
            description: "简化表达，让内容更容易理解和接受，适合大众阅读",
            prompt: `你是一位文字功底深厚的编辑，请对以下内容进行深度润色，采用通俗易懂的风格：

<Instruct>章节标题:</Instruct> ${contentTitle}
<Instruct>原始内容:</Instruct> ${originalContent}
${buildPolishGoalText() ? `<Instruct>特殊润色要求:</Instruct> ${buildPolishGoalText()}` : ''}

<Instruct>润色目标 - 通俗易懂风格:</Instruct>
1. 消除AI化的机械表达，让文字更通俗
2. 简化复杂的表达和概念
3. 使用更日常化的语言和表达
4. 让内容更容易理解和接受
5. 保持内容的准确性的同时提高可读性

<Instruct>具体润色要求:</Instruct>
1. 将复杂术语转换为通俗表达
2. 简化句式结构，避免过长的句子
3. 增加具体的例子和说明
4. 保持原文的核心观点和信息量
5. 让语言更亲民，更易于理解
6. 删除或替换AI常用的套话表达

请直接返回润色后的内容，不要包含任何解释或格式标记。${languageInstruction}`
          }
        ];
        
        // 并行调用3次LLM API
        const polishPromises = polishStyles.map(async (styleConfig, index) => {
          try {
            console.log(`📋 开始第${index + 1}次LLM调用 - ${styleConfig.style}`);
            
            // 使用apiCall进行认证请求
            const response = await apiCall('ai/generate', {
              method: 'POST',
              body: {
                prompt: styleConfig.prompt,
                temperature: 0.7,
                model: selectedModel
              },
              requireAuth: true,
              timeout: 600000 // 600秒超时
            });
            
            if (!response.success) {
              // 处理频次限制错误
              if (response.error?.statusCode === 429) {
                const retryAfter = response.rateLimitInfo?.retryAfter || 10;
                throw new Error(`请求过于频繁，请等待 ${retryAfter} 秒后重试`);
              }
              throw new Error(response.error?.message || `第${index + 1}次润色失败`);
            }
            
            console.log(`✅ 第${index + 1}次LLM调用完成 - ${styleConfig.style}`);
            
            return {
              content: response.data.content?.trim() || '',
              explanation: styleConfig.description
            };
          } catch (error) {
            console.error(`❌ 第${index + 1}次LLM调用失败:`, error);
            // 如果某个调用失败，返回错误信息而不是中断整个过程
            return {
              content: `润色失败: ${(error as Error).message}`,
              explanation: `${styleConfig.style} - 生成失败`
            };
          }
        });
        
        // 等待所有并行调用完成
        console.log('⏱️ 等待所有LLM调用完成...');
        const results = await Promise.all(polishPromises);
        
        // 过滤掉失败的结果
        const successfulResults = results.filter(result => 
          result.content && 
          !result.content.startsWith('润色失败:') && 
          result.content.trim().length > 0
        );
        
        if (successfulResults.length === 0) {
          throw new Error('所有润色尝试都失败了，请重试');
        }
        
        setContentSuggestions(successfulResults);
        
        // 默认选择第一个成功的内容
        if (successfulResults.length > 0) {
          setSelectedContent(successfulResults[0].content);
        }
      }
      
      console.log('🎉 润色调用完成，结果数量:', contentSuggestions.length);
      
      // 如果有失败的调用，显示警告
      if (contentSuggestions.length < 3) {
        toast({
          title: "部分润色完成",
          description: `成功生成 ${contentSuggestions.length}/3 个润色版本`,
          status: "warning",
          duration: 4000,
          isClosable: true,
        });
      }
      
    } catch (error) {
      console.error('❌ 润色过程失败:', error);
      toast({
        title: "润色失败",
        description: (error as Error).message || "获取内容润色建议失败",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // 处理内容选择
  const handleContentSelect = (content: string) => {
    setSelectedContent(content);
  };
  
  // 确认选择的内容
  const handleConfirm = () => {
    if (selectedContent) {
      onContentSelect(selectedContent);
      toast({
        title: "内容已更新",
        description: "已成功应用润色后的内容",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      onClose();
    } else {
      toast({
        title: "请选择内容",
        description: "请先选择一个润色版本",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // 重置状态
  const handleClose = () => {
    setPolishGoal('');
    setSelectedPresetGoals([]);
    setContentSuggestions([]);
    setSelectedContent('');
    // 重置语言选择为参数默认值
    setSelectedLanguage(getContentLanguageFromParams());
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="6xl">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent 
        bg={bgColor} 
        borderRadius="xl" 
        boxShadow="xl"
        maxW="1200px"
        maxH="85vh"
        overflow="hidden"
      >
        <ModalHeader 
          borderBottomWidth="1px" 
          borderColor={borderColor} 
          py={3}
          px={5}
          fontSize="xl"
          fontWeight="bold"
          bg={headerBgColor}
          color={headerTextColor}
          borderTopRadius="xl"
        >
          内容润色
          <Text mt={1} fontSize="sm" color={headerSubTextColor} fontWeight="normal">
            让AI帮您优化内容，提升表达效果
          </Text>
        </ModalHeader>
        <ModalCloseButton />
        
        <ModalBody px={6} py={5} overflow="auto">
          <Flex direction={{ base: 'column', md: 'row' }} gap={6}>
            {/* 左侧设置区域 */}
            <Box width={{ base: '100%', md: '35%' }}>
              <VStack align="stretch" spacing={5}>
                {/* 原内容展示 */}
                <Box>
                  <FormLabel fontSize="sm" fontWeight="medium" mb={1}>原始内容</FormLabel>
                  <Card variant="outline" bg={cardBgColor} p={3} maxH="200px" overflow="auto">
                    <CardBody p={2}>
                      <Text fontSize="sm" whiteSpace="pre-wrap">
                        {originalContent || '无内容'}
                      </Text>
                    </CardBody>
                  </Card>
                </Box>

                {/* 润色目标输入 */}
                <FormControl>
                  <FormLabel fontSize="sm" fontWeight="medium" mb={3}>
                    润色目标
                    <Tooltip label="选择预制目标或自定义要求，多个目标会组合应用">
                      <InfoIcon ml={1} boxSize="12px" color="gray.500" />
                    </Tooltip>
                  </FormLabel>
                  
                  {/* 预制目标选项 */}
                  <Box mb={4}>
                    <Flex justify="space-between" align="center" mb={2}>
                      <Text fontSize="xs" fontWeight="medium" color={grayTextColor}>
                        预制目标 ({selectedPresetGoals.length}/{presetGoals.length})
                      </Text>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={handleSelectAllPresets}
                        colorScheme={selectedPresetGoals.length === presetGoals.length ? "red" : "purple"}
                      >
                        {selectedPresetGoals.length === presetGoals.length ? "取消全选" : "一键全选"}
                      </Button>
                    </Flex>
                    
                    <CheckboxGroup value={selectedPresetGoals} onChange={handlePresetGoalChange}>
                      <SimpleGrid columns={2} spacing={2} maxH="240px" overflow="auto" 
                                  bg={cardBgColor} p={3} borderRadius="md" border="1px solid" borderColor={borderColor}>
                        {presetGoals.map((goal) => (
                          <Checkbox key={goal.value} value={goal.value} size="sm">
                            <VStack align="start" spacing={0}>
                              <Text fontSize="sm" fontWeight="medium">{goal.label}</Text>
                              <Text fontSize="xs" color={grayLightTextColor} lineHeight="1.2">{goal.description}</Text>
                            </VStack>
                          </Checkbox>
                        ))}
                      </SimpleGrid>
                    </CheckboxGroup>
                  </Box>
                  
                  {/* 自定义润色目标 */}
                  <Box>
                    <Text fontSize="xs" fontWeight="medium" color={grayTextColor} mb={2}>
                      自定义目标（可选）
                    </Text>
                    <Textarea
                      placeholder="描述其他润色要求..."
                      value={polishGoal}
                      onChange={(e) => setPolishGoal(e.target.value)}
                      size="sm"
                      resize="vertical"
                      rows={2}
                    />
                  </Box>
                  
                  {/* 目标预览 */}
                  {(selectedPresetGoals.length > 0 || polishGoal.trim()) && (
                    <Box mt={3} p={3} bg={blueBgColor} borderRadius="md" border="1px solid" borderColor={blueBorderColor}>
                      <Text fontSize="xs" fontWeight="medium" color={blueTextColor} mb={1}>
                        当前润色目标：
                      </Text>
                      <Text fontSize="sm" color={blueSubTextColor}>
                        {buildPolishGoalText()}
                      </Text>
                    </Box>
                  )}
                </FormControl>

                {/* 模型选择 */}
                <Box>
                  {modelsLoading ? (
                    <Text fontSize="sm">正在加载模型列表...</Text>
                  ) : (
                    <ModelSelector
                      value={selectedModel}
                      onChange={handleModelChange}
                      availableModels={availableModels}
                      size="sm"
                      showDescription={true}
                      label="选择模型"
                    />
                  )}
                </Box>

                {/* 内容生成语言选择 */}
                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb={3}>
                    内容生成语言
                    <Tooltip label="选择润色后内容的语言">
                      <InfoIcon ml={1} boxSize="12px" color="gray.500" />
                    </Tooltip>
                  </Text>
                  
                  {/* 语言选择器 */}
                  <Box 
                    p={3} 
                    bg={whiteBgColor} 
                    borderRadius="md" 
                    border="1px solid" 
                    borderColor={grayBorderColor}
                  >
                    <RadioGroup 
                      value={selectedLanguage} 
                      onChange={(value: ContentGenerationLanguage) => setSelectedLanguage(value)}
                    >
                      <Stack direction="row" spacing={6}>
                        <Radio value="chinese" size="sm">中文内容</Radio>
                        <Radio value="english" size="sm">英文内容</Radio>
                      </Stack>
                    </RadioGroup>
                    
                    {/* 显示默认设置提示 */}
                    <Box mt={2} pt={2} borderTop="1px solid" borderColor={grayBorderColor}>
                      <HStack spacing={2}>
                        <Icon as={InfoIcon} color="blue.500" boxSize="12px" />
                        <Text fontSize="xs" color={grayTextColor}>
                          参数默认设置：{getContentLanguageFromParams() === 'english' ? '英文内容' : '中文内容'}
                        </Text>
                      </HStack>
                      <Text fontSize="xs" color={grayLightTextColor} mt={1}>
                        可在上方手动选择，或在参数设置中修改默认值
                      </Text>
                    </Box>
                  </Box>
                </Box>

                {/* 开始润色按钮 */}
                <Button
                  colorScheme="purple"
                  isLoading={isLoading}
                  loadingText="并行润色中..."
                  onClick={handlePolish}
                  width="100%"
                  mt={2}
                  disabled={!originalContent?.trim() || (selectedPresetGoals.length === 0 && !polishGoal.trim())}
                >
                  开始润色 (3种风格)
                </Button>
              </VStack>
            </Box>

            {/* 右侧结果展示区域 */}
            <Box width={{ base: '100%', md: '65%' }}>
              <FormLabel fontSize="sm" fontWeight="medium" mb={3}>润色结果</FormLabel>
              {contentSuggestions.length > 0 ? (
                <VStack spacing={4} align="stretch">
                  {contentSuggestions.map((suggestion, index) => {
                    // 根据当前模式和索引确定风格标签
                    let styleLabels, styleColors;
                    
                    if (hasControversialOption(selectedPresetGoals)) {
                      // 故意引战模式的标签
                      styleLabels = ['温和引战', '中等引战', '强势引战'];
                      styleColors = ['orange', 'red', 'purple'];
                    } else if (hasDifferentiationOption(selectedPresetGoals)) {
                      // 差异化模式的标签
                      styleLabels = ['轻度差异化', '中度差异化', '高度差异化'];
                      styleColors = ['cyan', 'teal', 'purple'];
                    } else {
                      // 常规模式的标签
                      styleLabels = ['生动有趣', '专业严谨', '通俗易懂'];
                      styleColors = ['orange', 'blue', 'green'];
                    }
                    
                    const styleLabel = styleLabels[index] || `风格${index + 1}`;
                    const styleColor = styleColors[index] || 'purple';
                    
                    return (
                      <Box
                        key={index}
                        p={4}
                        borderWidth="2px"
                        borderRadius="md"
                        borderColor={selectedContent === suggestion.content ? selectedCardBorderColor : borderColor}
                        bg={selectedContent === suggestion.content ? selectedCardBgColor : cardBgColor}
                        cursor="pointer"
                        transition="all 0.2s"
                        _hover={{ 
                          borderColor: selectedContent === suggestion.content ? selectedCardBorderColor : 'purple.300',
                          transform: 'translateY(-2px)',
                          boxShadow: 'md'
                        }}
                        onClick={() => handleContentSelect(suggestion.content)}
                      >
                        <Flex justify="space-between" align="flex-start" mb={3}>
                          <HStack alignItems="flex-start" spacing={3}>
                            <Badge colorScheme={styleColor} fontSize="sm" mt={1}>{styleLabel}</Badge>
                            <Text fontSize="sm" color={grayTextColor} fontWeight="medium">
                              {suggestion.explanation}
                            </Text>
                          </HStack>
                          {selectedContent === suggestion.content && (
                            <Badge colorScheme="green" fontSize="sm">已选择</Badge>
                          )}
                        </Flex>
                        <Text 
                          fontSize="sm" 
                          whiteSpace="pre-wrap" 
                          maxH="300px" 
                          overflow="auto"
                          bg={whiteBgColor}
                          p={3}
                          borderRadius="md"
                          border="1px solid"
                          borderColor={grayBorderColor}
                        >
                          {suggestion.content}
                        </Text>
                      </Box>
                    );
                  })}
                </VStack>
              ) : (
                <Flex 
                  direction="column" 
                  align="center" 
                  justify="center" 
                  h="400px" 
                  borderWidth="1px" 
                  borderRadius="md" 
                  borderColor={borderColor} 
                  borderStyle="dashed"
                >
                  <Text color={emptyStateTextColor}>选择润色目标后，点击"开始润色"按钮生成3种不同风格的润色方案</Text>
                  <Text color={emptyStateSubTextColor} fontSize="sm" mt={2}>
                    {hasControversialOption(selectedPresetGoals) 
                      ? "将并行生成：温和引战、中等引战、强势引战三种风格"
                      : hasDifferentiationOption(selectedPresetGoals)
                        ? "将并行生成：轻度差异化、中度差异化、高度差异化三种风格"
                        : "将并行生成：生动有趣、专业严谨、通俗易懂三种风格"
                    }
                  </Text>
                </Flex>
              )}
            </Box>
          </Flex>
        </ModalBody>

        <ModalFooter borderTopWidth="1px" borderColor={borderColor} p={4}>
          <Button variant="outline" mr={3} onClick={handleClose}>
            取消
          </Button>
          <Button 
            colorScheme="purple" 
            onClick={handleConfirm}
            isDisabled={!selectedContent}
          >
            确认应用
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ContentPolishModal; 