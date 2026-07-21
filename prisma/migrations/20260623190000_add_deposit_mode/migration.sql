-- AlterTable: per-club payment policy — charge a partial deposit (seña) or the full court price.
ALTER TABLE `Club` ADD COLUMN `depositMode` ENUM('DEPOSIT', 'FULL') NOT NULL DEFAULT 'DEPOSIT',
    ADD COLUMN `depositPercent` INTEGER NOT NULL DEFAULT 25;
