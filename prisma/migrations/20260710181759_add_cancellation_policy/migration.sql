-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `creditAppliedCents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `depositOutcome` ENUM('CREDITED', 'FORFEITED', 'REFUNDED') NULL;

-- AlterTable
ALTER TABLE `Club` ADD COLUMN `cancellationWindowHours` INTEGER NOT NULL DEFAULT 24;
