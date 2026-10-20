# Архив

Сюда 2026-10-21 перенесено то, что игра и редактор карт сейчас не используют. **Ничего не удалено.** Точный список «откуда → куда» — в [`MOVED.tsv`](MOVED.tsv): 183 строки; колонка `how` — `git` (файл был в репозитории, перенесён через `git mv`) или `fs` (файл не был в git).

| Папка | Что внутри | Откуда |
|---|---|---|
| `tools/inspect/` | разовые скрипты осмотра моделей, сцен, координат и архивов (Python/Blender, Node) | `tools/` |
| `tools/asset_pipeline/` | конвейер подготовки ассетов: распаковка паков, чистка и сборка GLB, небоскрёбы, рендер карты Филиппин сверху, трассировка дорог | `tools/` |
| `tools/browser_checks/` | разовые проверки в headless Chrome и съёмка скриншотов; их заменяют `tools/autopilot/` и `tools/cdp.mjs` | `tools/` |
| `tools/tuning_wip/` | заготовки подбора физики от 2026-10-18; всё нужное уже перенесено в `js/soil.js` | `tools/tuning_wip/` |
| `debug_images/` | 116 отладочных jpg/png (167 МБ); в git не входят, см. `.gitignore` | `tools/*.jpg`, `tools/*.png` |
| `screenshots/` | скриншоты Заира и редактора | корень проекта |
| `models/` | GLB, которые никто не загружает: ambulance, police-car, taxi, bruno-chassis, bruno-wheel. `philippines_skyscrapers.glb` остался в `models/`: его загружает `philippines_meta.json` | `models/` |
| `textures/` | aerial_grass_rock.jpg, bark_willow_02.jpg — нигде не используются | `textures/` |

Отдельно: `philippines_topdown_map.png` (фон редактора для Филиппин) не архивирован, а перенесён из корня в `assets/`; путь в `tools/road_editor.html` исправлен.

## Как вернуть файл

Скрипты в архиве написаны с путями относительно `tools/` или корня проекта, поэтому перед запуском их нужно вернуть на прежнее место:

```bash
git mv "архив/tools/inspect/inspect_models.py" tools/
```

Для файлов с `how = fs` используйте `mv` вместо `git mv`.
