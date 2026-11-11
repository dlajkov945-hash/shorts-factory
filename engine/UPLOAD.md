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
