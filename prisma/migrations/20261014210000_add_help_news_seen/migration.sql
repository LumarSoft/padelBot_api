-- "Novedades" in the panel's "?" help: what's new for the owner (fijos confirmation, kiosk
-- stock, no-deposit mode…), with a dot on the "?" until it's seen. The entries live in the
-- panel; the server only keeps, per user, the newest one they've seen — the owner opens the
-- panel from several devices, so the browser can't hold it.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `newsSeenId` VARCHAR(64) NULL;
