-- AlterTable
ALTER TABLE `Court` ADD COLUMN `slotDurationMinutes` INTEGER NOT NULL DEFAULT 90,
    ADD COLUMN `weeklyHours` JSON NULL;
