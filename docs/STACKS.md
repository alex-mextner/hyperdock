# Stacks: Recents, Downloads, Screenshots and the Trash

## What the user asked for

Recovered from the project tickets and the session history (2026-10-11, 2026-10-31); quoted verbatim.

- hyperdock#6, comment of 2026-10-11 13:30 (the original wish):
  «Давай сделаем недавние, загрузки и скриншоты в виде стопок, чтобы было видно что это не один элемент а несколько. недавние таким образом тоже будут сгруппированы и пусть находятся слева от загрузок за тем же разделителем
  стопки должны быть динамические, состоять из того что там на самом деле»
- the same ticket, 13:32:
  «и recent-apps-count=3 по умолчанию надо будет сдеалть таким же как у загрузок и скриншотов, 20?»
- ubuntu-tweaks session, 2026-10-10 15:08 (the dock spec): «док на ubuntu работает полностью как на маке но опенсорсный и гибкий. по умолчанию есть папки загрузки и скриншоты справа.»
- 2026-10-31: «почини работу с выпадушками в доке, например в Downloads ничего не кликается и не сделано пачками как я ранее просил (поищи ворктри и задачи) так же не сделано пачками недавние процессы и не объединены в одну группу с загрузками скриншотами и корзиной.»

"Пачками" is the same wish as "в виде стопок": the stack should look like several things, not one, and be made of what is really in it.

## How it is done

| Requirement | Where |
|---|---|
| A stack's dock icon is a visible pile of the newest real items (up to three overlapping, rotated pictures, type cards or app icons), redrawn when the folder or the app list changes | `stackModel.js` (`pileLayers`), `apps/stack-pile.js` (drawn in a separate process, like the glass Trash), `stackPile.js`; "Display as Stack" (the default for Downloads, Screenshots and Recents) |
| Dropdowns list the items in batches under headers: by date (Today, Yesterday, Previous 7 Days, Previous 30 Days, Earlier) or by kind (Folders, Images, Movies, Music, Documents, Archives, Applications, Other) | `stackModel.js` (`groupItems`), `stackPanel.js`; "Group by" in the stack menu, `downloads-stack-group` (default date), `group` in a `folder-stacks` entry |
| Recents are a stack too: the recently closed apps, in a pile, opening as a fan, grid or list of app icons; a click starts the app | `services.js` (`setupRecentsStack`), `stackSources.js` (`recentItems`), `recents-stack-view`, `recents-stack-display`; "Clear Recents" in its menu |
| Recents, Downloads, Screenshots (and other stacks), the minimized-window tiles and the Trash are one group behind one separator, Recents first | `stackDock.js`, `stackModel.js` (`clusterOrder`); the old "recent apps among the apps" section is gone |
| Screenshots is a stack by default | `stackSources.js` (`folderStackSpecs`): `<Pictures>/<Screenshots>` once that folder exists (`screenshots-icon`); a `folder-stacks` entry for the same folder takes it over |
| `recent-apps-count` as many as the other stacks | default 20 (was 0, range 0..50); an explicit value in dconf is kept |

### Choices where the wish was ambiguous

- Batches in the dropdown follow the macOS "Group By" idea (date added or kind). Recents has no timestamps (the list is ordered by when an app closed), so it stays one batch.
- The fan view is an arc of at most N items; batches apply to the Grid and List views.
- The default grouping is by date; "None" restores the flat list.

## Why the dropdown ignored clicks

Root cause, reproduced in a nested shell with a virtual pointer (`tools/stacks-shell.sh`): GNOME 50's `St.Button` is a click gesture and is cancelled when an ancestor handles the press. `StackPanel` returned `Clutter.EVENT_STOP` from `button-press-event` on both its popover and its full-monitor backdrop, so the press never completed a click: `pressed` went true then false and `clicked` was never emitted. The Downloads setting "Automatic" opens the Grid when there are more files than the fan holds, so Downloads was affected the moment it had more than a handful of files. Only a press outside the popover is handled (and closes the panel) now.

## Testing

- Pure rules: `tests/stack_*_check.js` (run by `make test`).
- Real input: `tools/stacks-shell.sh` boots a nested headless shell on a scratch data dir, clicks the stack items and the entries of their dropdowns with a virtual pointer (a stub `xdg-open` and stub app launchers prove the click arrived), checks the batch headers, the group's order and the single separator, and saves screenshots to `stacks-out/shots`.
