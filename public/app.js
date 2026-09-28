const $ = selector => document.querySelector(selector);
const elements = {
  historyList: $('#historyList'), emptyHistory: $('#emptyHistory'), clearHistory: $('#clearHistory'),
  newChat: $('#newChatButton'), messageList: $('#messageList'), welcome: $('#welcomeState'),
  loading: $('#loadingRow'), question: $('#question'), ask: $('#askButton'), counter: $('#counter'),
  inputError: $('#inputError'), chatTitle: $('#chatTitle'), chatKicker: $('#chatKicker'),
  theme: $('#themeToggle'), apiButton: $('#apiStatusButton'), modeText: $('#modeText'),
  apiDialog: $('#apiDialog'), apiInput: $('#apiKeyInput'), apiError: $('#apiKeyError'),
  apiSave: $('#saveApiKey'), apiVisibility: $('#toggleKeyVisibility'), toast: $('#toast'),
  mobileMenu: $('#mobileMenu'), mobileClose: $('#mobileClose'), sidebar: $('.sidebar'), backdrop: $('#sidebarBackdrop')
};

const CHAT_KEY = 'micro-helper-chats-v2';
const THEME_KEY = 'micro-helper-theme';
const MODE_LABELS = { decision: 'Решение', meeting: 'Встреча', risks: 'Риски', writing: 'Текст' };
let chats = loadChats();
let currentChatId = chats[0]?.id || '';
let draftMode = 'decision';
let apiKey = '';
let sending = false;

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_KEY));
    if (Array.isArray(saved)) return saved;
    const legacy = JSON.parse(localStorage.getItem('micro-helper-history-v1')) || [];
    return legacy.slice(0, 5).map((item, index) => ({
      id: item.id || `legacy-${index}-${item.createdAt}`,
      title: item.question.slice(0, 48), mode: item.workMode || 'decision', updatedAt: item.createdAt,
      messages: [
        { role: 'user', content: item.question },
        ...(item.answer ? [{ role: 'assistant', content: item.answer, apiMode: item.apiMode || item.mode }] : [])
      ]
    }));
  } catch { return []; }
}

function saveChats() {
  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  chats = chats.slice(0, 5);
  localStorage.setItem(CHAT_KEY, JSON.stringify(chats));
}

function currentChat() { return chats.find(chat => chat.id === currentChatId); }
function escapeHtml(value) { return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
function formatTime(timestamp) { return new Intl.DateTimeFormat('ru', { hour:'2-digit', minute:'2-digit' }).format(new Date(timestamp)); }

function renderMarkdown(markdown) {
  const html = escapeHtml(markdown)
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/_(.+?)_/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>');
  const out=[]; let list=false;
  html.split('\n').forEach(line => {
    const bullet=line.match(/^[-•*] (.+)/);
    if (bullet) { if(!list){out.push('<ul>');list=true;} out.push(`<li>${bullet[1]}</li>`); return; }
    if(list){out.push('</ul>');list=false;} if(!line.trim())return;
    out.push(/^<(h2|h3|blockquote)/.test(line)?line:`<p>${line}</p>`);
  });
  if(list)out.push('</ul>'); return out.join('');
}

function renderChatList() {
  elements.historyList.innerHTML='';
  elements.emptyHistory.hidden=chats.length>0;
  elements.clearHistory.hidden=chats.length===0;
  chats.forEach(chat => {
    const button=document.createElement('button');
    button.type='button'; button.className=`chat-item${chat.id===currentChatId?' active':''}`;
    button.innerHTML=`<strong>${escapeHtml(chat.title||'Новый диалог')}</strong><span><b>${MODE_LABELS[chat.mode]||'Диалог'}</b><time>${formatTime(chat.updatedAt)}</time></span>`;
    button.addEventListener('click',()=>{currentChatId=chat.id;draftMode=chat.mode;renderAll();closeSidebar();});
    elements.historyList.appendChild(button);
  });
}

function messageElement(message,index) {
  const row=document.createElement('article'); row.className=`message-row ${message.role}`;
  if(message.role==='user') {
    row.innerHTML=`<div class="message-content">${escapeHtml(message.content)}</div>`;
  } else {
    row.innerHTML=`<div class="avatar">✦</div><div class="assistant-block"><div class="assistant-label"><strong>micro helper</strong><button class="copy-message" type="button" data-copy="${index}">Копировать</button></div><div class="message-content assistant-content">${renderMarkdown(message.content)}</div></div>`;
  }
  return row;
}

function renderMessages() {
  const chat=currentChat();
  elements.messageList.innerHTML='';
  if(!chat || !chat.messages.length) {
    elements.messageList.appendChild(elements.welcome);
    elements.welcome.hidden=false;
    elements.chatTitle.textContent='Без названия'; elements.chatKicker.textContent='НОВЫЙ ДИАЛОГ';
    return;
  }
  elements.welcome.hidden=true;
  chat.messages.forEach((message,index)=>elements.messageList.appendChild(messageElement(message,index)));
  elements.chatTitle.textContent=chat.title; elements.chatKicker.textContent=`${MODE_LABELS[chat.mode].toUpperCase()} · ${chat.messages.length} СООБЩЕНИЙ`;
  requestAnimationFrame(()=>{elements.messageList.scrollTop=elements.messageList.scrollHeight;});
}

function setMode(mode) {
  draftMode=mode;
  document.querySelectorAll('.mode-tab').forEach(tab=>{const active=tab.dataset.mode===mode;tab.classList.toggle('active',active);tab.setAttribute('aria-checked',String(active));});
  const chat=currentChat(); if(chat){chat.mode=mode;chat.updatedAt=Date.now();saveChats();renderChatList();elements.chatKicker.textContent=`${MODE_LABELS[mode].toUpperCase()} · ${chat.messages.length} СООБЩЕНИЙ`;}
}

function renderAll() { const chat=currentChat(); setMode(chat?.mode||draftMode); renderChatList(); renderMessages(); }

function createChat() {
  currentChatId=''; draftMode='decision'; elements.question.value=''; resizeComposer(); renderAll(); elements.question.focus();
}

function ensureChat(firstMessage) {
  let chat=currentChat();
  if(!chat) {
    chat={id:`chat-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,title:firstMessage.slice(0,48),mode:draftMode,updatedAt:Date.now(),messages:[]};
    chats.unshift(chat); currentChatId=chat.id;
  }
  return chat;
}

async function sendMessage(prefill='') {
  if(sending)return;
  const text=(prefill||elements.question.value).trim();
  if(text.length<2){elements.inputError.textContent='Напишите хотя бы пару слов';elements.question.focus();return;}
  const chat=ensureChat(text); chat.messages.push({role:'user',content:text}); chat.updatedAt=Date.now(); chat.mode=draftMode;
  elements.question.value=''; resizeComposer(); saveChats(); renderAll(); setSending(true);
  try {
    const context=chat.messages.slice(-18).map(({role,content})=>({role,content}));
    const response=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:context,mode:chat.mode,apiKey})});
    const data=await response.json(); if(!response.ok)throw new Error(data.error||'Не удалось получить ответ');
    chat.messages.push({role:'assistant',content:data.answer,apiMode:data.mode}); chat.updatedAt=Date.now();
    saveChats(); renderAll();
    if(data.mode==='live')setConnection('Groq подключён',true);
  } catch(error) { elements.inputError.textContent=error.message; showToast('Ответ не получен — сообщение осталось в чате'); }
  finally { setSending(false); }
}

function setSending(value){sending=value;elements.ask.disabled=value;elements.loading.hidden=!value;if(value)requestAnimationFrame(()=>elements.loading.scrollIntoView({behavior:'smooth',block:'end'}));}
function resizeComposer(){elements.question.style.height='auto';elements.question.style.height=`${Math.min(elements.question.scrollHeight,150)}px`;elements.counter.textContent=`${elements.question.value.length} / 1000 · ⌘ Enter`;elements.inputError.textContent='';}
function setConnection(label,connected){elements.modeText.textContent=label;elements.apiButton.classList.toggle('connected',connected);}
function showToast(text){elements.toast.textContent=text;elements.toast.classList.add('show');setTimeout(()=>elements.toast.classList.remove('show'),1700);}

function setTheme(theme){document.documentElement.dataset.theme=theme;const dark=theme==='dark';elements.theme.setAttribute('aria-pressed',String(dark));$('.theme-icon').textContent=dark?'☀':'☾';localStorage.setItem(THEME_KEY,theme);}
function openSidebar(){elements.sidebar.classList.add('open');elements.backdrop.hidden=false;elements.backdrop.classList.add('show');}
function closeSidebar(){elements.sidebar.classList.remove('open');elements.backdrop.classList.remove('show');elements.backdrop.hidden=true;}

async function connectApiKey(){
  const candidate=elements.apiInput.value.trim(); if(candidate.length<20){elements.apiError.textContent='Ключ выглядит слишком коротким.';return;}
  elements.apiSave.disabled=true;elements.apiSave.textContent='Проверяю…';elements.apiError.textContent='';
  try{const response=await fetch('/api/validate-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:candidate})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Ключ не прошёл проверку');apiKey=candidate;elements.apiInput.value='';elements.apiDialog.close();setConnection('Groq готов',true);showToast('Groq подключён к этой вкладке');}
  catch(error){elements.apiError.textContent=error.message;}finally{elements.apiSave.disabled=false;elements.apiSave.textContent='Подключить';}
}

elements.newChat.addEventListener('click',()=>{createChat();closeSidebar();});
elements.clearHistory.addEventListener('click',()=>{chats=[];currentChatId='';localStorage.removeItem(CHAT_KEY);renderAll();});
elements.ask.addEventListener('click',()=>sendMessage());
elements.question.addEventListener('input',resizeComposer);
elements.question.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();sendMessage();}});
document.querySelectorAll('.mode-tab').forEach(tab=>tab.addEventListener('click',()=>setMode(tab.dataset.mode)));
document.querySelectorAll('.starter-grid button').forEach(button=>button.addEventListener('click',()=>{setMode(button.dataset.mode);sendMessage(button.dataset.question);}));
elements.messageList.addEventListener('click',async event=>{const button=event.target.closest('[data-copy]');if(!button)return;const message=currentChat()?.messages[Number(button.dataset.copy)];if(!message)return;try{await navigator.clipboard.writeText(message.content);showToast('Ответ скопирован');}catch{showToast('Не удалось скопировать');}});
elements.theme.addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
elements.apiButton.addEventListener('click',()=>{elements.apiError.textContent='';elements.apiDialog.showModal();setTimeout(()=>elements.apiInput.focus(),50);});
elements.apiSave.addEventListener('click',connectApiKey);elements.apiInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();connectApiKey();}});
elements.apiVisibility.addEventListener('click',()=>{const hidden=elements.apiInput.type==='password';elements.apiInput.type=hidden?'text':'password';elements.apiVisibility.setAttribute('aria-label',hidden?'Скрыть ключ':'Показать ключ');});
elements.mobileMenu.addEventListener('click',openSidebar);elements.mobileClose.addEventListener('click',closeSidebar);elements.backdrop.addEventListener('click',closeSidebar);

setTheme(localStorage.getItem(THEME_KEY)||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'));
setConnection('Подключить Groq',false);renderAll();resizeComposer();
