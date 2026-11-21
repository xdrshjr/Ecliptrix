// 先按 analysis.md 启动验收页服务，再用 ego-browser nodejs 加载此文件。
// 外部 HTTP 已由页面隔离；仅操作本脚本创建的浏览器任务空间。
const task=await taskSpace('脚本卡方案A回归复跑');
const page=task.page('p1');
console.log({taskSpaceId:task.spaceId,page:page.label});
await page.goto('http://127.0.0.1:5179/docs/diagnoses/script-segment-menu-and-voice-availability/repro-menu.html',{timeout:30000});
console.log(await page.snapshot());
await page.click('text="宽度280"');
await page.click('text="模拟Agent音频入库"');
await page.waitForSelector('text="配音已生成"');
await page.click('text="使配音过期"');
await page.waitForSelector('text="配音待更新"');
await page.click('button[aria-label="更多操作"]');
const result=await page.evaluate(()=>{
 const trigger=document.querySelector('.segment-card__head button[aria-haspopup="menu"]');
 const menu=document.querySelector('[role="menu"]');
 const rect=menu.getBoundingClientRect();
 return {trigger:trigger.getBoundingClientRect().toJSON(),menu:rect.toJSON(),
  coveredBySidebar:document.querySelector('.vertical-taskbar').contains(document.elementFromPoint(rect.left+4,rect.top+14)),
  replaceDisabled:document.querySelector('.segment-card__actions button:last-child').disabled,
  aiReason:document.querySelector('[data-menu-key="ai-match"]').title};
});
const {default:assert}=await import('node:assert/strict');
assert.ok(Math.abs(result.menu.left-result.trigger.right-4)<1,'菜单应优先向右展开');
assert.equal(result.coveredBySidebar,false,'菜单不得被侧栏遮挡');
assert.equal(result.replaceDisabled,false,'旧配音仍应允许更换画面');
assert.notEqual(result.aiReason,'请先完成语音转换');
await page.evaluate(()=>window.verification.layout.previewSize('left',320));
await page.waitForFunction(()=>{
 const trigger=document.querySelector('.segment-card__head button[aria-haspopup="menu"]').getBoundingClientRect();
 const menu=document.querySelector('[role="menu"]').getBoundingClientRect();
 return trigger.left>300 && Math.abs(trigger.right+4-menu.left)<1;
});
await page.press('[role="menu"]','Escape');
assert.equal(await page.evaluate(()=>document.activeElement.matches('.segment-card__head button[aria-haspopup="menu"]')),true);
await page.click('button[aria-label="长菜单"]');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:320,deviceScaleFactor:1,mobile:false});
await page.waitForFunction(()=>Math.abs(document.querySelector('[role="menu"]').getBoundingClientRect().height-304)<1);
await page.press('[role="menu"]','End');
const lastVisible=await page.evaluate(()=>{
 const item=document.activeElement.getBoundingClientRect(),menu=document.querySelector('[role="menu"]').getBoundingClientRect();
 return item.top>=menu.top && item.bottom<=menu.bottom;
});
assert.equal(lastVisible,true,'长菜单末项应可见');
await page.press('[role="menu"]','Escape');
await page.cdp('Emulation.clearDeviceMetricsOverride');
console.log({result,longMenuLastVisible:lastVisible,checks:'通过'});
console.log(await page.snapshot());
// 检查完预览后，在单独一轮执行 taskSpace(上方ID).finish({keep:[]}) 关闭。
