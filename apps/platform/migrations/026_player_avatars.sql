-- Preset avatars (Erdin 2026-11-16, FigCraft page "Brand · Avatars"): a colour and, optionally, an icon in place of
-- the initial. No uploads. NULL = not picked: the game derives a colour from the player id and shows the initial.
-- The lists match apps/server/src/games/shared/avatars.ts.
-- Rollback: ALTER TABLE players DROP COLUMN avatar_color, DROP COLUMN avatar_icon;
ALTER TABLE players
  ADD COLUMN avatar_color text CHECK (avatar_color IN (
    'rain', 'navy', 'wind', 'felt', 'teal', 'slate', 'storm', 'rose', 'oxblood', 'ember', 'sun', 'brass'
  )),
  ADD COLUMN avatar_icon text CHECK (avatar_icon IN (
    'cloud', 'sun', 'moon', 'star', 'bolt', 'drop', 'snow', 'rainbow',
    'leaf', 'flame', 'kite', 'crown', 'chip', 'die', 'gem', 'anchor'
  ));
