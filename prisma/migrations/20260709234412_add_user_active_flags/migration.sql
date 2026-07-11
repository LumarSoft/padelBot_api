-- AlterTable
ALTER TABLE `User` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;
