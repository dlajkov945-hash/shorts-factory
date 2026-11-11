# Библиотека музыки и звуков (ElevenLabs Sound Effects, своё, без авторских прав)

Музыка: 30-секундные бесшовные петли, движок сам зацикливает под длину ролика. В плане `"music": "<имя>"`.
| имя | что звучит |
|---|---|
| mystery | тёмные синты, пульсирующий бас, тиканье (тайны, «что если») |
| funny | пиццикато, укулеле, хлопки (смешное, бытовые ситуации) |
| epic | тайко, медь, струнные (рекорды, история, масштаб) |
| lofi | электропиано, мягкие биты, винил (спокойные факты, история вещей) |
| tense | шпионский триллер, бас, тиканье (heist, выбор, деньги) |
| happy | ксилофон, свист, гитара (детское, милое) |
| emotional | пианино и струнные (трогательные истории) |
| synthwave | ретро 80-х синты (neon, технологии, будущее) |
| underwater | маримба, пузыри (сериал про подводный дом) |
Старые имена тоже работают: chill = lofi, sad = emotional, action = epic. `"synth:<mood>"` = старый генератор из кода.

Эффекты (assets/sfx, поле `sfx`): pop, boing, ding, boom, riser, glitch, heart, tick, cash, notify, scratch, typing, swish (whoosh = swish), whoosh_big.

## Как пополнять (важно для разнообразия)
- Одну и ту же музыку не ставить в два ролика подряд. Смотреть, что стояло в последних роликах (plans/*.json).
- Раз в 2–3 дня добавлять новую подложку: flow `sUcHhd2wJZcUtkcpWUkH` в ElevenLabs, creative_add_flow_node (node_type sfx, model eleven_text_to_sound_v2, model_parameters {"duration_seconds": 30, "loop": true, "prompt_influence": 0.6}, prompt начинать с «Seamless loop instrumental ... no vocals»), потом creative_run_flow_nodes с generations_count 1, потом один get_flow_run_status и скачать mp3 в assets/music/<имя>.mp3. Стоит около 100 кредитов.
- Нужен особый звук для сцены (дверь, дождь, смех зала, кот): так же, duration_seconds 1–4, около 5–15 кредитов, сохранить в assets/sfx/<имя>.mp3 и дописать сюда.
