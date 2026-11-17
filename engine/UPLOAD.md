# Загрузка в YouTube Studio через встроенный браузер Мака (Claude_Browser)

Проверено 11.11.2026. Канал UClKCN5Qn0VD62zDcblwy21g. Часовой пояс в Studio GMT+5.

1. Ролик должен лежать в репо `videos/<file>.mp4` и быть запушен (raw.githubusercontent.com отдаёт с CORS).
2. `Claude_Browser__navigate` → `https://studio.youtube.com/channel/UClKCN5Qn0VD62zDcblwy21g/videos/upload?d=ud`, подождать 3 с.
   Если видно страницу входа Google: НЕ вводить пароль, пуш Диме «YouTube просит войти, открой Мак и войди в аккаунт».
3. Передать файл перетаскиванием (событие change на input НЕ работает, работает drop):
```js
const b = await (await fetch('https://raw.githubusercontent.com/dlajkov945-hash/shorts-factory/main/videos/FILE.mp4')).blob();
const f = new File([b], 'FILE.mp4', {type:'video/mp4'}); const dt = new DataTransfer(); dt.items.add(f);
const tgt = document.querySelector('ytcp-uploads-dialog');
for (const t of ['dragenter','dragover','drop']) tgt.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt}));
```
4. Название и описание:
```js
const setBox=(el,txt)=>{el.focus();document.execCommand('selectAll',false,null);document.execCommand('insertText',false,txt);el.dispatchEvent(new Event('input',{bubbles:true}));};
const [t,d]=[...document.querySelectorAll('ytcp-uploads-dialog #textbox[contenteditable=true]')];
setBox(t,'НАЗВАНИЕ'); setBox(d,'ОПИСАНИЕ');
```
5. Не для детей: `document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').click()`
6. Далее ×3: `document.querySelector('ytcp-uploads-dialog #next-button').click()` с паузой 1,5 с.
7. Расписание: `document.querySelector('ytcp-uploads-dialog #second-container-expand-button').click()`.
   Дата: клик по выпадашке даты в ytcp-datetime-picker, ввести дату. Время: triple_click по полю времени (скриншот, поле справа от даты), напечатать `13:00`, Enter. Проверить `ytcp-datetime-picker input` value.
8. `document.querySelector('ytcp-uploads-dialog #done-button').click()` (кнопка «Запланировать публикацию»), закрыть окно «Проверка ещё продолжается» кнопкой ОК.
9. Проверить на странице `.../videos/short`: ролик есть один раз со статусом «Отложенная публикация».

## Поправки 11.11.2026 (вечер), когда панель браузера скрыта
- Drop перестал срабатывать, работает `input[type=file]` в `ytcp-uploads-file-picker`: `inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}))`, ждать появления #textbox.
- execCommand не работает (страница без фокуса). Название и описание: `Claude_Browser__find "textbox"` → `form_input` по ref (обычно ref_237 и ref_260).
- Дата: клик по `#datepicker-trigger`, в календаре кликнуть число мышью (скриншот, ряд текущей недели). Время: `find "00:00"` → `form_input` "13:00", потом в JS keydown Enter + change + blur на input. Проверять `#datepicker-trigger` innerText и input value.
- Кнопку ОК в окне «Проверка ещё продолжается» искать по тексту `ОК` среди видимых ytcp-button.

## Проверенный способ 17.11.2026 (работает, 8 роликов подряд)
- НЕ уходить со страницы, пока ролики грузятся (загрузка идёт из вкладки). Новый ролик открывать через меню «Создать» → «Добавить видео», а не переходом по ссылке.
- Название и описание снова работают через execCommand (как в п.4).
- Дата: клик по `#datepicker-trigger`, в `ytcp-date-picker` кликнуть первый элемент с текстом числа (ноябрь идёт первым, потом декабрь).
- Время: form_input и печать НЕ сохраняют значение («Указать время в прошлом нельзя»). Работает: клик по полю времени открывает список, кликнуть `tp-yt-paper-item` с текстом `13:00` или `20:00`.
- Перед «Запланировать» закрыть всплывашку «Помогите нам улучшить проверки» кнопкой «Не сейчас», потом ОК в «Проверка ещё продолжается», потом «Закрыть».
Готовая функция (вставить один раз на страницу, дальше вызывать `await window.__all(файл, название, описание, число, 'ЧЧ:ММ')`):
```js
window.__open=async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));let f=()=>[...document.querySelectorAll('tp-yt-paper-item,[role=menuitem],ytcp-text-menu *')].find(e=>e.offsetParent&&/^\s*Добавить видео\s*$/.test(e.innerText||''));let it=f();if(!it){document.querySelector('button[aria-label="Создать"]').click();await sl(1000);it=f();}if(!it)return false;it.click();await sl(1500);return !!document.querySelector('ytcp-uploads-file-picker input[type=file]');};
window.__up=async(file,title,desc,day)=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));if(!(await window.__open()))return'no dialog';const b=await(await fetch('https://raw.githubusercontent.com/dlajkov945-hash/shorts-factory/main/videos/'+file)).blob();const dt=new DataTransfer();dt.items.add(new File([b],file,{type:'video/mp4'}));const inp=document.querySelector('ytcp-uploads-file-picker input[type=file]');inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));for(let i=0;i<40;i++){if(document.querySelector('ytcp-uploads-dialog #textbox[contenteditable=true]'))break;await sl(1000);}await sl(1500);const setBox=(el,txt)=>{el.focus();document.execCommand('selectAll',false,null);document.execCommand('insertText',false,txt);el.dispatchEvent(new Event('input',{bubbles:true}));};const[t,d]=[...document.querySelectorAll('ytcp-uploads-dialog #textbox[contenteditable=true]')];setBox(t,title);setBox(d,desc);document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').click();for(let i=0;i<3;i++){await sl(1500);document.querySelector('ytcp-uploads-dialog #next-button').click();}await sl(2000);document.querySelector('ytcp-uploads-dialog #second-container-expand-button').click();await sl(1500);document.querySelector('ytcp-uploads-dialog #datepicker-trigger').click();await sl(1200);const leaves=[...document.querySelector('ytcp-date-picker').querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()===String(day));(leaves[0].closest('[role=button],.calendar-day,td,div')||leaves[0]).click();await sl(800);return{size:b.size,title:t.innerText,date:document.querySelector('ytcp-uploads-dialog #datepicker-trigger')?.innerText};};
window.__time=async(hh)=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('ytcp-uploads-dialog ytcp-datetime-picker input').click();await sl(800);const o=[...document.querySelectorAll('tp-yt-paper-item')].find(e=>e.innerText.trim()===hh);if(!o)return'no option';o.scrollIntoView({block:'center'});o.click();await sl(800);return document.querySelector('ytcp-uploads-dialog ytcp-datetime-picker input').value;};
window.__done=async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms));[...document.querySelectorAll('button,ytcp-button,tp-yt-paper-button')].filter(b=>b.offsetParent&&/^\s*Не сейчас\s*$/.test(b.innerText)).forEach(b=>b.click());const dn=document.querySelector('ytcp-uploads-dialog #done-button');if(dn.hasAttribute('disabled')||dn.getAttribute('aria-disabled')==='true')return'done disabled';dn.click();await sl(2500);for(let i=0;i<10;i++){const ok=[...document.querySelectorAll('ytcp-button,button,tp-yt-paper-button')].filter(b=>b.offsetParent&&/^\s*(ОК|OK)\s*$/.test(b.innerText));if(ok.length){ok.forEach(b=>b.click());break;}await sl(800);}await sl(2500);const c=[...document.querySelectorAll('ytcp-dialog,tp-yt-paper-dialog')].filter(d=>d.offsetParent).map(d=>d.innerText.replace(/\s+/g,' ').slice(0,160)).join(' | ');[...document.querySelectorAll('ytcp-button,button')].filter(b=>b.offsetParent&&/^\s*Закрыть\s*$/.test(b.innerText)).forEach(b=>b.click());return c;};
window.__all=async(file,title,desc,day,hh)=>{const a=await window.__up(file,title,desc,day);if(typeof a==='string')return a;const tm=await window.__time(hh);const c=await window.__done();return{a,tm,c:c.slice(-200)};};
```
- Если какое-то время не сработало: в результате `tm` не равно нужному времени, проверить скриншотом и выставить вручную по списку.
