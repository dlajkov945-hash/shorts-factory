# Движок motion (моушн-графика из кода)

Стили как в референсах Димы: «ЧТО ЕСЛИ» (тёмный, нумерованные плашки, свечение), HUD-история (крипто/деньги, панель ВРЕМЯ/СЧЁТ/РИСК), светлый UI с маскотом, дудл (бумага, человечки), неон. Всё рисуется кодом на canvas, генерация картинок не нужна (но можно вставлять картинки элементом `image`).

Сборка: `python3 engine/motion.py plans/X.json out/X.mp4` (проверка кадров: добавить `--stills`, кадры в `out/X_motion/stills/`).
Нужен Node + Playwright (в облаке уже стоят). Рендер ~11 кадров/с, ролик 30 сек ≈ 2 мин.

Образцы: `plans/moon_whatif.json` (dark, ЧТО ЕСЛИ), `plans/money_mistake.json` (heist, выбор + призыв).

## План
```json
{"id": "x", "engine": "motion", "theme": "dark|heist|light|doodle|neon",
 "stats": [{"key": "time", "label": "ВРЕМЯ"}, {"key": "risk", "label": "РИСК", "suffix": "%", "bar": true}],  // heist
 "music": "tense|epic|mystery|funny|chill|happy|sad|action", "voice": "eleven|none",
 "scenes": [{"say": "текст с ударе́ниями", "audio": "assets/audio/x/s0.mp3", "hl": ["слово"],
             "tint": "#hex", "sfx": ["boom"], "stats": {"time": "02:14", "risk": 40}, "exit": "whip", "cam": "out",
             "dur": 3.0,          // только для voice: none
             "els": [ ... ]}]}
```
- `hl`: слова, которые в субтитрах всегда цветные (по началу слова).
- `tint`: цвет подсветки фона сцены (плавно меняется).
- `exit: "whip"`: уход сцены сдвигом влево вместо «пролёта» в камеру.

## Ролик без слов и без субтитров
- Без озвучки: `"voice": "none"`, у каждой сцены `"dur": 3.0`, элементы по времени `at`. Музыка автоматически громче.
- Без субтитров при озвучке: `"captions": false`.

## Элемент
Общие поля: `v` (тип), `x`, `y` (0..1 от кадра, по умолчанию 0.5/0.42), `s` (масштаб), `from` (pop|up|down|left|right|drop|slam|fade|none), `at` (сек от начала сцены) или `on` (слово озвучки, элемент появится ровно на нём), `until` / `until_on` (исчезнуть), `exit: "grow"`, `float: true`, `shake: true`, `rot`, `sfx` (звук в момент появления).
Зона картинки: y 0.16…0.62. Субтитры идут на y≈0.69, ниже 0.74 ничего важного (интерфейс YouTube).

Типы:
- `text` {text: "СПАСИБО,\n*ЛУНА*", size} крупный заголовок, *слово* = акцент. Пока виден, субтитры скрыты (кроме keepCaps)
- `chip` {n: "01", text: "ВОДА"} нумерованная плашка (ставить y 0.2)
- `tag` {text: "СРОК ХРАНЕНИЯ|3000+ ЛЕТ"} моно-табличка, последняя часть цветная
- `stamp` {text: "НЕ ВАШИ"} штамп, лучше с from slam
- `bignum` {from, to, suffix, prefix, label, size, dur} счётчик числа
- `versus` {a: {label, value, note}, b: {...}} два числа против
- `bars` {items: [{label, value, text}], hi} сравнение полосами
- `chart` {points: [...], title, price, color} график
- `card` {title, url, rows: ["Слева|справа"], hi, button} окно интерфейса
- `list` {title, rows: ["a|b|c"], hi, hiAt} таблица моно-шрифтом
- `phone` {time, notes: ["Заголовок|текст"], screen} телефон с уведомлениями
- `button` {n, color, size, press (сек после появления) или press_on (слово), press_sfx} большая красная 3D кнопка, светится, на press вдавливается с кольцом-вспышкой (для «нажмёте кнопку?»)
- `choices` {items: [{text, color}]} варианты ответа А/Б/В (для «что бы вы сделали»)
- `grid` {n, cols, size, onFrac, shape: "dot", rise, faces, label} много плиток/точек
- `progress` {from, to, label} полоса с процентами; `timer` {from (сек), dir, label}; `clock` {speed}
- `waves` {amp0, amp1, drop} море, амплитуда меняется
- `city` {dark} ночной город (y = линия земли, ставить 0.62)
- `building` {cols, rows, off, sign} дом с окнами, окна гаснут
- `window`, `door` {knock, light}, `silhouette` {eyes}, `planet` {earth, axis, tilt, wobble, ring}
- `drop`, `jar` {label}, `heart` {bpm, ecg}
- `icon` {name: lock|coin|bolt|question|exclaim|check|cross|warning|fire|moon|sun|eye|key|bell|battery|skull|pill|brain}
- `person` {pose: idle|wave|scared|think|point|happy|walk, color, speak} маленький плоский герой (рот двигается от голоса при speak)
- `mascot` {mood: happy|shock|angry, look} маскот-кристалл канала, говорит голосом озвучки
- `stick` {pose: idle|wave|up|think|point} дудл-человечек (тема doodle)
- `arrow` {dx, dy}, `note` {text, bubble} стикер/облачко
- `battery` {p0, p1 (проценты), dur, charging, pct: false без подписи} большая батарейка телефона, цвет по заряду, мигает ниже 10%. Не путать p0 с from (from = анимация появления!)
- `socket` {} розетка на стене (светится); `plug` {fit: false} низ телефона и штекер снизу, при fit false отскакивает и красный крест, при true заходит и галочка
- `oldphone` {} кнопочный телефон 2000-х: полная батарея и бегущая змейка на экране
- `hang` {mood: calm|strain|happy, shake, fire (руки горят), sweat (капли пота), stretch (тело вытягивается), swing, bw} дудл-турник с висящим человечком, качается; убирать через until_on и ставить `stick` с from drop = «сорвался»
- `wifi` {b0, b1 (палочки 0..3), dur, card: false без белой подложки} значок Wi-Fi, цвет по силе сигнала, при 0 мигает и красный крест
- `loader` {stuck: true дёргается и зависает, done_at: сек → зелёная галочка} кружок загрузки (буферизация)
- `jeans` {hl: watch|rivets, hlAt / hlAt_on, watch: true + watchAt / watchAt_on (карманные часы вылезают из маленького кармана), tear: true (порванный карман)} джинсы спереди, 5 карманов, медные заклёпки
- `pocketwatch` {speed} большие золотые карманные часы с цепочкой, тикают
- `voltmeter` {v0, v1, dur, go (сек) или go_on (слово), max: 450} шкала генератора тока: зоны от зелёной до бордовой, надписи ОПАСНО и XXX, стрелка с искрами и дрожью, цифровое табло «315 В». Для опытов и лестниц выбора с нарастанием
- `shiplock` {level, ship, gA, gB, valve, drain: ключевые кадры [[сек, значение], ...] от начала элемента; flip, color, smoke} шлюз в разрезе (дудл): нижняя река, камера, верхняя река, подъёмные ворота, корабль всплывает с водой, потоки воды при заполнении (valve) и сливе (drain), холмы, ёлки, облака. Ставить y 0.45, from none. Образец plans/ship_lock.json (немой ролик «как устроено», конец закольцован с началом)
- Новые синтезированные звуки (audio.py): splash (плюх в воду), crack (треск льда), water (поток воды 2,5 сек), horn (гудок корабля), creak (скрежет ворот)
- `elevator` {pos (кабина 0 низ..1 верх), cw, cwv (противовес виден 0..1), r1 r2 r3 (тросы: 0 целы, 0.3 перетёрт и мигает, 1 лопнул), brake (клинья), sparks, gov (ограничитель сработал), spd, smoke (мотор перегружен), mood: [[сек, happy|scared|calm|wave]], linear: true; mode: "brake" крупный план клина на рельсе (fall, brake, sparks), mode: "governor" крупный план ограничителя скорости (spd, gov, tripAt)} шахта лифта в разрезе (дудл), все значения ключевыми кадрами [[сек, значение]]. Ставить y 0.47, from none. Образец plans/lift_brake.json
- `lines` {len: [образец, 1, 2, 3], mark (номер верной), markAt / markAt_on, wrong, wrongAt / wrongAt_on, step} карточка теста Аша: образец и три линии
- `crowd` {n, ans (ответ толпы), you (ответ «ВЫ», последний), go / go_on, step, look + lookAt (все смотрят на вас), sweat, ally (номер союзника), allyAns} ряд голов с облачками ответов по очереди. Внимание: ключ `X_on` превращается в `X` = секунды, поэтому для времени писать markAt_on, а не mark_on
- Новые звуки: snap (лопнул трос), screech (скрежет тормоза), motor (гул мотора)
- `v: "sfx"` пустой элемент только для звука в момент `at`
- `image` {src: "assets/img/x/s0.png", w, h, mode: "full", zoom} картинка в карточке или на весь кадр (сюда идут AI-картинки из Figma/ChatGPT). На весь кадр без субтитров (`captions: false` или `clean: true`) затемнение почти убрано, картинка яркая

## Правила качества
- Не перегружать: в сцене одна главная картинка и максимум одна подпись (chip или tag). Подпись «лайков» в углу ставится сама, еле видная; label/brand больше не используются.
- Каждые 2–4 сек на экране что-то новое: элемент на ключевом слове (`on`), звук на каждое появление.
- В сцене 1–3 элемента, не больше. Одна главная картинка по центру.
- Первый кадр (t=0) уже должен быть интересным: элементы первой сцены с `from: "none"`.
- После рендера: контакт-лист `ffmpeg -i out/X.mp4 -vf "fps=1.5,scale=216:-1,tile=8x5" sheet.jpg`, посмотреть глазами: ничего не налезает на субтитры, нет пустых кадров.
