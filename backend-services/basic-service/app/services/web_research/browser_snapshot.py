"""有界 DOM 快照与真实元素句柄；同一脚本任务完成校验和固定动作。"""
import secrets

from app.models.web_research_models import WebResearchError
from .provenance import clip_bytes, display_url
from .safe_http_client import normalize_url

# 不把 observer、epoch 或句柄表暴露到 window；远端引用仅由服务端保存。
SNAPSHOT = r"""() => {
  const state = {epoch: 0, elements: [], records: [], text: '', scanned: 0};
  const visible = e => {const r=e.getBoundingClientRect(), s=getComputedStyle(e);
    return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'};
  const signature = e => ({tag:e.tagName, role:e.getAttribute('role')||'',
    href:e.getAttribute('href')||'', type:e.getAttribute('type')||'',
    label:(e.innerText||e.getAttribute('aria-label')||e.placeholder||'').slice(0,256),
    method:e.form ? e.form.method.toLowerCase() : '',
    action:e.form ? e.form.action : '', disabled:!!e.disabled});
  state.visible=visible; state.signature=signature;
  state.observer=new MutationObserver(() => state.epoch++);
  state.observer.observe(document, {subtree:true, childList:true,
    characterData:true, attributes:true});
  const walker=document.createTreeWalker(document.body||document,
    NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  let node, bytes=0;
  while ((node=walker.nextNode()) && state.scanned++<10000) {
    if (node.nodeType===Node.TEXT_NODE && node.parentElement &&
        !node.parentElement.closest('script,style,noscript,iframe') &&
        visible(node.parentElement) && bytes<2*1024*1024) {
      const value=node.textContent.trim();
      if(value){const part=value.slice(0,32768);state.text+=part+'\n';bytes+=part.length*3}
    }
    if(node.nodeType!==Node.ELEMENT_NODE || state.elements.length>=30 ||
       !visible(node))continue;
    if(node.matches('a[href],button,[role=button],[role=tab],input[type=search],[role=searchbox]')) {
      state.elements.push(node);state.records.push(signature(node));
    }
  }
  state.truncated=!!node;
  state.title=document.title.slice(0,512);
  return state;
}"""

PERFORM = r"""(state, a) => {
  const stale=() => ({error:'stale_element'});
  if(state.observer.takeRecords().length)state.epoch++;
  if(state.epoch!==a.epoch)return stale();
  if(a.action==='scroll'){window.scrollBy(0,a.delta_y);return {ok:true}}
  const e=a.element;
  if(!e || !e.isConnected || !state.visible(e) ||
     JSON.stringify(state.signature(e))!==JSON.stringify(a.signature))return stale();
  const tag=e.tagName, role=e.getAttribute('role')||'', type=(e.type||'').toLowerCase();
  const blocked=() => ({error:'browser_action_blocked'});
  const label=[e.innerText,e.name,e.id,e.getAttribute('aria-label')].join(' ');
  if(e.disabled || /pay|purchase|checkout|付款|支付|购买/i.test(label) ||
     ['password','file','submit','image'].includes(type))return blocked();
  if(a.action==='click') {
    if(!(tag==='A'||tag==='BUTTON'||['button','tab'].includes(role)))return blocked();
    if(e.hasAttribute('download') || (e.form && type!=='button'))return blocked();
    if(tag==='A' && !/^https?:$/.test(new URL(e.href).protocol))return blocked();
    e.click();return {ok:true};
  }
  if(!((tag==='INPUT' && type==='search') ||
       (role==='searchbox' && ['INPUT','TEXTAREA'].includes(tag))))return blocked();
  if(e.form && (e.form.method.toLowerCase()!=='get' ||
      e.form.querySelector('input[type=password],input[type=file]')))return blocked();
  if(a.action==='fill') {
    const proto=tag==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(e,a.text);
    e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};
  }
  if(a.action==='press' && a.key==='Enter') {
    if(e.form && e.form.action!==a.form_action)return stale();
    const accepted=e.dispatchEvent(new KeyboardEvent('keydown',
      {key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
    e.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));
    if(accepted && e.form)e.form.requestSubmit();return {ok:true};
  }
  return blocked();
}"""


class BrowserSnapshot:
    def __init__(self):
        self.version = 0
        self.state = None
        self.refs = {}
        self.epoch = 0

    async def invalidate(self):
        self.version += 1
        state, refs = self.state, self.refs
        self.state, self.refs = None, {}
        if state:
            try:
                await state.evaluate('(s) => s.observer.disconnect()')
                await state.dispose()
            except Exception:
                pass  # 导航/关闭已销毁旧 JS context。
        for handle, _ in refs.values():
            try:
                await handle.dispose()
            except Exception:
                pass

    async def capture(self, page, max_bytes):
        await self.invalidate()
        self.state = await page.evaluate_handle(SNAPSHOT)
        values = await self.state.evaluate(
            '(s) => ({epoch:s.epoch,records:s.records,text:s.text,'
            'title:s.title,truncated:s.truncated})')
        self.epoch = values['epoch']
        elements = await self.state.get_property('elements')
        properties = await elements.get_properties()
        await elements.dispose()
        entries = []
        for index, record in enumerate(values['records']):
            handle = properties[str(index)].as_element()
            identifier = secrets.token_urlsafe(18)
            self.refs[identifier] = (handle, record)
            entries.append({'element_ref': identifier,
                            'tag': record['tag'].lower(),
                            'role': record['role'],
                            'text': clip_bytes(record['label'], 180),
                            'href': display_url(record['href'])})
        return {'title': values['title'], 'content': clip_bytes(
                    values['text'], min(8000, max_bytes)),
                'full_text': clip_bytes(values['text'], 2 * 1024 * 1024),
                'elements': entries, 'snapshot_version': self.version,
                'truncated': values['truncated'] or
                len(values['text'].encode()) > max_bytes}

    async def perform(self, request):
        if request.get('snapshot_version') != self.version or not self.state:
            raise WebResearchError('stale_element')
        action = request.get('action')
        args = {'action': action, 'epoch': self.epoch}
        if action == 'scroll':
            delta = request.get('delta_y')
            if isinstance(delta, bool) or not isinstance(delta, int) or abs(delta) > 1440:
                raise WebResearchError('browser_action_blocked')
            args['delta_y'] = delta
        else:
            entry = self.refs.get(request.get('element_ref'))
            if not entry:
                raise WebResearchError('stale_element')
            handle, signature = entry
            args.update(element=handle, signature=signature,
                        text=request.get('text', ''), key=request.get('key'))
            if action == 'fill' and len(args['text']) > 256:
                raise WebResearchError('browser_action_blocked')
            if action == 'press' and signature['action']:
                normalize_url(signature['action'])
                args['form_action'] = signature['action']
        result = await self.state.evaluate(PERFORM, args)
        if result.get('error'):
            await self.invalidate()
            raise WebResearchError(result['error'])
        await self.invalidate()
