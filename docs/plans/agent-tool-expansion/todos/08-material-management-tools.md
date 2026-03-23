# TODO 08: 素材管理工具

**Spec**: `specs/08-material-management-tools.md`

## Dependencies
- **depends_on**: [01, 02] (需要 ToolRegistry + materialStore)
- **blocks**: [09, 11]
- **parallel_group**: B

## Tasks

- [ ] 实现 `tools/addMaterialToLibrary.ts` — add_material_to_library 工具
  - [ ] 参数 schema (url, name, type, metadata)
  - [ ] Handler: 验证 URL → 创建 MaterialItem → materialStore.addMaterial()
  - [ ] 返回素材信息
- [ ] 实现 `tools/removeMaterial.ts` — remove_material 工具
  - [ ] 参数 schema (material_id)
  - [ ] Handler: 检查存在 → materialStore.removeMaterial()
  - [ ] 时间线引用检查 + 提示
- [ ] 在 `categories.ts` 中注册 material_tools 类别
