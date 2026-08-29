const $ = s => document.querySelector(s);
let tabs = [], bookmarks = [], downloads = [], popoverTimer;
const chars = ['◌', '◈', '✦', '◒', '☼'];
const esc = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const activeTab = () => tabs.find(t => t.active);
function applyTheme(settings){const dark=settings.theme==='dark'||(settings.theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.body.classList.toggle('theme-dark',dark)}
window.oryn.getSettings().then(applyTheme); window.oryn.onSettings(applyTheme);
function faviconFor(t){return typeof t?.favicon==='string' ? t.favicon : ''}
function render() {
    const active = activeTab();
    const privateMode = Boolean(active?.private);
    document.body.classList.toggle('private-mode', privateMode);
    $('#url').value = active?.url || '';
    $('#url').placeholder = privateMode ? 'Private tab · Search or enter URL...' : 'Search or enter URL...';
    $('#page-context').textContent = `${privateMode ? 'Private · ' : ''}${active?.title || 'New Tab'}`;
    const marked = Boolean(active?.url && bookmarks.some(b => b.url === active.url));
    $('#bookmark').textContent = marked ? '★' : '☆';
    $('#bookmark').title = marked ? 'Remove bookmark' : 'Bookmark this page';
    $('#tabs').innerHTML = tabs.map((t, i) => `<button class="tab ${t.active ? 'active' : ''}" data-id="${esc(t.id)}" title="${esc(t.title || 'New tab')}" draggable="true"><i class="char ${t.active ? 'awake' : ''}">${t.loading ? '<span class="loading-char">✦</span>' : (faviconFor(t) ? `<img src="${esc(faviconFor(t))}" alt=\"\">` : chars[i % chars.length])}</i><span>${t.private ? '◐ ' : ''}${esc(t.title || 'New tab')}</span><em data-close="${esc(t.id)}">×</em></button>`).join('');
}
function closePopover(){ $('#popover').classList.add('hidden'); $('#popover').innerHTML=''; }
function showBookmarks(){ closePopover(); }
function updateDownloadIndicator(items=downloads){
    const badge=$('#download-badge');
    if (!badge) return;
    const activeDownload=items.some(d=>['started','progressing','paused'].includes(d.state));
    badge.classList.toggle('hidden', !activeDownload);
}
async function showDownloads(){
    const panel=$('#popover'); downloads=await window.oryn.getDownloads(); updateDownloadIndicator();
    panel.className='popover downloads-popover';
    panel.innerHTML='<div class="popover-head"><b>Downloads</b><button id="local-popover-close" aria-label="Close downloads">×</button></div><div class="popover-body">'+(downloads.length?downloads.slice(0,12).map(d=>`<div class="popover-item download-item"><span class="download-name"><b>${esc(d.filename)}</b><small>${d.private?'Private · ':''}${esc(d.state)}${d.total?` · ${Math.round((d.received||0)/d.total*100)}%`:''}</small></span>${d.state==='started'||d.state==='progressing'||d.state==='paused'?`<span class="download-actions"><button class="mini" data-download-action="${esc(d.id)}" data-action="${d.state==='paused'?'resume':'pause'}">${d.state==='paused'?'Resume':'Pause'}</button><button class="mini" data-download-action="${esc(d.id)}" data-action="cancel">Cancel</button></span>`:d.path?`<span class="download-actions"><button class="mini" data-reveal-download="${esc(d.id)}">Show</button><button class="mini" data-open-download="${esc(d.id)}">Open</button></span>`:''}</div>`).join(''):'<p class="empty">Your downloaded files will appear here.</p>')+'</div>';
    panel.classList.remove('hidden'); $('#local-popover-close').onclick=closePopover;
    panel.onclick=e=>{const action=e.target.closest('[data-download-action]');if(action){window.oryn.downloadAction(action.dataset.downloadAction,action.dataset.action);return}const reveal=e.target.closest('[data-reveal-download]');if(reveal)window.oryn.revealDownload(reveal.dataset.revealDownload);const open=e.target.closest('[data-open-download]');if(open)window.oryn.openDownload(open.dataset.openDownload)};
}
window.oryn.onState(s => { tabs=s; render(); });
window.oryn.state().then(s => { tabs=s; render(); });
window.oryn.getBookmarks().then(v => { bookmarks=v; render(); });
window.oryn.getDownloads().then(v => { downloads=Array.isArray(v)?v:[]; updateDownloadIndicator(); });
window.oryn.onDownloads(v => { downloads=Array.isArray(v)?v:[]; updateDownloadIndicator(); if (!$('#popover').classList.contains('hidden')) showDownloads(); });
$('#new').onclick = () => { closePopover(); window.oryn.newTab(); };
$('#private-new').onclick = () => { closePopover(); window.oryn.newPrivateTab(); };
$('#back').onclick = () => window.oryn.back(); $('#forward').onclick = () => window.oryn.forward(); $('#reload').onclick = () => window.oryn.reload();
$('#tabs').onclick = e => { const c=e.target.closest('[data-close]'); if(c){e.stopPropagation();return window.oryn.close(c.dataset.close)} const t=e.target.closest('[data-id]'); if(t) window.oryn.activate(t.dataset.id); };
$('#tabs').addEventListener('dragstart', e => { const t=e.target.closest('[data-id]'); if(t) e.dataTransfer.setData('text/plain',t.dataset.id); });
$('#tabs').addEventListener('dragover', e => { if(e.target.closest('[data-id]')) e.preventDefault(); });
$('#tabs').addEventListener('drop', e => { e.preventDefault(); const target=e.target.closest('[data-id]'); const from=e.dataTransfer.getData('text/plain'); if(target && from) window.oryn.reorderTabs(from,target.dataset.id); });
$('#history').onclick = () => { closePopover(); window.oryn.newTab('oryn://history'); }; $('#settings').onclick = () => { closePopover(); window.oryn.newTab('oryn://settings'); };
$('#downloads').onclick = e => { e.preventDefault(); e.stopPropagation(); showDownloads(); };
$('#form').onsubmit = e => { e.preventDefault(); closePopover(); window.oryn.navigate($('#url').value); };
$('#bookmark').onclick = async () => { const t=activeTab(); if(!t?.url)return; bookmarks=await window.oryn.toggleBookmark({url:t.url,title:t.title,favicon:t.favicon}); render(); };
const quickUrl=$('#quick-url'), quickInput=$('#quick-url-input'); function openQuickUrl(){quickUrl.classList.remove('hidden');quickInput.value=activeTab()?.url||'';quickInput.focus();quickInput.select()} function closeQuickUrl(){quickUrl.classList.add('hidden')}
quickInput.addEventListener('keydown',e=>{if(e.key==='Escape')closeQuickUrl();if(e.key==='Enter'){e.preventDefault();window.oryn.navigate(quickInput.value);closeQuickUrl()}}); document.addEventListener('keydown',e=>{const mod=e.metaKey||e.ctrlKey;const key=e.key.toLowerCase();if(mod&&key==='t'){e.preventDefault();window.oryn.newTab()}else if(mod&&key==='w'){e.preventDefault();const t=activeTab();if(t)window.oryn.close(t.id)}else if(mod&&e.shiftKey&&key==='k'){e.preventDefault();const t=activeTab();if(t)window.oryn.duplicateTab(t.id)}else if(mod&&e.shiftKey&&key==='p'){e.preventDefault();window.oryn.newPrivateTab()}else if(mod&&key==='l'){e.preventDefault();openQuickUrl()}if(e.key==='Escape')closePopover()});
document.addEventListener('click', e => { if(!e.target.closest('.chrome-actions') && !e.target.closest('#popover')) closePopover(); });
