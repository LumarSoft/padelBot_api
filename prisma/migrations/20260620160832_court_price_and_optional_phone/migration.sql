-- AlterTable
ALTER TABLE `Booking` MODIFY `playerPhone` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Court` ADD COLUMN `priceCents` INTEGER NOT NULL DEFAULT 0;
