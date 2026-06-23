-- AlterTable: per-club MercadoPago Connect (OAuth) credentials. Tokens stored encrypted.
ALTER TABLE `Club`
    ADD COLUMN `mpAccessToken` TEXT NULL,
    ADD COLUMN `mpRefreshToken` TEXT NULL,
    ADD COLUMN `mpUserId` VARCHAR(191) NULL,
    ADD COLUMN `mpTokenExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `mpConnectedAt` DATETIME(3) NULL;
