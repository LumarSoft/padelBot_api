-- AlterTable: per-club strict DNI matching toggle.
ALTER TABLE `Club` ADD COLUMN `requireDniMatch` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: reservation DNI (for matching) + identity of who actually transferred.
ALTER TABLE `Booking` ADD COLUMN `playerDni` VARCHAR(191) NULL,
    ADD COLUMN `payerCuit` VARCHAR(191) NULL,
    ADD COLUMN `payerEmail` VARCHAR(191) NULL,
    ADD COLUMN `payerMpUserId` VARCHAR(191) NULL;
