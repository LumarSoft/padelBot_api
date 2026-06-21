-- CreateIndex
-- Enforces one slot per (court, start time). Blocks the race where an admin and
-- the bot create the same slot on an empty band at the exact same minute.
CREATE UNIQUE INDEX `Slot_courtId_startsAt_key` ON `Slot`(`courtId`, `startsAt`);

-- DropIndex
-- The standalone courtId index is now redundant: the unique index above has
-- courtId as its leftmost column, so it already serves both courtId lookups and
-- the Slot_courtId_fkey foreign key. It must be created before this drop so the
-- FK never loses its backing index.
DROP INDEX `Slot_courtId_idx` ON `Slot`;
